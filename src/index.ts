/**
 * Nooj Log 应用入口（Hono app，Node 自托管）
 * - /api/*   Hono API（动态/文章/社交/管理）
 * - /media/* 本地磁盘 / R2 / B2 对象流式输出（Range）
 * - HTML 路由（/ /posts /post/:slug /photos /admin）：SSR 注入 SEO meta/JSON-LD/文章正文
 * - robots.txt / sitemap.xml / rss.xml
 * - 其余     静态资源由 ASSETS（public/）服务；SPA 深链兜底 index.html
 * 运行时依赖 src/platform/* 提供的同构垫片（SQLite D1 / 本地磁盘 R2 / 内存 caches / ExecutionContext）。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "./types";
import { ok, fail } from "./respond";
import { serveMedia, serveSiteLogo } from "./media";
import adminRoutes from "./routes/admin";
import momentRoutes from "./routes/moments";
import socialRoutes from "./routes/social";
import postRoutes from "./routes/posts";
import feedRoutes from "./routes/feed";
import translateRoutes from "./routes/translate";
import musicRoutes from "./routes/music";
import miscRoutes from "./routes/misc";
import photoRoutes, { adminPhotoRoutes, serializePhoto, type PhotoRow } from "./routes/photos";
import friendRoutes, { adminFriendRoutes, serializeFriend, LAST_POST_JOIN, type FriendRow } from "./routes/friends";
import searchRoutes from "./routes/search";
import indexnowAdminRoutes from "./routes/indexnow";
import baiduAdminRoutes from "./routes/baidu";
import bgRoutes, { preheatBg } from "./routes/bg";
import { analyticsPublicRoutes, analyticsAdminRoutes } from "./routes/analytics";
import opsRoutes, { runUptimeCheck, recordPerf } from "./routes/ops";
import { getSettings } from "./settings";
import { detectLang, parseLangs } from "./i18n";
import { keyToSrc, ensureSchema, queryFeed, type PostRow } from "./db";
import { isAdmin, hasAdminPassword, ADMIN_COOKIE } from "./auth";
import { detectAttack, isBlocked, recordAttack, recordError } from "./security";
import { checkRate, getClientIp } from "./rateLimit";
import {
  buildSeoHead,
  websiteJsonLd,
  blogJsonLd,
  collectionJsonLd,
  postJsonLd,
  renderPostSsr,
  robotsTxt,
  sitemapXml,
  rssXml,
  renderPostsSsr,
  renderFeedSsr,
  renderAboutSsr,
  renderPhotosSsr,
  renderLinksSsr,
  absoluteUrl,
  canonicalOrigin,
} from "./seo";

const app = new Hono<HonoEnv>();

/* ==================== www → 裸域 301 ====================
 * 前提：EdgeOne 中 www.nooj.cn 的「回源 Host 头」设为「跟随加速域名」，
 * 源站才会收到 Host: www.nooj.cn；此时统一 301 到裸域并保留 path/query。
 * 裸域请求（Host: nooj.cn）不受影响。
 */
app.use("*", async (c, next) => {
  const host = (c.req.header("host") || "").toLowerCase().trim().split(":")[0];
  if (host.startsWith("www.")) {
    const url = new URL(c.req.url);
    return c.redirect(`https://${host.slice(4)}${url.pathname}${url.search}`, 301);
  }
  return next();
});

/* ==================== 性能监控 ====================
 * 仅统计 /api/* 请求总耗时，异步采样写入 perf_log：
 * - 耗时 ≥ 300ms 的慢请求必记（用于发现劣化接口）
 * - 其余请求以 10% 概率采样（控制 SQLite 写入量）
 *
 * 注意：ensureSchema 已从全局中间件移出，只在 cron（/__scheduled）和 admin/setup 调用。
 * 现网 schema 一旦建好就一直存在，冷启动不再拖慢首个请求。
 */
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (!url.pathname.startsWith("/api/")) return next();
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  if (duration >= 300 || Math.random() < 0.1) {
    try {
      c.executionCtx.waitUntil(recordPerf(c.env.DB, c.req.method, url.pathname, duration));
    } catch {
      // 采样写入失败不影响请求
    }
  }
});

/* ==================== SSR 页面内存缓存 ====================
 * 匿名访客的 HTML 走进程内缓存（caches 垫片）：命中即不查库，TTFB 显著降低。
 * - 仅 GET、HTML、且未带管理员 cookie 时缓存（管理员永远取最新，避免后台改动被缓存）。
 * - 发布/改动后最长 ~2 分钟生效；浏览器 1 分钟、进程缓存 2 分钟、并允许 stale-while-revalidate。
 */
const SSR_CACHE_EXACT = new Set(["/", "/posts", "/photos", "/links", "/links/apply", "/about", "/moments", "/friends"]);
const isSsrCachePath = (pathname: string) => SSR_CACHE_EXACT.has(pathname) || /^\/post\/[^/]+$/.test(pathname);
app.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
  if (!isSsrCachePath(new URL(c.req.url).pathname)) return next();
  const cookie = c.req.header("cookie") || "";
  if (cookie.includes(`${ADMIN_COOKIE}=`)) return next(); // 管理员不缓存
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(c.req.url);
  const hit = await cache.match(key);
  if (hit) return hit; // 缓存命中，直接返回
  await next();
  if (c.res.status === 200 && (c.res.headers.get("content-type") || "").includes("text/html")) {
    c.res.headers.set("cache-control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
  }
});

