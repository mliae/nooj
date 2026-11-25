/**
 * 邮件发送（Resend / 腾讯云 SES）+ 评论通知模板
 * - Resend：POST https://api.resend.com/emails，Authorization: Bearer <apiKey>
 * - 腾讯云 SES：POST https://ses.tencentcloudapi.com，TC3-HMAC-SHA256 签名，Action=SendEmail
 *   国内发信 IP，投递 QQ/163 更快；每账号 1000 封免费额度，不限有效期
 *   国内站默认只允许「模板发送」：配置模板 ID 后走 Template，未配置则尝试自定义内容（需专项权限）
 * - 发送失败静默返回 false，绝不影响评论主流程
 */

export type MailProvider = "resend" | "tencent";

export interface MailConfig {
  provider: MailProvider;
  apiKey: string; // Resend API Key
  secretId: string; // 腾讯云 SecretId
  secretKey: string; // 腾讯云 SecretKey
  region: string; // 腾讯云 SES 地域
  from: string;
  to: string;
  templateId?: string; // 腾讯云模板 ID（配置后优先用模板发送）
  templateData?: Record<string, string>; // 模板变量
}

export async function sendMail(opts: MailConfig & { subject: string; html: string }): Promise<boolean> {
  const { provider, from, to, subject, html } = opts;
  if (!from || !to) return false;
  try {
    if (provider === "tencent") return await sendViaTencent(opts);
    return await sendViaResend(opts);
  } catch {
    return false;
  }
}

/** Resend（海外服务，国内投递偏慢） */
async function sendViaResend(opts: MailConfig & { subject: string; html: string }): Promise<boolean> {
  const { apiKey, from, to, subject, html } = opts;
  if (!apiKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return res.ok;
}

/* ---------------- 腾讯云 SES（TC3-HMAC-SHA256 签名） ---------------- */

const SES_HOST = "ses.tencentcloudapi.com";
const SES_SERVICE = "ses";
const SES_VERSION = "2020-10-02";
const SES_ACTION = "SendEmail";
const SES_CONTENT_TYPE = "application/json; charset=utf-8";

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (const b of u8) out += b.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bufToHex(d);
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u.byteLength);
  new Uint8Array(ab).set(u);
  return ab;
}

async function hmacSha256(key: Uint8Array, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}

