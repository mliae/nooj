/**
 * 杂项公开路由：
 * GET /api/qq-info?qq=   QQ 号 → 昵称 + 邮箱 + 头像（uapis.cn API + 多源容错）
 * GET /api/geo/reverse?lat=&lon=  浏览器坐标 → 地名（服务端代理 Nominatim）
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import { getSettings } from "../settings";
import type { SiteSettings } from "../settings";
import { keyToSrc } from "../db";
import { ensureAvatar } from "../avatar";
import { sanitizeOrigin } from "../seo";
import { putObject, storagePrefix } from "../storage";
import { checkRate, getClientIp } from "../rateLimit";

const app = new Hono<HonoEnv>();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const QQ_RE = /^[1-9]\d{4,11}$/;

/** GBK 响应解码（QQ 空间 JSONP 为 GBK），不支持时回退 UTF-8 */
function decodeBuf(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/** apihz QQ 昵称接口 */
const APIHZ_URL = "https://cn.apihz.cn/api/other/qq.php";

/** 从响应文本中提取昵称，支持多种常见 JSON 结构 */
function extractNick(text: string, parse: string, qq: string): string {
  const t = text.trim();
  if (!t) return "";
  try {
    // JSONP 回调包裹
    const jsonMatch = t.match(/\{[\s\S]*\}/);
    const raw = jsonMatch ? jsonMatch[0] : t;
    const d = JSON.parse(raw) as Record<string, unknown>;
    switch (parse) {
      case "apihz": return d.code === 200 ? String(d.Name || d.name || "").trim() : "";
      case "uapis": return String(d.nickname || d.name || "").trim();
      case "uomg": return d.code === 1 ? String(d.nick || d.username || "").trim() : "";
      case "guiguiya": return d.code === 200 ? String((d.data as Record<string, unknown>)?.name || "").trim() : "";
      case "auto":
      default: {
        // 通用提取：遍历常见字段名
        for (const key of ["nickname", "nick", "name", "username", "QQname"]) {
          const v = d[key];
          if (typeof v === "string" && v.trim() && v.trim() !== "null") return v.trim();
        }
        // 嵌套 data.name
        const data = d.data as Record<string, unknown> | undefined;
        if (data) {
          for (const key of ["name", "nickname", "nick"]) {
            const v = data[key];
            if (typeof v === "string" && v.trim() && v.trim() !== "null") return v.trim();
          }
        }
        // qzone 旧格式：{ "10001": ["url", ..., "nickname"] }
        const arr = d[qq] as string[] | undefined;
        return arr?.[6] || arr?.[0] || "";
      }
    }
  } catch {
    return "";
  }
}

/**
 * 直连腾讯接口查询 QQ 昵称（需后台配置 ckqq/skey/pskey）。
 * 仅供服务端调用，凭证私密不下发前端。返回 null 表示未配置/失败。
 * 多接口轮试：先试不需要 Cookie 的公开接口，再试需要 Cookie 的接口。
 */
export async function fetchQqNickDirect(
  s: SiteSettings,
  qq: string
): Promise<{ nickname: string } | null> {
  // 1. 先尝试不需要 Cookie 的公开接口
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(`https://users.qzone.qq.com/fcg-bin/cgi_get_portrait.fcg?uins=${encodeURIComponent(qq)}`, {
      signal: ctrl.signal,
      headers: { "Referer": "https://qzone.qq.com/", "User-Agent": UA },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const text = await resp.text();
      // JSONP 格式：_Callback({"237333536":["url",...,0,0,0,"nickname"]});
      const m = text.match(/\["([^"]+)"\]\s*\)\s*;?\s*$/);
      if (m && m[1] && m[1] !== "") return { nickname: m[1].trim().slice(0, 50) };
      // 旧格式：{"qq":["url",...,"nickname"]}
      const jm = text.match(new RegExp(`"${qq}"\\s*:\\s*\\[[^\\]]*"([^"\\]]+)"\\s*\\]`));
      if (jm && jm[1]) return { nickname: jm[1].trim().slice(0, 50) };
    }
  } catch { /* 继续下一个 */ }

  // 2. 再试需要 Cookie 的接口（qzone 主页接口，对 IP 风控更宽松）
  if (s.qq_ckqq && s.qq_pskey) {
    const cookie = `uin=o${s.qq_ckqq}; skey=${s.qq_skey}; p_skey=${s.qq_pskey}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(`https://h5.qzone.qq.com/proxy/domain/g.qzone.qq.com/cgi-bin/cgi_get_qzone_index?uin=${s.qq_ckqq}&g_tk=5381`, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Cookie": cookie,
          "Referer": "https://qzone.qq.com/",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "manual",
      });
      clearTimeout(timer);
      if (resp.ok) {
        const html = await resp.text();
        if (!html.includes("ptlogin") && !html.includes("login.qq.com")) {
          const m = html.match(/<title>([^<]+?)的空间/) || html.match(/nickname["\s:=]+["']([^"']+)["']/);
          if (m && m[1]) return { nickname: m[1].trim().slice(0, 50) };
        }
      }
    } catch { /* 继续下一个 */ }
  }

  // 3. 兜底：尝试 profile 页
  if (s.qq_ckqq && s.qq_pskey) {
    const cookie = `uin=o${s.qq_ckqq}; skey=${s.qq_skey}; p_skey=${s.qq_pskey}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(`https://user.qzone.qq.com/${encodeURIComponent(qq)}/profile`, {
        signal: ctrl.signal,
        headers: { "User-Agent": UA, "Cookie": cookie, "Referer": "https://qzone.qq.com/" },
        redirect: "manual",
      });
      clearTimeout(timer);
      if (resp.ok) {
        const html = decodeBuf(await resp.arrayBuffer());
        const m = html.match(/<title>([^<]+?)的空间/) || html.match(/nickname["\s:=]+["']([^"']+)["']/) || html.match(/"name"\s*:\s*"([^"]+)"/);
        if (m && m[1]) return { nickname: m[1].trim().slice(0, 50) };
      }
    } catch { /* 忽略 */ }
  }

  return null;
}