/* ==================== 安全中间件 ====================
 * 攻击检测 + 自动封禁。位于 SSR 缓存之后：缓存命中的请求不经此层，零额外开销。
 * - 静态资源 / media / imgproxy 直接放行
 * - 封禁 IP 返回 403（黑名单 60s 内存缓存，正常访客几乎无 D1 查询）
 * - 命中高危规则（block=true）记录并 403；中危（后台探测/工具UA）仅记录放行
 * - 攻击记录与封禁判断均异步执行（waitUntil），不阻塞正常响应
 */
const SAFE_STATIC_EXT_RE =
  /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|map|txt|xml|json|wasm|mp4|webm|mp3|ogg|pdf|webmanifest)(\?|#|$)/i;

app.use("*", async (c, next) => {
  try {
    const url = new URL(c.req.url);
    const path = url.pathname;
    // 静态资源与安全前缀直接放行
    if (
      SAFE_STATIC_EXT_RE.test(path) ||
      path.startsWith("/media/") ||
      path === "/imgproxy" ||
      path.startsWith("/imgproxy/") ||
      path === "/favicon.ico"
    ) {
      return next();
    }
    // 已登录管理员的请求不触发攻击检测：后台合法操作可能命中敏感词规则
    // （如备份导出 /api/admin/ops/backup/export），且接口本身由 requireAdmin 保护。
    if (path.startsWith("/api/admin/")) {
      if (await isAdmin(c)) return next();
    }
    const ip =
      c.req.header("cf-connecting-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";
    // 封禁检查：命中直接 403
    if (ip && (await isBlocked(c.env.DB, ip))) {
      return c.text("Forbidden", 403, { "cache-control": "no-store" });
    }
    // 攻击检测（命中即停）
    const ua = c.req.header("user-agent") || "";
    const hit = detectAttack(path, url.search.slice(1), ua);
    if (hit) {
      const s = await getSettings(c.env.DB);
      const opts = {
        autoBan: s.auto_ban_enabled,
        threshold: parseInt(s.ban_threshold, 10) || 5,
        durationHours: parseInt(s.ban_duration_hours, 10) || 24,
      };
      const info = {
        ip,
        path,
        method: c.req.method,
        ua,
        country: c.req.header("cf-ipcountry") || "",
      };
      // 高危规则：异步记录（含封禁判断）并拦截
      if (hit.block) {
        c.executionCtx.waitUntil(recordAttack(c.env.DB, s.notify_security ? s.security_webhook_url : "", hit, info, opts));
        return c.text("Forbidden", 403, { "cache-control": "no-store" });
      }
      // 中危规则：仅记录，不拦截（自动封禁只统计高危，传完整 opts 无害）
      c.executionCtx.waitUntil(recordAttack(c.env.DB, s.notify_security ? s.security_webhook_url : "", hit, info, opts));
    }
  } catch {
    // 安全模块自身异常绝不影响主请求
  }
  return next();
});

/* ==================== 安全响应头 ====================
 * 全局限 5 个头：
 * - X-Content-Type-Options: nosniff（禁止 MIME 嗅探，防上传 SVG 伪执行）
 * - X-Frame-Options: SAMEORIGIN（防止后台/评论管理被 iframe 点击劫持）
 * - Referrer-Policy: strict-origin-when-cross-origin（跨站只发 origin）
 * - Permissions-Policy: 禁用 camera/microphone；geolocation 放开给同源（发布动态时「一键定位」需要，
 *   写成 geolocation=() 会让浏览器直接判 PERMISSION_DENIED 且不弹授权框）
 * - Content-Security-Policy: 宽松版，允许 index.html 里的内联 script（theme restore / i18n boot / CSRF 非ce不可）
 *   严格 CSP 或 nonce 方案需要重构 index.html 的内联脚本注入，收益不抵成本
 */
app.use("*", async (c, next) => {
  await next();
  const res = c.res;
  // X-Content-Type-Options 只对非文本资源有意义，但加上总成本为零
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  // 后台「侧栏嵌入」可填任意 iframe，把其中出现的 https 主机动态加入 frame-src，
  // 否则 CSP 会静默拦掉嵌入内容（白屏）。设置由源站防护中间件读入 context。
  const embedHosts = (() => {
    const s = c.get("siteSettings");
    const html = String(s?.sidebar_embed_html || "");
    if (!html) return "";
    const set = new Set<string>();
    for (const m of html.matchAll(/(?:src|data-src)\s*=\s*["'](https?:\/\/[^"'\/\s]+)/gi)) {
      set.add(m[1].replace(/^https?:\/\//i, "").toLowerCase());
    }
    return set.size ? " " + [...set].join(" ") : "";
  })();
  // 宽松 CSP：允许 'unsafe-inline' 以兼容 index.html 内联启动脚本 + theme.js 运行时插入 style
  res.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self'${embedHosts} player.bilibili.com www.bilibili.com www.youtube.com www.youtube-nocookie.com player.vimeo.com player.youku.com *.iframe.qq.com open.iqiyi.com *.bokecc.com video.zqgk.org; media-src 'self' data: https: http:; object-src 'none'; base-uri 'self'; form-action 'self'`
  );
});

app.get("/api/health", c => ok(c, { site: c.env.SITE_NAME ?? "Nooj Log", time: new Date().toISOString() }));

// 源站防护（EdgeOne 免费版无固定回源 IP 段的替代方案）：
// 后台「安全中心」设置 origin_token 后，除 /api/health 外所有请求必须携带匹配头 x-nooj-origin，
// EdgeOne「规则引擎 → 回源请求头」里配置同名同值，回源流量自动带头通过；直连 IP:3001 无头 → 403。
// 注意注册顺序：/api/health 路由已在上方注册，先于本中间件命中，天然豁免（服务器本机健康检查不受影响）。
app.use("*", async (c, next) => {
  const s = await getSettings(c.env.DB);
  // 供安全响应头中间件判断「侧栏嵌入」允许的 iframe 主机（避免重复读库）
  c.set("siteSettings", s);
  if (s.origin_token && c.req.header("x-nooj-origin") !== s.origin_token) {
    return fail(c, "Forbidden", 403);
  }
  return next();
});

// 公开站点配置（横幅文案/站名等）；admin_path 等敏感字段不下发
// 设置变更频率低：浏览器缓存 60s（s-maxage 供前置 CDN 使用，直连场景忽略）
app.get("/api/settings", async c => {
  const s = await getSettings(c.env.DB);
  // 私密字段绝不下发：后台入口、apihz 凭证、百度翻译凭证、QQ 登录态、邮件 API Key、告警 Webhook、B2/R2 存储凭证、AI API Key
  const {
    admin_path: _h1, apihz_id: _h2, apihz_key: _h3, qq_ckqq: _h4, qq_skey: _h5, qq_pskey: _h6,
    indexnow_key: _h7, baidu_push_token: _h8, mail_resend_key: _h9, security_webhook_url: _h10,
    music_api_key: _h11, baidu_translate_appid: _h12, baidu_translate_key: _h13,
    b2_key_id: _h14, b2_app_key: _h15, r2_key_id: _h16, r2_secret_key: _h17, origin_token: _h18,
    ai_api_key: _h19,
    ...publicSettings
  } = s;
  void [_h1, _h2, _h3, _h4, _h5, _h6, _h7, _h8, _h9, _h10, _h11, _h12, _h13, _h14, _h15, _h16, _h17, _h18, _h19];
  const res = ok(c, publicSettings);
  res.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  return res;
});

// 当前语言判定（访客侧）：cookie > 访问地 > Accept-Language > 默认语言。
// 结果因人而异（cookie/地理），严禁 CDN/代理缓存。
app.get("/api/i18n/detect", async c => {
  const s = await getSettings(c.env.DB);
  const lang = detectLang(s, {
    cookie: c.req.header("cookie") || "",
    country: c.req.header("cf-ipcountry") || "",
    acceptLanguage: c.req.header("accept-language") || "",
  });
  const res = ok(c, {
    enabled: s.i18n_enabled,
    lang,
    default: s.i18n_default,
    langs: parseLangs(s),
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

app.route("/api/photos", photoRoutes);
app.route("/api/admin/photos", adminPhotoRoutes);
app.route("/api/friends", friendRoutes);
app.route("/api/admin/friends", adminFriendRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/admin/ops", opsRoutes);
app.route("/api/moments", momentRoutes);
app.route("/api/moments", socialRoutes);
app.route("/api/posts", postRoutes);
app.route("/api/feed", feedRoutes);
app.route("/api/translate", translateRoutes);
app.route("/api/music", musicRoutes);
app.route("/api", miscRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/admin/indexnow", indexnowAdminRoutes);
app.route("/api/admin/baidu", baiduAdminRoutes);
app.route("/api/bg", bgRoutes);
app.route("/api/analytics", analyticsPublicRoutes);
app.route("/api/admin/analytics", analyticsAdminRoutes);

app.get("/logo.png", serveSiteLogo);
app.get("/media/*", serveMedia);

/* ==================== 外链图片反向代理 ====================
 * 部分图床/资源站域名在国内网络被 TLS 阻断（DNS 正常但握手失败），
 * 浏览器直连封面永远加载失败。由服务器回源取图，浏览器只访问自家域名；
 * 进程内缓存 7 天，回源一次后几乎零成本。
 * 安全：仅 http(s)、拦截内网字面量地址、只回 image/*、上限 15MB。
 */
const MAX_IMG_PROXY = 15 * 1024 * 1024;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv4 内网/保留段
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // 链路本地（含云 metadata）
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0)) return true;
    if (a >= 224) return true; // 组播/保留
  }
  // IPv6 回环/链路本地/唯一本地
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

app.get("/imgproxy", async c => {
  const raw = c.req.query("u");
  if (!raw) return c.text("missing u", 400);
  // rate limit: 60 次/分钟/IP（防刷流量）
  const ip = getClientIp(c.req.header("cf-connecting-ip"), c.req.header("x-real-ip"));
  if (!checkRate(`imgproxy:${ip}`, 60, 60_000)) return c.text("too many requests", 429);
  // 防盗用：只接受页面内 <img> 请求（Sec-Fetch-Dest: image）或同源 Referer/Origin，
  // 阻止第三方把本服务当开放图床代理刷流量。旧浏览器无 Sec-Fetch 头时
  // 一般会带 Referer，三者全缺才拒绝。
  // 同源比较：反代下自站 host 可能带默认端口（如 nooj.cn:443），而浏览器 Referer/Origin 不带
  // —— 两侧都剥掉默认端口再比，避免同源请求被误判 403
  const normHost = (h: string) => h.replace(/:443$/, "").replace(/:80$/, "");
  const selfHost = normHost(new URL(c.req.url).host);
  const fetchDest = c.req.header("sec-fetch-dest") || "";
  const referer = c.req.header("referer") || "";
  const origin = c.req.header("origin") || "";
  const hostOf = (s: string) => { try { return normHost(new URL(s).host); } catch { return ""; } };
  const sameOrigin = hostOf(referer) === selfHost || hostOf(origin) === selfHost;
  if (fetchDest !== "image" && !sameOrigin) return c.text("forbidden", 403);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return c.text("bad url", 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return c.text("bad scheme", 400);
  if (isBlockedHost(target.hostname)) return c.text("forbidden", 403);

  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        // 部分图床校验 Referer/UA，带源站 Origin 的常规浏览器标识
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Referer: target.origin + "/",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
  } catch {
    return c.text("upstream fetch failed", 502);
  }
  if (!upstream.ok || upstream.status === 404) {
    return c.text("upstream error", upstream.status === 404 ? 404 : 502);
  }
  const ct = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ct.startsWith("image/")) return c.text("not an image", 415);
  // 声明长度超限直接拒绝；未声明长度时读完整 body 再校验（防 chunked 绕过）。
  // 封面图通常 <1MB，15MB 内 ArrayBuffer 对 Worker 内存无压力。
  const declaredLen = Number(upstream.headers.get("content-length") ?? 0);
  if (declaredLen && declaredLen > MAX_IMG_PROXY) return c.text("too large", 413);
  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_IMG_PROXY) return c.text("too large", 413);

  const res = new Response(buf, {
    status: 200,
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});

/* ==================== SEO 静态文件 ==================== */

async function publishedPosts(db: D1Database, limit = 500): Promise<PostRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM posts WHERE status = 'published' ORDER BY id DESC LIMIT ?`)
    .bind(limit)
    .all<PostRow>();
  return rows.results ?? [];
}

app.get("/robots.txt", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  return c.text(robotsTxt(origin), 200, { "content-type": "text/plain; charset=utf-8" });
});

app.get("/sitemap.xml", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const posts = await publishedPosts(c.env.DB);
  return c.text(sitemapXml(origin, posts), 200, { "content-type": "application/xml; charset=utf-8" });
});

app.get("/rss.xml", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const posts = await publishedPosts(c.env.DB, 50);
  return c.body(rssXml(origin, s, posts), 200, {
    "content-type": "application/rss+xml; charset=utf-8",
  });
});

// /feed 作为 RSS 订阅源别名（通用惯例），与 /rss.xml 输出一致
app.get("/feed", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const posts = await publishedPosts(c.env.DB, 50);
  return c.body(rssXml(origin, s, posts), 200, {
    "content-type": "application/rss+xml; charset=utf-8",
  });
});

// IndexNow key 校验文件：搜索引擎抓取此文件验证 key 归属；未配置 key 时返回 404
app.get("/indexnow-key.txt", async c => {
  const s = await getSettings(c.env.DB);
  const key = (s.indexnow_key || "").trim();
  if (!key) return c.text("Not Found", 404);
  return c.text(key, 200, { "content-type": "text/plain; charset=utf-8" });
});

/* ==================== HTML SSR ==================== */

// index.html 短缓存（30s），减少对 ASSETS 的重复子请求；发布后最多 30s 生效
let indexCache: { at: number; text: string } | null = null;
async function getIndexHtml(c: Context<HonoEnv>): Promise<string> {
  const now = Date.now();
  if (indexCache && now - indexCache.at < 30_000) return indexCache.text;
  const res = await c.env.ASSETS.fetch(new URL("/index.html", c.req.url).toString());
  const text = await res.text();
  indexCache = { at: now, text };
  return text;
}

const TITLE_TAG = "<title>Nooj Log</title>";

// 深链兜底的主题化 index.html 缓存（30s），避免每次 SPA 深链请求都重复拉取/替换
let themeHtmlCache: { at: number; theme: string; cfg: string; text: string } | null = null;
async function getThemedIndexHtml(
  c: Context<HonoEnv>,
  theme: string,
  themeConfig?: Record<string, unknown> | null
): Promise<Response> {
  const now = Date.now();
  const cfg = JSON.stringify(themeConfig || {});
  if (themeHtmlCache && now - themeHtmlCache.at < 30_000 && themeHtmlCache.theme === theme && themeHtmlCache.cfg === cfg) {
    return c.html(themeHtmlCache.text, 200, { "cache-control": "public, max-age=3600" });
  }
  const res = await c.env.ASSETS.fetch(new URL("/index.html", c.req.url).toString());
  const text = await res.text();
  const themed = applyTheme(text, theme, false, themeConfig);
  themeHtmlCache = { at: now, theme, cfg, text: themed };
  return c.html(themed, 200, { "cache-control": "public, max-age=3600" });
}
const DESC_RE = /<meta name="description"[^>]*>/i;
// favicon 用正则匹配（模板里的默认图标颜色可能被手动改过，固定字符串会匹配不上导致替换静默失败）
const ICON_RE = /<link rel="icon"[^>]*>/i;
const HEAD_MARK = "<!--SSR_HEAD-->";
const I18N_MARK = "<!--I18N_BOOT-->";
const APP_MARK = '<main id="app" class="page-main"></main>';
// 主题资源版本号（改动 themes/* 或 app.js 时手动升，用于击穿 CDN/浏览器缓存）
const THEME_ASSET_VERSION = "20261125nooj102";

/**
 * 按站点主题替换 index.html 中的 CSS/JS 资源：
 * - default：保持默认 style.css + app.js 不变
 * - 其他主题：保留默认 style.css（组件样式打底），追加 /themes/<theme>/style.css，并在 app.js 后追加加载 /themes/<theme>/theme.js
 * - 后台管理路径（isAdminPath）强制默认主题 UI，避免后台样式被主题覆盖
 * window.__THEME__ / window.__THEME_CONFIG__ 在 app.js 之前注入，供 route() 判断主题视图、主题 JS 读取独立配置。
 */
function applyTheme(
  html: string,
  theme: string,
  isAdminPath: boolean,
  themeConfig?: Record<string, unknown> | null
): string {
  if (!theme || theme === "default") return html;
  // 主题 CSS/JS 对所有页面（包括后台）都注入：
  // - 顶栏的天气胶囊 / RSS 按钮 / 导航风格需要前台后台统一
  // - theme.js 内部的 __NJ_THEME_LOADED__ 守卫和 SPA 路由已确保不会与后台 UI 冲突
  //   （ensureTopExtras 只加装饰元素；主题渲染器只在对应页面激活）
  void isAdminPath;
  const safeTheme = encodeURIComponent(theme);
  const v = THEME_ASSET_VERSION;
  const themeCss = `<link rel="stylesheet" href="/themes/${safeTheme}/style.css?v=${v}" />`;
  const boot = `<script>window.__THEME__=${JSON.stringify(theme)};window.__THEME_CONFIG__=${JSON.stringify(themeConfig || {})};<\/script>`;
  return html
    .replace(
      // 保留默认 style.css（评论/音乐/弹窗等组件样式打底），在其后追加主题 CSS 覆盖布局与配色
      /(<link rel="stylesheet" href="\/style\.css\?v=[^"]*"[^>]*>)/,
      `$1\n    ${themeCss}`
    )
    .replace(
      /<script src="\/app\.js\?v=[^"]*"><\/script>/,
      `${boot}\n    <script src="/app.js?v=${v}"></script>\n    <script src="/themes/${safeTheme}/theme.js?v=${v}"></script>`
    );
}

/** 站点图标值 → favicon href：URL 直接用；空=默认 lucide pen-nib SVG（不再用 emoji） */
function iconToHref(v: string): string {
  const val = String(v || "").trim();
  if (/^https?:\/\//i.test(val)) return val;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'/><path d='m15 5 4 4'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function serveSsr(
  c: Context<HonoEnv>,
  html: string,
  opts: { title: string; description: string; head: string; body?: string; status?: number }
) {
  // 首屏无闪烁：SSR 时把 favicon 替换为后台配置的站点图标
  const s = await getSettings(c.env.DB);
  // 首屏语言判定：注入内联启动数据，index.html 内联脚本在渲染前据此设置 <html lang>
  const bootLang = detectLang(s, {
    cookie: c.req.header("cookie") || "",
    country: c.req.header("cf-ipcountry") || "",
    acceptLanguage: c.req.header("accept-language") || "",
  });
  const i18nBoot = `<script>window.__I18N_BOOT__=${JSON.stringify({
    enabled: s.i18n_enabled,
    lang: bootLang,
    default: s.i18n_default,
    langs: parseLangs(s),
  })};<\/script>`;
  // 首帧直出：SSR 阶段替换顶栏品牌名/导航文字/头像（后台设置实时生效），
  // 消除「首次访问先显示默认 Nooj Log，设置加载后才变成实际值」的闪现
  const escT = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const navName = escT(s.nav_feeds_name || "首页");
  const out = html
    .replace('<span class="brand-name">Nooj Log</span>', () => `<span class="brand-name">${escT(s.site_title || "Nooj Log")}</span>`)
    .replace('<a href="/" data-route="feed">首页</a>', () => `<a href="/" data-route="feed">${navName}</a>`)
    .replace(/(<a href="\/" data-route="feed">[\s\S]*?<\/svg>\s*)<span>首页<\/span>/, (_m, p1: string) => `${p1}<span>${navName}</span>`)
    .replace(/<span class="brand-avatar">[\s\S]*?<\/span>/, (m: string) => {
      const av = (s.brand_avatar || "").trim();
      return /^https?:\/\//i.test(av) || av.startsWith("/")
        ? `<span class="brand-avatar"><img src="${escT(av)}" alt="" referrerpolicy="no-referrer" /></span>`
        : m;
    })
    .replace(TITLE_TAG, () => `<title>${opts.title}</title>`)
    .replace(DESC_RE, () => `<meta name="description" content="${opts.description.replace(/"/g, "&quot;")}" />`)
    .replace(ICON_RE, () => {
      const href = iconToHref(s.site_icon);
      const type = href.endsWith('.png') ? 'image/png'
        : href.endsWith('.jpg') || href.endsWith('.jpeg') ? 'image/jpeg'
        : href.endsWith('.svg') ? 'image/svg+xml'
        : href.endsWith('.ico') ? 'image/x-icon'
        : 'image/png';
      return `<link rel="icon" type="${type}" href="${href}" />`;
    })
    .replace(HEAD_MARK, () => opts.head)
    .replace(I18N_MARK, () => i18nBoot)
    .replace(APP_MARK, () => `<main id="app" class="page-main">${opts.body ?? ""}</main>`);
  // 主题资源注入（后台路径强制默认主题 UI）
  const themed = applyTheme(out, s.theme, c.req.path === s.admin_path, s.theme_config?.[s.theme]);
  return c.html(themed, (opts.status ?? 200) as 200, {
    "cache-control": "public, max-age=60, stale-while-revalidate=120",
  });
}

app.get("/", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const html = await getIndexHtml(c);
  const image = s.banner_bg_mode === "random"
    ? absoluteUrl(origin, "/api/bg", s.site_domain)
    : /^https?:\/\//i.test(s.banner_bg_image || "")
    ? s.banner_bg_image
    : s.banner_bg_image
      ? absoluteUrl(origin, s.banner_bg_image, s.site_domain)
      : "";
  const head = buildSeoHead(origin, {
    title: s.site_title,
    description: s.site_description || s.essay_subtitle,
    keywords: s.site_keywords,
    path: "/",
    image,
    siteName: s.site_title,
    jsonLd: websiteJsonLd(origin, s),
  });
  const q = (c.req.query("q") || "").trim();
  const feed = await queryFeed(c.env.DB, {
    limit: Number(s.feed_page_size) || 20,
    r2Domain: s.r2_domain,
    b2Domain: s.b2_domain,
    q,
  });
  return serveSsr(c, html, { title: s.site_title, description: s.site_description || s.essay_subtitle, head, body: renderFeedSsr(feed.list, s) });
});

app.get("/posts", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const allPosts = await publishedPosts(c.env.DB);
  const category = (c.req.query("category") as string | undefined || "").trim();
  const validCats = ["开发折腾", "项目展示", "生活日常"];
  const cat = validCats.includes(category) ? category : "";
  const posts = cat ? allPosts.filter(p => p.category === cat) : allPosts;
  const title = cat ? `${cat} · ${s.site_title}` : `文章 · ${s.site_title}`;
  const description = cat ? `${s.site_title} · ${cat}分类，共 ${posts.length} 篇` : `${s.site_title} 的全部文章，共 ${posts.length} 篇`;
  const head = buildSeoHead(origin, {
    title,
    description,
    keywords: s.site_keywords,
    path: "/posts",
    siteName: s.site_title,
    jsonLd: blogJsonLd(origin, s, posts),
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head, body: renderPostsSsr(posts, s.r2_domain, s.b2_domain) });
});

app.get("/about", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const title = `关于 · ${s.site_title}`;
  const description = s.about_signature || s.about_greeting_sub || s.essay_subtitle;
  const image = (s.about_avatar || s.author_avatar || s.brand_avatar || "").trim();
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/about",
    image: image ? absoluteUrl(origin, image, s.site_domain) : undefined,
    siteName: s.site_title,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      name: title,
      description,
      url: origin + "/about",
    },
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head, body: renderAboutSsr(s) });
});