async function sendViaTencent(opts: MailConfig & { subject: string; html: string }): Promise<boolean> {
  const { secretId, secretKey, region, from, to, subject, html, templateId, templateData } = opts;
  if (!secretId || !secretKey) return false;

  // 有模板 ID 走模板发送（国内站默认唯一可用方式）；否则退回自定义内容
  const payloadObj: Record<string, unknown> = {
    FromEmailAddress: from,
    Destination: [to],
    Subject: subject,
  };
  const tid = Number(templateId);
  if (templateId && Number.isFinite(tid) && tid > 0) {
    payloadObj.Template = { TemplateID: tid, TemplateData: JSON.stringify(templateData || {}) };
  } else {
    // Simple 的 Html 字段需 base64 编码
    payloadObj.Simple = { Html: toBase64(html) };
  }
  const payload = JSON.stringify(payloadObj);

  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = "content-type;host";
  const canonicalHeaders = `content-type:${SES_CONTENT_TYPE}\nhost:${SES_HOST}\n`;
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    await sha256Hex(payload),
  ].join("\n");
  const credentialScope = `${date}/${SES_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode("TC3" + secretKey), date);
  const kService = await hmacSha256(kDate, SES_SERVICE);
  const kSigning = await hmacSha256(kService, "tc3_request");
  const signature = bufToHex(await hmacSha256(kSigning, stringToSign));

  const res = await fetch(`https://${SES_HOST}`, {
    method: "POST",
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": SES_CONTENT_TYPE,
      "X-TC-Action": SES_ACTION,
      "X-TC-Version": SES_VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": region || "ap-guangzhou",
    },
    body: payload,
  });
  if (!res.ok) {
    console.warn(`[mail] 腾讯云 SES HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return false;
  }
  // 腾讯云即使 HTTP 200 也可能在 Response.Error 里返回业务错误
  const j = (await res.json().catch(() => null)) as { Response?: { Error?: { Code?: string; Message?: string } } } | null;
  if (j?.Response?.Error) {
    console.warn(`[mail] 腾讯云 SES 返回错误: ${j.Response.Error.Code} ${j.Response.Error.Message}`);
    return false;
  }
  return !!j?.Response;
}

/** 通用中文邮件 HTML 外壳 */
function mailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f3f1ea">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border:1px solid #e6e2d6;border-radius:12px;overflow:hidden">
      <div style="background:#6b8e6f;color:#fff;padding:14px 20px;font-size:15px;font-weight:700">${title}</div>
      <div style="padding:20px;color:#3f4a40;font-size:14px;line-height:1.7">${bodyHtml}</div>
      <div style="padding:12px 20px;border-top:1px solid #eee;color:#9a9f94;font-size:12px">本邮件由 Nooj Log 自动发送，请勿直接回复。</div>
    </div>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 完整 URL 转成相对路径：腾讯云模板审核要求链接域名写死，只允许路径部分用变量。
 * 例：https://nooj.cn/post/abc#comments → post/abc#comments
 */
function urlToPath(u: string): string {
  try {
    const x = new URL(u);
    return (x.pathname.replace(/^\/+/, "") + x.search + x.hash).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

/** 评论被回复通知（订阅者） */
export function replyNotifyHtml(opts: {
  site: string;
  replyNickname: string;
  replyContent: string;
  url: string;
}): string {
  const { site, replyNickname, replyContent, url } = opts;
  return mailShell(
    `📩 你的评论收到回复 · ${site}`,
    `<p>您订阅的评论收到了新回复：</p>
     <div style="background:#f6f5f0;border-left:3px solid #6b8e6f;border-radius:6px;padding:10px 14px;margin:10px 0;color:#3f4a40">
       <b>${escHtml(replyNickname)}</b>：${escHtml(replyContent)}
     </div>
     <p style="margin-top:18px"><a href="${escHtml(url)}" style="background:#6b8e6f;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:13px">查看回复</a></p>`
  );
}

/**
 * 评论创建后的通知编排（异步执行，失败静默）：
 * 1. 新评论 → 只走 Webhook 推给站长（不消耗邮件额度）
 * 2. 楼中楼回复 → 给被回复的根评论者发邮件（mail_reply_notify）
 */
export interface CommentMailConfig {
  enabled: boolean;
  provider: MailProvider;
  apiKey: string;
  secretId: string;
  secretKey: string;
  region: string;
  templateReply: string; // 腾讯云「回复通知」模板 ID
  from: string;
  replyNotify: boolean;
}

/** 从站点设置构造邮件配置（服务商字段归一，避免各路由重复映射） */
export function mailConfigFrom(
  s: {
    mail_enabled: boolean;
    mail_provider: string;
    mail_resend_key: string;
    mail_tencent_id: string;
    mail_tencent_key: string;
    mail_tencent_region: string;
    mail_tencent_template_reply: string;
    mail_from: string;
    mail_reply_notify: boolean;
  }
): CommentMailConfig {
  return {
    enabled: s.mail_enabled,
    provider: s.mail_provider === "tencent" ? "tencent" : "resend",
    apiKey: s.mail_resend_key,
    secretId: s.mail_tencent_id,
    secretKey: s.mail_tencent_key,
    region: s.mail_tencent_region,
    templateReply: s.mail_tencent_template_reply,
    from: s.mail_from,
    replyNotify: s.mail_reply_notify,
  };
}

export interface CommentNotifyOpts {
  mail: CommentMailConfig;
  notifySettings?: import("./security").NotifySettings; // Webhook 通知配置（含地址 + 分类开关）
  db: D1Database;
  site: string;
  comment: { id: number; nickname: string; content: string; parent_id: number; email?: string };
  targetTypeLabel: string; // 「说说」或「文章」
  targetLabel: string;
  url: string;
}

export async function handleCommentMailNotifications(opts: CommentNotifyOpts): Promise<void> {
  const { mail, notifySettings, db, site, comment, targetTypeLabel, targetLabel, url } = opts;

  // Webhook 新评论通知（走统一入口，受「新评论」开关控制）
  if (notifySettings) {
    try {
      const { notify } = await import("./security");
      const excerpt = comment.content.replace(/\n/g, " ").slice(0, 100);
      // 必须 await：本函数由 waitUntil 调用，丢弃 Promise 会导致 fetch 在上下文终止时被取消
      await notify(notifySettings, "comment", `💬 新评论 · ${comment.nickname}`, `${targetTypeLabel}「${targetLabel}」\n${excerpt}\n${url}`);
    } catch { /* 通知失败不影响主流程 */ }
  }

  const credsReady = mail.provider === "tencent" ? !!(mail.secretId && mail.secretKey) : !!mail.apiKey;
  if (!mail.enabled || !credsReady || !mail.from) return;

  const base = {
    provider: mail.provider,
    apiKey: mail.apiKey,
    secretId: mail.secretId,
    secretKey: mail.secretKey,
    region: mail.region,
    from: mail.from,
  };

  // 1. 管理员新评论通知走 Webhook（见上方），此处不再发邮件，节省额度

  // 2. 回复订阅通知：仅楼中楼回复（parent_id>0），且回复者不是被回复者本人
  if (mail.replyNotify && comment.parent_id > 0) {
    try {
      const root = await db
        .prepare(`SELECT nickname, email FROM comments WHERE id = ? LIMIT 1`)
        .bind(comment.parent_id)
        .first<{ nickname: string; email: string }>();
      if (root?.email && root.email !== comment.email) {
        await sendMail({
          ...base,
          to: root.email,
          subject: `你的评论收到新回复 · ${site}`,
          html: replyNotifyHtml({ site, replyNickname: comment.nickname, replyContent: comment.content, url }),
          templateId: mail.templateReply,
          templateData: {
            site,
            nickname: comment.nickname,
            content: comment.content.slice(0, 300),
            path: urlToPath(url),
          },
        });
      }
    } catch {
      // 查询失败不影响主流程
    }
  }
}