/** 检测 QQ Cookie 是否有效（用于保活+告警）。
 * 走 apihz 接口验证：apihz 服务器在国内，能真实用 Cookie 请求腾讯；
 * Workers 海外节点直连腾讯会被风控（有效 Cookie 也返回登录页），不可用。
 * Cookie 的业务用途就是给 apihz 取昵称，apihz 验证通过 = 业务可用。 */
export async function checkQqCookie(s: SiteSettings): Promise<{ ok: boolean; msg: string; debug?: Record<string, unknown> }> {
  if (!s.qq_ckqq || !s.qq_pskey) return { ok: false, msg: "未配置 ckqq/pskey" };
  const id = (s.apihz_id || "").trim();
  const key = (s.apihz_key || "").trim();
  const url = `${APIHZ_URL}?id=${encodeURIComponent(id || "88888888")}&key=${encodeURIComponent(key || "88888888")}&qq=${encodeURIComponent(s.qq_ckqq)}&ckqq=${encodeURIComponent(s.qq_ckqq)}&skey=${encodeURIComponent(s.qq_skey)}&pskey=${encodeURIComponent(s.qq_pskey)}`;
  // Workers 海外节点访问 apihz（国内站）偶发慢，15s 超时 + 失败后重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      const text = await resp.text();
      const debug = { endpoint: "apihz", status: resp.status, attempt: attempt + 1 };
      const nick = extractNick(text, "apihz", s.qq_ckqq);
      if (nick) {
        return { ok: true, msg: `Cookie 有效（昵称：${nick}）`, debug };
      }
      try {
        const d = JSON.parse(text) as Record<string, unknown>;
        const textMsg = String(d.text || d.msg || "");
        if (d.code === 400) {
          return { ok: false, msg: `Cookie 已失效：${textMsg || "请重新登录 vip.qq.com 抓取，并更新监控平台请求头"}`, debug: { ...debug, response: textMsg } };
        }
        return { ok: false, msg: `检测失败：${textMsg || "apihz 返回未知错误"}`, debug: { ...debug, response: textMsg } };
      } catch {
        return { ok: false, msg: "检测失败：apihz 返回异常", debug };
      }
    } catch (e) {
      if (attempt === 1) {
        return { ok: false, msg: `检测失败：apihz 连接超时（已重试 1 次），请稍后再试`, debug: { endpoint: "apihz", error: String(e) } };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, msg: "检测失败：未知错误" };
}

/**
 * GET /api/comments/latest?limit=  最新评论（公开，主题侧边栏用）
 * 只返回顶级评论，剥离邮箱/QQ/网站等隐私字段；目标摘要供侧边栏展示。
 */