app.get("/photos", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM photos WHERE visible = 1`)
    .first<{ n: number }>();
  const count = Number(countRow?.n ?? 0);
  const title = `相册 · ${s.site_title}`;
  const description = `${s.site_title} 的相册，共 ${count} 张图片`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/photos",
    siteName: s.site_title,
    jsonLd: collectionJsonLd(origin, s, count),
  });
  const html = await getIndexHtml(c);
  // 首屏直出最近 24 张（爬虫/无 JS 环境可直接读到图片与标题；前端 JS 加载后接管）
  const rows = (
    await c.env.DB
      .prepare(
        `SELECT id, src, title, description, sort_order, visible, source_type, source_id, created_at, updated_at
         FROM photos WHERE visible = 1 ORDER BY sort_order ASC, id DESC LIMIT 24`
      )
      .all<PhotoRow>()
  ).results;
  const body = renderPhotosSsr(
    rows.map(r => serializePhoto(r, s.r2_domain, s.b2_domain)),
    count,
    s.r2_domain,
    s.b2_domain
  );
  return serveSsr(c, html, { title, description, head, body });
});

app.get("/links", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM friends WHERE status = 'approved'`).first<{ n: number }>();
  const count = Number(countRow?.n ?? 0);
  const title = `友链 · ${s.site_title}`;
  const description = `${s.site_title} 的友链，共收录 ${count} 个优秀站点`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/links",
    siteName: s.site_title,
    jsonLd: collectionJsonLd(origin, s, count),
  });
  const html = await getIndexHtml(c);
  // 首屏直出已上架友链（爬虫可直接读到站点名/简介/最近更新；前端 JS 加载后接管）
  const rows = s.links_enabled === false
    ? []
    : (
        await c.env.DB
          .prepare(
            `SELECT f.*, lp.last_post_at, lp.last_post_title, lp.last_post_link
             FROM friends f ${LAST_POST_JOIN} WHERE f.status = 'approved'
             ORDER BY f.sort_order ASC, f.id DESC LIMIT 60`
          )
          .all<FriendRow>()
      ).results;
  const cats =
    s.links_enabled === false
      ? []
      : (
          await c.env.DB
            .prepare(`SELECT DISTINCT category FROM friends WHERE status = 'approved' AND category != '' ORDER BY category ASC`)
            .all<{ category: string }>()
        ).results.map(r => r.category);
  const newThisMonth = Number(
    (
      await c.env.DB
        .prepare(
          `SELECT COUNT(*) AS n FROM friends WHERE status = 'approved' AND created_at >= strftime('%Y-%m-01T00:00:00Z','now')`
        )
        .first<{ n: number }>()
    )?.n ?? 0
  );
  const body = renderLinksSsr(rows.map(serializeFriend), { total: count, newThisMonth }, cats);
  return serveSsr(c, html, { title, description, head, body });
});

