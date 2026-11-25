/**
 * 社交路由（与 moments.ts 共用 /api/moments 前缀，路径不重叠）
 * POST /:id/like      {voter_id}  点赞/取消（toggle，匿名 uuid 去重）
 * POST /:id/comments  {nickname, content}  评论（站主 cookie 有效时 is_owner=1）
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import { isAdmin, requireAdmin } from "../auth";
import { checkRate, getClientIp } from "../rateLimit";
import {
  parseCommentBody,
  validateCommentInput,
  createComment,
  deleteCommentThread,
} from "../comment-service";
import { maybeScheduleAiReply } from "../ai-reply";
import { getSettings } from "../settings";
import { canonicalOrigin } from "../seo";
import { ensureAvatar } from "../avatar";
import { handleCommentMailNotifications, mailConfigFrom } from "../mail";

const app = new Hono<HonoEnv>();

const VOTER_RE = /^[A-Za-z0-9_-]{8,64}$/;

async function momentExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM moments WHERE id = ?`).bind(id).first();
  return !!row;
}

async function likeCount(db: D1Database, id: number): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM likes WHERE moment_id = ?`).bind(id).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

app.post("/:id/like", async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);

  // CSRF 防护：Origin 头存在时必须匹配站点域名（防跨站伪造点赞）
  const originHeader = c.req.header("origin");
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  if (originHeader && !originHeader.startsWith(origin.replace(/\/$/, ""))) {
    return fail(c, "来源不允许", 403);
  }
  // IP 维度 rate limit：防 bot 刷票（10 次/分钟）
  const ip = getClientIp(c.req.header("cf-connecting-ip"), c.req.header("x-real-ip"));
  if (!checkRate(`like:${ip}`, 10, 60_000)) {
    return fail(c, "操作过于频繁", 429);
  }

  let voterId = "";
  try {
    const body = await c.req.json<{ voter_id?: unknown }>();
    voterId = String(body.voter_id ?? "");
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  if (!VOTER_RE.test(voterId)) return fail(c, "访客标识无效", 400);
  if (!(await momentExists(c.env.DB, id))) return fail(c, "动态不存在", 404);

  const existing = await c.env.DB.prepare(
    `SELECT id FROM likes WHERE moment_id = ? AND voter_id = ?`
  )
    .bind(id, voterId)
    .first();

  let liked: boolean;
  if (existing) {
    await c.env.DB.prepare(`DELETE FROM likes WHERE moment_id = ? AND voter_id = ?`).bind(id, voterId).run();
    liked = false;
  } else {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO likes (moment_id, voter_id) VALUES (?, ?)`
    )
      .bind(id, voterId)
      .run();
    liked = true;
  }
  return ok(c, { liked, like_count: await likeCount(c.env.DB, id) });
});

app.post("/:id/comments", async c => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return fail(c, "无效的 ID", 400);
  // 全站评论开关：关闭时拒绝发表（管理员同样受限）
  const sEarly = await getSettings(c.env.DB);
  if (!sEarly.comments_enabled) return fail(c, "评论已关闭", 403);

  let input;
  try {
    input = parseCommentBody(await c.req.json());
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const fieldError = validateCommentInput(input);
  if (fieldError) return fail(c, fieldError);

  // 头像兜底：前端预拉取失败/未拉取时，服务端确保头像已缓存并写入（不依赖客户端）
  const s = sEarly;
  const ensured = await ensureAvatar(
    c.env.R2,
    s,
    input.email || (input.qq ? `${input.qq}@qq.com` : ""),
    input.qq
  );
  if (ensured) input.avatarUrl = ensured.src;

  const owner = await isAdmin(c);
  const ip = c.req.header("cf-connecting-ip") || "";
  const result = await createComment(c.env.DB, "moment", id, input, owner, {
    ip,
    rateLimit: parseInt(s.comment_rate_limit, 10) || 5,
  });
  if ("error" in result) return fail(c, result.error, result.status ?? 400);
  // @AI 机器人：内容含 @机器人昵称 时异步生成楼中楼回复（开关关闭/未提及均无操作）
  await maybeScheduleAiReply(c, { type: "moment", targetId: id, comment: result.comment });

  // 邮件通知（异步执行，失败静默）：管理员新评论 + 被回复者订阅通知
  const moment = await c.env.DB
    .prepare(`SELECT content FROM moments WHERE id = ?`)
    .bind(id)
    .first<{ content: string }>();
  const targetLabel = (moment?.content ?? "").replace(/\s+/g, " ").slice(0, 60) || `说说 #${id}`;
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  c.executionCtx.waitUntil(
    handleCommentMailNotifications({
      mail: mailConfigFrom(s),
      db: c.env.DB,
      notifySettings: s,
      site: s.site_title || "Nooj Log",
      comment: result.comment,
      targetTypeLabel: "说说",
      targetLabel,
      url: `${origin}/#moment-${id}`,
    })
  );

  return ok(c, { ...result.comment, is_owner: result.comment.is_owner === 1 }, "评论成功");
});

/**
 * DELETE /:id/comments/:cid  管理员删除评论
 */
app.delete("/:id/comments/:cid", requireAdmin, async c => {
  const momentId = Number(c.req.param("id"));
  const commentId = Number(c.req.param("cid"));
  if (!Number.isFinite(momentId) || !Number.isFinite(commentId)) return fail(c, "无效的 ID", 400);
  if (!(await deleteCommentThread(c.env.DB, "moment", momentId, commentId))) {
    return fail(c, "评论不存在", 404);
  }
  return ok(c, { id: commentId }, "已删除");
});

export default app;