app.get("/comments/latest", async c => {
  // 全站评论关闭（备案模式）：最新评论接口返回空，侧栏小部件自动隐藏
  const sLatest = await getSettings(c.env.DB);
  if (!sLatest.comments_enabled) return ok(c, { list: [] });
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit")) || 5));
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.target_type, c.target_id, c.nickname, c.content, c.avatar_url, c.is_owner, c.created_at,
            CASE WHEN c.target_type = 'post' THEN p.title
                 ELSE substr(replace(replace(m.content, char(10), ' '), char(13), ''), 1, 60)
            END AS target_excerpt,
            p.slug AS post_slug
     FROM comments c
     LEFT JOIN moments m ON c.target_type = 'moment' AND m.id = c.target_id
     LEFT JOIN posts p ON c.target_type = 'post' AND p.id = c.target_id
     WHERE c.parent_id = 0 AND c.nickname <> '' AND c.content <> ''
     ORDER BY c.id DESC LIMIT ?`
  )
    .bind(limit)
    .all<{
      id: number;
      target_type: "moment" | "post";
      target_id: number;
      nickname: string;
      content: string;
      avatar_url: string;
      is_owner: number;
      created_at: string;
      target_excerpt: string;
      post_slug: string | null;
    }>();
  const list = (rows.results ?? []).map(r => ({
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    nickname: r.nickname,
    content: r.content,
    avatar_url: r.avatar_url,
    is_owner: r.is_owner === 1,
    created_at: r.created_at,
    target_excerpt: r.target_excerpt,
    post_slug: r.post_slug,
  }));
  return ok(c, { list });
});

/**
 * GET /api/saying  每日一言（服务端代理 uapis.cn，首页侧栏卡片用）
 * 进程缓存 1 小时（一言不需要每次访问都回源）；回源失败/超时返回本地兜底语料，保证卡片永远有内容。
 */
const SAYING_TTL = 60 * 60 * 1000;
let sayingCache: { text: string; ts: number } | null = null;
const SAYING_FALLBACK = [
  "代码与生活，皆有迹可循。",
  "把日子过得慢一点，把字写得认真一点。",
  "万事顺遂，毫无蹉跎。",
  "保持热爱，奔赴山海。",
];
app.get("/saying", async c => {
  // rate limit: 60 次/分钟（有进程缓存，正常访问几乎不触发实际回源）
  const ip = getClientIp(c.req.header("cf-connecting-ip"), c.req.header("x-real-ip"));
  if (!checkRate(`saying:${ip}`, 60, 60_000)) return fail(c, "操作过于频繁", 429);
  if (sayingCache && Date.now() - sayingCache.ts < SAYING_TTL) {
    return ok(c, { text: sayingCache.text });
  }
  try {
    const res = await fetch("https://uapis.cn/api/v1/saying", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(3000),
    });
    const d = (await res.json()) as { text?: string };
    const text = String(d.text || "").trim().slice(0, 60);
    if (text) {
      sayingCache = { text, ts: Date.now() };
      // 外部接口故障时用上一次成功的缓存兜底，无缓存才走本地语料
      return ok(c, { text });
    }
  } catch {
    // 走下方兜底
  }
  if (sayingCache) return ok(c, { text: sayingCache.text });
  return ok(c, { text: SAYING_FALLBACK[Math.floor(Date.now() / 86400000) % SAYING_FALLBACK.length] });
});

/**
 * GET /api/ip-locate  客户端 IP 归属地代理
 * 返回 { ip, province, city }；失败返回 null，前端隐藏天气胶囊
 */
const ipLocateCache = new Map<string, { ip: string; province: string; city: string; ts: number }>();
const IP_LOCATE_TTL = 60 * 60 * 1000;
const IP_LOCATE_SOURCES = [
  "https://whois.pconline.com.cn/ipJson.jsp?json=true",
  "https://ip.zxinc.org/getip",
];
app.get("/ip-locate", async c => {
  const ip = getClientIp(c.req.header("cf-connecting-ip"), c.req.header("x-real-ip"));
  const cached = ipLocateCache.get(ip);
  if (cached && Date.now() - cached.ts < IP_LOCATE_TTL) return ok(c, { ip: cached.ip, province: cached.province, city: cached.city });
  for (const src of IP_LOCATE_SOURCES) {
    try {
      const res = await fetch(src, { headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const txt = (await res.text()).trim();
      // pconline 返回 JSON；zxinc 返回 JS 变量 IPData = {...}
      const jsonText = src.includes("zxinc") ? txt.replace(/^.*?=/, "").replace(/;?\s*$/, "") : txt;
      const d = JSON.parse(jsonText);
      const province = String(d.pro || d.province || "").trim();
      const city = String(d.city || "").trim();
      if (province && city) {
        const snap = { ip: String(d.ip || ip), province, city, ts: Date.now() };
        ipLocateCache.set(ip, snap);
        return ok(c, { ip: snap.ip, province, city });
      }
    } catch { /* 试下一个源 */ }
  }
  return ok(c, null);
});

/**
 * GET /api/weather  顶栏天气胶囊
 * 默认按客户端 IP 定位（EdgeOne/CDN 回源时从 x-forwarded-for / cf-connecting-ip 取真实 IP）。
 * ?city=xxx 可显式指定城市（前端先 IP 定位再传城市，绕过 CDN 场景下服务端拿不到真实 IP 的问题）。
 * 进程缓存 30 分钟，按 city|ip 分 key。失败依次回退：同 key 旧缓存 → 全局 fallback → 返回空。
 */
const WEATHER_TTL = 30 * 60 * 1000;
interface WeatherSnap {
  province: string; city: string; district: string;
  weather: string; temperature: number;
  wind_direction: string; wind_power: string; humidity: string; report_time: string;
  alerts: { title: string; level: string }[];
}
const weatherCacheMap = new Map<string, { data: WeatherSnap; ts: number }>();
let weatherGlobalFallback: { data: WeatherSnap; ts: number } | null = null;
app.get("/weather", async c => {
  const cfIp = c.req.header("cf-connecting-ip");
  const realIp = c.req.header("x-real-ip");
  const fwdFor = c.req.header("x-forwarded-for");
  const userIp = cfIp
    ? (Array.isArray(cfIp) ? cfIp[0] : cfIp)
    : (realIp || (fwdFor ? (Array.isArray(fwdFor) ? fwdFor[0] : fwdFor.split(",")[0].trim()) : ""));
  const ipKey = userIp || "unknown";
  const cityParam = String(c.req.query("city") || "").trim();
  // city 优先；没 city 时回退 IP 定位
  const sourceLabel = cityParam ? `city:${cityParam}` : `ip:${ipKey}`;
  if (!checkRate(`weather:${sourceLabel}`, 60, 60_000)) return fail(c, "操作过于频繁", 429);

  const cached = weatherCacheMap.get(sourceLabel);
  if (cached && Date.now() - cached.ts < WEATHER_TTL) return ok(c, cached.data);

  try {
    const url = cityParam
      ? `https://uapis.cn/api/v1/misc/weather?city=${encodeURIComponent(cityParam)}`
      : `https://uapis.cn/api/v1/misc/weather${userIp ? `?ip=${encodeURIComponent(userIp)}` : ""}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    const d = (await res.json()) as Record<string, unknown>;
    const str = (k: string) => String(d[k] || "").trim().slice(0, 40);
    const num = (k: string) => {
      const v = d[k];
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.round(n) : 0;
    };
    const rawAlerts = Array.isArray(d.alerts) ? d.alerts : [];
    const data: WeatherSnap = {
      province: str("province"),
      city: str("city"),
      district: str("district"),
      weather: str("weather"),
      temperature: num("temperature"),
      wind_direction: str("wind_direction"),
      wind_power: str("wind_power"),
      humidity: str("humidity"),
      report_time: str("report_time"),
      alerts: rawAlerts.slice(0, 3).map(a => {
        const o = a as Record<string, unknown>;
        return { title: String(o.title || "").trim().slice(0, 60), level: String(o.level || "").trim().slice(0, 10) };
      }).filter(a => a.title),
    };
    if (data.city && data.weather) {
      weatherCacheMap.set(sourceLabel, { data, ts: Date.now() });
      weatherGlobalFallback = { data, ts: Date.now() };
      return ok(c, data);
    }
  } catch { /* 兜底 */ }
  if (cached) return ok(c, cached.data);
  if (weatherGlobalFallback && Date.now() - weatherGlobalFallback.ts < WEATHER_TTL) {
    return ok(c, weatherGlobalFallback.data);
  }
  return ok(c, null);
});

app.get("/qq-info", async c => {
  const qq = (c.req.query("qq") || "").trim();
  if (!QQ_RE.test(qq)) return fail(c, "QQ 号不合法", 400);

  const avatar = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`;
  let nickname = "";
  const email = `${qq}@qq.com`;
  const s = await getSettings(c.env.DB);
  const mode = s.qq_nick_mode || "fallback";

  /** 调用 apihz 获取昵称 */
  const tryApiHz = async (): Promise<string> => {
    const id = (s.apihz_id || "").trim();
    const key = (s.apihz_key || "").trim();
    const ckqq = (s.qq_ckqq || "").trim();
    const skey = (s.qq_skey || "").trim();
    const pskey = (s.qq_pskey || "").trim();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const url = `${APIHZ_URL}?id=${encodeURIComponent(id || "88888888")}&key=${encodeURIComponent(key || "88888888")}&qq=${encodeURIComponent(qq)}&ckqq=${encodeURIComponent(ckqq)}&skey=${encodeURIComponent(skey)}&pskey=${encodeURIComponent(pskey)}`;
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error("http " + resp.status);
      const text = await resp.text();
      return extractNick(text, "apihz", qq);
    } catch {
      return "";
    } finally {
      clearTimeout(timer);
    }
  };

  if (mode === "direct") {
    try {
      const a = await fetchQqNickDirect(s, qq);
      if (a?.nickname) nickname = a.nickname;
    } catch { /* 忽略 */ }
  } else if (mode === "apihz") {
    nickname = await tryApiHz();
  } else {
    // fallback（默认）：先腾讯直连，失败再 apihz
    try {
      const a = await fetchQqNickDirect(s, qq);
      if (a?.nickname) nickname = a.nickname;
    } catch { /* 忽略 */ }
    if (!nickname) nickname = await tryApiHz();
  }

  return ok(c, { qq, nickname, email, avatar });
});