app.get("/links/apply", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const title = `申请友链 · ${s.site_title}`;
  const description = `向 ${s.site_title} 申请交换友情链接`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/links/apply",
    siteName: s.site_title,
    noindex: true,
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

app.get("/moments", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const title = `动态 · ${s.site_title}`;
  const description = "日常生活碎片，随手记下的心情与片段";
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/moments",
    siteName: s.site_title,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      url: origin + "/moments",
    },
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

app.get("/friends", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const title = `友圈 · ${s.site_title}`;
  const description = "朋友们的最新动态，一起看看圈内最近在忙什么";
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/friends",
    siteName: s.site_title,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      url: origin + "/friends",
    },
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

app.get("/search", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const q = String(c.req.query("q") || "").trim();
  const title = q ? `搜索：${q} · ${s.site_title}` : `搜索 · ${s.site_title}`;
  const description = q ? `关键词「${q}」的搜索结果` : `${s.site_title} 站内搜索`;
  const head = buildSeoHead(origin, {
    title,
    description,
    path: "/search",
    siteName: s.site_title,
    noindex: true, // 搜索页不进索引
  });
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title, description, head });
});

/** 后台入口 HTML：noindex + x-admin-entry 标记（前端据此渲染解锁页；路径本身即凭证）。
 *  首次部署且未设密码时，追加 x-admin-setup=1 标记，前端渲染"设置初始密码"表单。 */
