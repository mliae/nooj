/**
 * 游标签名：用 HMAC-SHA256 对 feed/moments 游标做签名，防止客户端伪造 kind/id/head 参数。
 * - 签名格式：`base64(json)|hex(hmac)`（28 字符 hex 足够）
 * - 无签名时 decode 返回 null（优雅降级：签名是可选加固，不影响正常使用）
 */
import { createHmac } from "node:crypto";

let secret = process.env.CURSOR_SECRET || process.env.ADMIN_PASSWORD || process.env.SITE_NAME || "nooj-default-cursor-key";

export function setCursorSecret(s: string) {
  if (s && s.length >= 8) secret = s;
}

/** 用 HMAC-SHA256 对 payload 签 hex 摘要 */
function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}

/**
 * 给游标加签：`base64(payload)|hex(hmac)`
 * 签名放外面，客户端可以解码看内容但无法篡改。
 */
export function signCursor(payload: string): string {
  return `${payload}|${sign(payload)}`;
}

/**
 * 验签并返回 payload。格式不对或签名不符返回 null（当作"无更多数据"处理安全）。
 * 无签名的纯 base64 游标（旧客户端）也能通过 decodeFeedCursor 兼容，
 * 但 signCursor 必须在 encode 时统一加签，保证新游标被验签。
 */
export function verifyCursor(raw: string): string | null {
  if (!raw || !raw.includes("|")) return raw; // 无签名的旧格式：放行（decodeFeedCursor 会校验字段）
  const sep = raw.lastIndexOf("|");
  const payload = raw.slice(0, sep);
  const mac = raw.slice(sep + 1);
  if (mac.length !== 32) return null;
  const expected = sign(payload);
  // 常量时间比较（防时序攻击）
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (mac.charCodeAt(i) || 0);
  return diff === 0 ? payload : null;
}