/**
 * POST /api/comment-upload  公开评论图片上传（无需登录）
 * multipart: file（JPG/PNG/GIF/WEBP，限 5MB）
 * 存储到 R2 uploads/comments/ 路径，返回 src
 */
const COMMENT_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};
const COMMENT_MAX_SIZE = 5 * 1024 * 1024;

app.post("/comment-upload", async c => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail(c, "file 不能为空");
  if (file.size > COMMENT_MAX_SIZE) return fail(c, "图片不能超过 5MB");
  const ext = COMMENT_IMAGE_TYPES[file.type];
  if (!ext) return fail(c, "仅支持 JPG/PNG/GIF/WEBP 图片");

  const date = new Date().toISOString().slice(0, 10);
  const uuid = crypto.randomUUID();
  const key = `uploads/comments/${date}/${uuid}.${ext}`;

  const s = await getSettings(c.env.DB);
  // 远端存储模式评论图片同样加 b2/、r2/ 前缀，便于路由与删除
  const finalKey = `${storagePrefix(s.storage_mode)}${key}`;
  await putObject(c.env.R2, s, finalKey, file.stream(), file.type);
  return ok(c, { key: finalKey, src: keyToSrc(finalKey, s.r2_domain, s.b2_domain), content_type: file.type, size: file.size });
});