async function serveAdminEntry(c: Context<HonoEnv>, path: string): Promise<Response> {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const needsSetup = !(await hasAdminPassword(c.env.DB, c.env.ADMIN_PASSWORD));
  const head =
    buildSeoHead(origin, {
      title: s.site_title,
      description: "",
      path,
      siteName: s.site_title,
      noindex: true,
    }) +
    '\n    <meta name="x-admin-entry" content="1" />' +
    (needsSetup ? '\n    <meta name="x-admin-setup" content="1" />' : "");
  const html = await getIndexHtml(c);
  return serveSsr(c, html, { title: s.site_title, description: "", head });
}

app.get("/admin", async c => {
  const s = await getSettings(c.env.DB);
  // 已启用秘密入口：已登录管理员跳转到真实入口，其余人得到 404（后台对扫描器隐形）
  if (s.admin_path !== "/admin") {
    if (await isAdmin(c)) return c.redirect(s.admin_path, 302);
    const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
    const head =
      buildSeoHead(origin, {
        title: `页面不存在 · ${s.site_title}`,
        description: "",
        path: "/admin",
        siteName: s.site_title,
        noindex: true,
      }) + '\n    <meta name="x-admin-entry" content="0" />';
    const html = await getIndexHtml(c);
    return serveSsr(c, html, { title: `页面不存在 · ${s.site_title}`, description: "页面不存在", head, status: 404 });
  }
  return serveAdminEntry(c, "/admin");
});

