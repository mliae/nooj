/**
 * 评论 AI 机器人自动回复
 *
 * 触发条件（满足任一）：
 *   1. 评论内容包含「@机器人昵称」（昵称在后台 AI 设置中配置，默认「小J」）；
 *   2. 后台开启「自动回复」(ai_auto_reply)：访客每条评论 AI 都自动回复，无需 @。
 *
 * 站长本人评论、AI 自己的评论不会触发（避免自循环刷屏）；
 * 同一根楼下 AI 最多回复 6 次（防刷）。
 * 通过 c.executionCtx.waitUntil 异步生成，不阻塞评论提交；任何失败仅记日志。
 *
 * 两级楼层结构：机器人回复挂到触发评论所在的根评论下
 * （触发评论是根评论 → parent_id = 该评论；是楼中楼回复 → parent_id = 其根评论）。
 */
import type { Context } from "hono";
import type { HonoEnv } from "./types";
import type { CommentRow } from "./db";
import type { AiBinding } from "./ai";
import { getSettings } from "./settings";
import { resolveAi } from "./ai-resolver";
import { generateText, TEXT_MODEL, TEXT_MODEL_FALLBACK } from "./ai";

/** 机器人回复内容上限（与用户评论一致 500 字） */
const MAX_REPLY = 500;

/** 从 Markdown 提取纯文本摘要，用于给 AI 提供正文上下文 */
function plainSnippet(md: string, max = 300): string {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " ") // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接→文字
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function maybeScheduleAiReply(
  c: Context<HonoEnv>,
  opts: { type: "moment" | "post"; targetId: number; comment: CommentRow }
): Promise<void> {
  const s = await getSettings(c.env.DB);
  if (!s.ai_reply_enabled) return;

  const ai = resolveAi(c, s);
  if (!ai) return;

  const { type, targetId, comment } = opts;

  // 防自循环：AI 自己的回复 / 站长本人评论不再触发
  if (comment.is_ai || comment.is_owner) return;

  const botName = (s.ai_bot_name || "").trim() || "小J";
  const mention = `@${botName}`;
  const mentioned = comment.content.includes(mention);
  const auto = !!s.ai_auto_reply;
  // 未 @ 且未开启自动回复 → 跳过
  if (!mentioned && !auto) return;

  const rootId = comment.parent_id || comment.id;

  // 防刷：同一根楼下 AI 累计最多回复 6 次
  const cnt = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM comments
     WHERE target_type = ? AND target_id = ? AND parent_id = ? AND is_ai = 1`
  )
    .bind(type, targetId, rootId)
    .first<{ n: number }>();
  if (Number(cnt?.n ?? 0) >= 6) return;

  c.executionCtx.waitUntil(
    generateAndSave(c, { ai, type, targetId, rootId, comment, botName, mentioned })
  );
}

async function generateAndSave(
  c: Context<HonoEnv>,
  args: {
    ai: AiBinding;
    type: "moment" | "post";
    targetId: number;
    rootId: number;
    comment: CommentRow;
    botName: string;
    mentioned: boolean;
  }
): Promise<void> {
  const { ai, type, targetId, rootId, comment, botName, mentioned } = args;
  try {
    const s = await getSettings(c.env.DB);

    // 被评论对象上下文：文章取标题 + 摘要 + 正文片段，说说取纯文本前 200 字
    let subject = "";
    if (type === "post") {
      const p = await c.env.DB.prepare(`SELECT title, excerpt, content_md FROM posts WHERE id = ?`)
        .bind(targetId)
        .first<{ title: string; excerpt: string; content_md: string }>();
      if (p) {
        const parts = [p.title, p.excerpt ? plainSnippet(p.excerpt, 120) : "", plainSnippet(p.content_md, 300)];
        subject = parts.filter(Boolean).join(" | ");
      }
    } else {
      const m = await c.env.DB.prepare(`SELECT content FROM moments WHERE id = ?`)
        .bind(targetId)
        .first<{ content: string }>();
      subject = plainSnippet(m?.content || "", 200);
    }

    // 读者实际发言：@ 触发时去掉 @昵称，自动回复时保留原文
    const userContent = mentioned
      ? comment.content.split(`@${botName}`).join(" ").replace(/\s+/g, " ").trim() || comment.content
      : comment.content;

    const siteTitle = s.site_title || "本站";
    const prompt = [
      `你是轻博客「${siteTitle}」的 AI 助手「${botName}」，正在回复读者 ${comment.nickname} 的评论。`,
      subject ? `上文（文章/说说）内容摘要：${subject}` : "",
      `读者评论：${userContent}`,
      "请结合上文内容与读者评论，用友好、简洁、口语化的中文自然回复（不超过 200 字），可适当使用 emoji。",
      "直接输出回复正文，不要加任何前缀、解释或引号。",
    ]
      .filter(Boolean)
      .join("\n");

    const model = (s.ai_text_model || "").trim() || (s.ai_model || "").trim() || TEXT_MODEL;
    const genOpts = { maxTokens: 400, temperature: 0.7, thinking: false } as const;
    let reply = "";
    try {
      reply = await generateText(ai, [{ role: "user", content: prompt }], { ...genOpts, model });
    } catch (e) {
      console.warn("[AI] primary model failed, fallback:", e instanceof Error ? e.message : e);
      reply = await generateText(ai, [{ role: "user", content: prompt }], {
        ...genOpts,
        model: TEXT_MODEL_FALLBACK,
      });
    }
    reply = reply.slice(0, MAX_REPLY).trim();
    if (!reply) return;

    // 头像只接受 http(s) 图片 URL
    const avatar = /^https?:\/\//i.test(s.ai_bot_avatar) ? s.ai_bot_avatar.slice(0, 300) : "";

    await c.env.DB.prepare(
      `INSERT INTO comments
         (target_type, target_id, parent_id, nickname, content, is_owner, qq, email, avatar_url, website, is_ai)
       VALUES (?, ?, ?, ?, ?, 0, '', ?, ?, '', 1)`
    )
      .bind(type, targetId, rootId, botName.slice(0, 20), reply, "ai-bot@jxe.local", avatar)
      .run();
  } catch (e) {
    console.error("[AI] bot reply failed:", e);
  }
}