/**
 * POST /api/comment/avatar  按邮箱预拉取评论头像并缓存到 R2（无需登录）
 * body: { email, qq } → { src, cached }；拉取失败返回 src=""
 * 前端在评论框输入邮箱后调用，实现「输入即拉取」。
 */
const EMAIL_RE2 = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const QQ_RE2 = /^[1-9]\d{4,11}$/;
app.post("/comment/avatar", async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, "请求格式错误", 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  let email = String(b.email ?? "").trim().toLowerCase().slice(0, 100);
  if (email && !EMAIL_RE2.test(email)) email = "";
  let qq = String(b.qq ?? "").trim().replace(/[^\d]/g, "").slice(0, 12);
  if (qq && !QQ_RE2.test(qq)) qq = "";

  const s = await getSettings(c.env.DB);
  const res = await ensureAvatar(c.env.R2, s, email, qq);
  return ok(c, { src: res?.src || "", cached: res?.cached ?? false });
});

/** 逆地址解析：服务端代理 OpenStreetMap Nominatim */
app.get("/geo/reverse", async c => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return fail(c, "坐标无效", 400);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&accept-language=zh-CN`,
      {
        signal: ctrl.signal,
        headers: { "User-Agent": UA, Referer: sanitizeOrigin(c.req.url, c.req.header("x-forwarded-proto")) + "/" },
      }
    );
    if (!resp.ok) throw new Error("geo http " + resp.status);
    const d = (await resp.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const a = d.address || {};
    const place =
      [a.city || a.province || a.state, a.city_district || a.suburb || a.district || a.county, a.road || a.neighbourhood]
        .filter(Boolean)
        .join("·")
        .slice(0, 100) || (d.display_name || "").slice(0, 100);
    return ok(c, { place: place || "", display_name: d.display_name || "" });
  } catch {
    return fail(c, "地名解析失败", 502);
  } finally {
    clearTimeout(timer);
  }
});

export default app;