app.get("/post/:slug", async c => {
  const s = await getSettings(c.env.DB);
  const origin = canonicalOrigin(s.site_domain, c.req.url, c.req.header("x-forwarded-proto"));
  const slug = c.req.param("slug");
  const post = await c.env.DB.prepare(`SELECT * FROM posts WHERE slug = ?`).bind(slug).first<PostRow>();

  const html = await getIndexHtml(c);
  if (!post || post.status !== "published") {
    // 不存在/草稿：404 + noindex，前端继续走 SPA（管理员预览靠 ?preview=1 客户端鉴权）
    const head = buildSeoHead(origin, {
      title: `文章不存在 · ${s.site_title}`,
      description: "",
      path: "/post/" + encodeURIComponent(slug),
      siteName: s.site_title,
      noindex: true,
    });
    return serveSsr(c, html, {
      title: `文章不存在 · ${s.site_title}`,
      description: "文章不存在或尚未发布",
      head,
      status: 404,
    });
  }

  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM comments WHERE target_type = 'post' AND target_id = ?`)
    .bind(post.id)
    .first<{ n: number }>();
  const title = `${post.title} · ${s.site_title}`;
  const image = post.cover ? absoluteUrl(origin, keyToSrc(post.cover, s.r2_domain, s.b2_domain), s.site_domain) : "";
  const head = buildSeoHead(origin, {
    title,
    description: post.excerpt,
    path: "/post/" + encodeURIComponent(post.slug),
    image,
    siteName: s.site_title,
    type: "article",
    jsonLd: postJsonLd(origin, s, post),
  });
  const body = renderPostSsr(post, Number(countRow?.n ?? 0), s.video_default_poster, s.r2_domain, s.b2_domain, s.comments_enabled !== false);
  return serveSsr(c, html, { title, description: post.excerpt, head, body });
});

app.notFound(async c => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/media/")) return fail(c, "接口不存在", 404);
  // 秘密后台入口（任意路径的硬加载都进入本应用，
  // 未注册对应路由，因此落到这里）。
  // 前置过滤：仅对「单段、无扩展名」的路径查库，避免每个静态资源请求都打 D1。
  if (
    c.req.method === "GET" &&
    !path.includes(".") &&
    /^\/[a-z0-9-]{3,40}$/i.test(path)
  ) {
    const s = await getSettings(c.env.DB);
    if (s.admin_path === path) return serveAdminEntry(c, path);
  }
  // 非 API：交给 ASSETS（SPA 深链兜底返回 index.html）。
  // 深链（无扩展名路径）按主题注入主题 CSS/JS；静态资源请求不查库直接返回。
  if (c.req.method !== "GET") return c.env.ASSETS.fetch(c.req.raw);
  if (path.includes(".")) return c.env.ASSETS.fetch(c.req.raw);
  const s = await getSettings(c.env.DB);
  if (s.theme !== "default") return getThemedIndexHtml(c, s.theme, s.theme_config?.[s.theme]);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error(`[nooj] ${c.req.method} ${new URL(c.req.url).pathname}`, err);
  // 错误日志入库（异步，不影响错误响应返回）
  try {
    const url = new URL(c.req.url);
    c.executionCtx.waitUntil(
      recordError(c.env.DB, {
        method: c.req.method,
        path: url.pathname,
        message: String((err as Error | undefined)?.message || err || "unknown error"),
        stack: err instanceof Error ? err.stack || "" : "",
      })
    );
  } catch {
    // 日志写入失败不影响主流程
  }
  return fail(c, "服务器开小差了", 500);
});

/* ==================== Cron 定时任务 ====================
 * QQ Cookie 保活：腾讯根据活跃度判定 skey/pskey 有效期，
 * 定时调用 qzone 接口让 Cookie 保持活跃，延长可用时间。
 * 保活间隔在后台「设置 - QQ 昵称资料」中配置（小时）。
 */
async function handleScheduled(env: HonoEnv["Bindings"]): Promise<void> {
  await ensureSchema(env.DB); // cron 作为首个请求建表（全局中间件已移除）
  try {
    const s = await getSettings(env.DB);

    // 可用性监控：按后台配置的检测间隔执行（默认 5 分钟），未到期则跳过
    let siteUrl = (s.site_domain || "").trim();
    if (siteUrl && !/^https?:\/\//i.test(siteUrl)) siteUrl = "https://" + siteUrl;
    if (siteUrl) {
      const intervalMin = Math.max(1, Math.min(720, parseInt(s.uptime_check_interval, 10) || 5));
      const last = await env.DB.prepare(
        `SELECT created_at FROM uptime_log ORDER BY id DESC LIMIT 1`
      ).first<{ created_at: string }>();
      const lastTs = last?.created_at ? new Date(last.created_at).getTime() : 0;
      if (!lastTs || Date.now() - lastTs >= intervalMin * 60_000) {
        try {
          await runUptimeCheck(env.DB, siteUrl, s.notify_system ? s.security_webhook_url : "");
        } catch (e) {
          console.error("[uptime] check failed:", e);
        }
      }
    }

    // 随机背景时间桶预热：开启随机横幅或全站背景图时，提前抓图入 R2，访客不撞冷启动
    try {
      await preheatBg(env);
    } catch (e) {
      console.error("[bg-preheat] error:", e);
    }

    // 头像补偿：每 10 分钟重试近期头像拉取失败的评论（境外网络拉国内头像 API 偶发超时）
    try {
      const avLastRow = await env.DB.prepare(
        `SELECT value FROM kv_store WHERE key = 'avatar_backfill_last'`
      ).first<{ value: string }>();
      const avLastTs = avLastRow?.value ? new Date(avLastRow.value).getTime() : 0;
      if (Date.now() - avLastTs >= 10 * 60_000) {
        const { backfillMissingAvatars } = await import("./avatar");
        const r = await backfillMissingAvatars(env.R2, env.DB, s);
        await env.DB.prepare(
          `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).bind("avatar_backfill_last", new Date().toISOString()).run();
        if (r.checked > 0) {
          console.log(`[avatar-backfill] checked=${r.checked} fixed=${r.fixed}`);
        }
      }
    } catch (e) {
      console.error("[avatar-backfill] error:", e);
    }

    // 友圈抓取：每小时一轮，每轮最多 10 个源（kv 游标跨轮轮转覆盖全部源）
    try {
      if (s.friends_fetch_enabled) {
        const ffRow = await env.DB.prepare(
          `SELECT value FROM kv_store WHERE key = 'friends_fetch_last'`
        ).first<{ value: string }>();
        const ffLast = ffRow?.value ? new Date(ffRow.value).getTime() : 0;
        if (Date.now() - ffLast >= 60 * 60_000) {
          const { runFriendsFetch } = await import("./friendfeed");
          const r = await runFriendsFetch(env, { limit: 10 });
          await env.DB.prepare(
            `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).bind("friends_fetch_last", new Date().toISOString()).run();
          if (r.fetched > 0) {
            console.log(`[friends-fetch] fetched=${r.fetched} ok=${r.ok}`);
          }
        }
      }
    } catch (e) {
      console.error("[friends-fetch] error:", e);
    }

    if (!s.qq_ckqq || !s.qq_pskey) return; // 未配置 QQ Cookie，跳过

    // 检查上次保活时间，避免过于频繁调用
    const lastKey = "qq_keepalive_last";
    const lastRow = await env.DB.prepare(
      `SELECT value FROM kv_store WHERE key = ?`
    ).bind(lastKey).first<{ value: string }>();
    const lastTime = lastRow?.value ? new Date(lastRow.value).getTime() : 0;
    const intervalHours = Math.max(1, Math.min(72, parseInt(s.qq_keepalive_interval, 10) || 6));
    const intervalMs = intervalHours * 60 * 60 * 1000;
    if (Date.now() - lastTime < intervalMs) return; // 未到间隔时间

    // 直接请求腾讯 Qzone 接口保活（Cookie 活跃检测）
    const { checkQqCookie } = await import("./routes/misc");
    const r = await checkQqCookie(s);

    // 记录本次保活时间
    await env.DB.prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(lastKey, new Date().toISOString()).run();

    if (!r.ok) {
      console.error(`[qq-keepalive] Cookie 失效: ${r.msg}`);
      // Cookie 失效时发 Webhook 告警（同一轮故障 60 分钟内去重；走「系统事件」开关）
      if (s.security_webhook_url && s.notify_system) {
        const alertKey = "qq_cookie_alert_last";
        const alertRow = await env.DB.prepare(
          `SELECT value FROM kv_store WHERE key = ?`
        ).bind(alertKey).first<{ value: string }>();
        const alertTime = alertRow?.value ? new Date(alertRow.value).getTime() : 0;
        if (Date.now() - alertTime >= 60 * 60 * 1000) {
          const { notify } = await import("./security");
          await notify(
            s,
            "system",
            "⚠️ QQ Cookie 已失效",
            `保活检测失败：${r.msg}\n请重新登录 QQ 获取新 Cookie，否则评论者昵称将无法自动获取。`
          );
          await env.DB.prepare(
            `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).bind(alertKey, new Date().toISOString()).run();
        }
      }
    } else {
      console.log(`[qq-keepalive] ok interval=${intervalHours}h`);
    }
  } catch (e) {
    console.error("[qq-keepalive] error:", e);
  }
}

export { app, handleScheduled };
