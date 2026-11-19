/**
 * SEO / SSR：
 * - buildSeoHead：根据路由生成 canonical / Open Graph / Twitter Card / robots / JSON-LD
 * - renderPostSsr：文章详情服务端直出 HTML（搜索引擎可直接收录正文）
 * - robots / sitemap / rss
 */
import type { SiteSettings } from "./settings";
import type { FeedItem, PostRow } from "./db";
import { keyToSrc, serializePost } from "./db";
import { renderMarkdownSafe } from "./markdown";

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escAttr = esc;

/** 站内相对路径 → 绝对 URL（图片 key/相对路径均可）。
 *  siteDomain 有值时优先用它（换域名后 SEO/RSS/OG 链接自动跟随），否则用请求 origin。 */
export function absoluteUrl(origin: string, src: string, siteDomain?: string): string {
  if (!src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  const base = (siteDomain || origin).replace(/\/$/, "");
  return base + (src.startsWith("/") ? src : "/" + src);
}

/** 请求 origin 清洗：反代（宝塔 Nginx）下 TLS 在代理终结，Worker 收到的常是
 *  http://host:443 —— 按端口还原协议并剥掉默认端口，尊重 X-Forwarded-Proto。 */
export function sanitizeOrigin(reqUrl: string, forwardedProto?: string): string {
  try {
    const u = new URL(reqUrl);
    if (u.port === "443") return `https://${u.hostname}`;
    if (u.port === "80") return `http://${u.hostname}`;
    const proto = (forwardedProto || "").split(",")[0].trim().toLowerCase();
    if (proto === "https" && u.protocol === "http:") return `https://${u.host}`;
    return u.origin;
  } catch {
    return reqUrl;
  }
}

/** 规范站点 origin（robots/sitemap/rss/canonical/OG 等绝对 URL 的根）。
 *  优先后台 site_domain（换域名只改后台，SEO 链接自动跟随）；留空时清洗请求 origin。 */
export function canonicalOrigin(siteDomain: string, reqUrl: string, forwardedProto?: string): string {
  const d = (siteDomain || "").trim().replace(/\/+$/, "");
  if (d) return /^https?:\/\//i.test(d) ? d : `https://${d}`;
  return sanitizeOrigin(reqUrl, forwardedProto);
}

export interface SeoHeadOptions {
  title: string; // 完整标题（已含站名后缀）
  description?: string;
  keywords?: string; // SEO keywords（逗号分隔），空=不输出
  path: string; // canonical 路径，如 /post/xxx
  image?: string; // og 图（绝对 URL）
  siteName?: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
}

/** 注入 index.html 的 <!--SSR_HEAD--> 位置（title/description 在 index.ts 中单独替换） */
export function buildSeoHead(origin: string, o: SeoHeadOptions): string {
  const url = origin + o.path;
  const tags: string[] = [`<link rel="canonical" href="${escAttr(url)}" />`];
  if (o.noindex) {
    tags.push(`<meta name="robots" content="noindex,nofollow,noarchive" />`);
    return tags.join("\n    ");
  }
  const type = o.type || "website";
  tags.push(`<meta property="og:type" content="${type}" />`);
  if (o.keywords) tags.push(`<meta name="keywords" content="${escAttr(o.keywords)}" />`);
  tags.push(`<meta property="og:title" content="${escAttr(o.title)}" />`);
  if (o.description) tags.push(`<meta property="og:description" content="${escAttr(o.description)}" />`);
  tags.push(`<meta property="og:url" content="${escAttr(url)}" />`);
  tags.push(`<meta property="og:site_name" content="${escAttr(o.siteName || "Nooj Log")}" />`);
  if (o.image) tags.push(`<meta property="og:image" content="${escAttr(o.image)}" />`);
  tags.push(`<meta name="twitter:card" content="${o.image ? "summary_large_image" : "summary"}" />`);
  tags.push(`<meta name="twitter:title" content="${escAttr(o.title)}" />`);
  if (o.description) tags.push(`<meta name="twitter:description" content="${escAttr(o.description)}" />`);
  if (o.image) tags.push(`<meta name="twitter:image" content="${escAttr(o.image)}" />`);
  if (o.jsonLd) {
    tags.push(
      `<script type="application/ld+json" id="ssr-jsonld">${JSON.stringify(o.jsonLd)}</script>`
    );
  }
  return tags.join("\n    ");
}

/** 站点级 JSON-LD（首页 WebSite 实体 + 站内搜索占位） */
export function websiteJsonLd(origin: string, s: SiteSettings) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: s.site_title,
    description: s.site_description || s.essay_subtitle,
    url: origin + "/",
  };
}

export function blogJsonLd(origin: string, s: SiteSettings, posts: { slug: string; title: string; updated_at: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${s.site_title} · 文章`,
    url: origin + "/posts",
    blogPost: posts.map(p => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: origin + "/post/" + encodeURIComponent(p.slug),
      dateModified: p.updated_at,
    })),
  };
}

export function collectionJsonLd(origin: string, s: SiteSettings, count: number) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${s.site_title} · 相册`,
    description: `相册共 ${count} 张图片`,
    url: origin + "/photos",
  };
}

/* ==================== 文章详情直出 ==================== */

export function postJsonLd(origin: string, s: SiteSettings, post: PostRow) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    url: origin + "/post/" + encodeURIComponent(post.slug),
    datePublished: post.created_at,
    dateModified: post.updated_at,
    author: { "@type": "Person", name: s.author_name || s.site_title },
    publisher: { "@type": "Person", name: s.author_name || s.site_title },
    mainEntityOfPage: { "@type": "WebPage", "@id": origin + "/post/" + encodeURIComponent(post.slug) },
  };
  if (post.cover) data.image = absoluteUrl(origin, keyToSrc(post.cover, s.r2_domain, s.b2_domain), s.site_domain);
  return data;
}

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch {
    return iso;
  }
};

/** 与前端 .article-card 结构一致，data-ssr-post 供前端水合时识别（避免重绘闪烁） */
const PIN_BADGE =
  '<span class="top-badge"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg><span>置顶</span></span>';

export function renderPostSsr(row: PostRow, commentCount: number, defaultPoster = "", r2Domain?: string, b2Domain?: string, commentsEnabled = true): string {
  const p = serializePost(row, true, r2Domain, b2Domain);
  const body = renderMarkdownSafe(row.content_md || "", defaultPoster, r2Domain, b2Domain);
  // 全站评论关闭（备案模式）：SSR 直出中彻底移除评论区，保证源码/蜘蛛也看不到
  const commentSection = commentsEnabled
    ? `<section class="article-comments" data-comment-section>
            <h3 class="comment-section-title">评论<span class="comment-count-badge" data-article-comments-count>${commentCount || ""}</span></h3>
            <div class="comment-list" data-comment-list><span class="spinner"></span></div>
            <form class="comment-form-wrap comment-form-inline" data-comment-form data-ctype="post" data-cid="${p.id}" data-slug="${escAttr(p.slug)}">
              <div class="comment-form-row comment-user-row">
                <span class="qq-avatar" data-qq-avatar>?</span>
                <input name="nickname" placeholder="昵称或 QQ 号（填 QQ 号自动获取昵称邮箱头像）" maxlength="20" required autocomplete="off" />
              </div>
              <div class="comment-form-row">
                <input name="email" type="email" placeholder="邮箱 *" maxlength="100" required />
                <input name="website" placeholder="网址（选填，头像可点击跳转）" maxlength="200" />
              </div>
              <textarea name="content" placeholder="说点什么…（支持 @ 提及他人）" maxlength="500" required style="min-height:100px"></textarea>
              <div class="comment-form-foot">
                <button class="btn primary" type="submit">发表评论</button>
              </div>
            </form>
          </section>`
    : "";
  return `
      <div class="essay">
        <div class="post-layout">
        <div class="article-card" data-ssr-post="${escAttr(p.slug)}">
          <a class="article-back" href="/" title="返回首页">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"></path></svg>
            返回首页
          </a>
          <h1>${p.pinned ? PIN_BADGE : ""}${esc(p.title)}${p.status === "draft" ? '<span class="draft-tag">草稿</span>' : ""}</h1>
          <div class="article-meta"><time datetime="${escAttr(p.created_at)}">${esc(fmtDate(p.created_at))}</time></div>
          <div class="article-body">${body}</div>
          <div class="article-actions"><a class="btn" href="/posts">返回列表</a></div>
          ${commentSection}
        </div>
        </div>
      </div>`;
}

/* ==================== 列表页 / 首页 / 关于页 直出 ==================== */

/** 文章列表 SSR：与前端 .post-item 结构对齐，蜘蛛无需执行 JS 也能抓到文章入口 */
export function renderPostsSsr(posts: PostRow[], r2Domain?: string, b2Domain?: string): string {
  const items = posts
    .map(row => {
      const p = serializePost(row, false, r2Domain, b2Domain);
      const cover = p.cover
        ? `<img class="cover" src="${escAttr(p.cover)}" alt="${escAttr(p.title)}" loading="lazy" referrerpolicy="no-referrer" />`
        : "";
      return `<a class="post-item${p.pinned ? " post-item--pinned" : ""}" href="/post/${encodeURIComponent(p.slug)}">
        ${cover}
        <div class="info">
          <h3>${p.pinned ? PIN_BADGE : ""}${esc(p.title)}</h3>
          ${p.excerpt ? `<p class="excerpt">${esc(p.excerpt)}</p>` : ""}
          <div class="date"><time datetime="${escAttr(p.created_at)}">${esc(fmtDate(p.created_at))}</time></div>
        </div>
      </a>`;
    })
    .join("");
  return `<div class="essay"><div class="posts-wrap">${items || `<div class="essay-empty">暂无文章</div>`}</div></div>`;
}

/** 首页混合时间线 SSR：输出最近说说 + 文章的标题/摘要/正文/图片，供蜘蛛直接读取 */
export function renderFeedSsr(items: FeedItem[], s: SiteSettings): string {
  const author = esc(s.author_name || s.site_title || "Nooj Log");
  const html = items
    .map(item => {
      const time = `<time datetime="${escAttr(item.created_at)}">${esc(fmtDate(item.created_at))}</time>`;
      if (item.kind === "post") {
        const cover = item.cover
          ? `<div class="bber-post-cover"><img src="${escAttr(item.cover)}" alt="${escAttr(item.title)}" loading="lazy" referrerpolicy="no-referrer" /></div>`
          : "";
        return `<li class="bber-item bber-item--post${item.pinned ? " bber-item--pinned" : ""}">
          <a class="bber-post-link" href="/post/${encodeURIComponent(item.slug)}">
            <div class="bber-author-row"><span class="bber-author"><span class="bber-author-nickname">文章</span></span>${item.pinned ? PIN_BADGE : ""}</div>
            ${cover}
            <div class="bber-post-title">${esc(item.title)}</div>
            ${item.excerpt ? `<div class="bber-post-excerpt">${esc(item.excerpt)}</div>` : ""}
            <hr /><div class="bber-bottom"><div class="bber-info"><div class="bber-info-time">${time}</div></div></div>
          </a>
        </li>`;
      }
      const body = renderMarkdownSafe(item.content || "", s.video_default_poster, s.r2_domain, s.b2_domain);
      const images = (item.images || [])
        .slice(0, 9)
        .map(src => `<img src="${escAttr(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`)
        .join("");
      const videos = (item.videos || [])
        .map(v => {
          if (v.kind === "embed") return "";
          const src = v.src || "";
          if (!src) return "";
          const poster = v.poster ? ` poster="${escAttr(v.poster)}"` : "";
          return `<video src="${escAttr(src)}"${poster} controls preload="none" playsinline></video>`;
        })
        .join("");
      return `<li class="bber-item bber-item--moment">
        <div class="bber-content">
          <div class="bber-author-row"><span class="bber-author"><span class="bber-author-nickname">${author}</span></span><span class="bber-post-tag bber-post-tag--moment">说说</span></div>
          <div class="datacont"><div class="m-xlate-content">${body}</div>${videos}</div>
          ${images ? `<div class="bber-images">${images}</div>` : ""}
        </div>
        <hr /><div class="bber-bottom"><div class="bber-info"><div class="bber-info-time">${time}</div>${item.location ? `<div class="bber-info-from">${esc(item.location)}</div>` : ""}</div></div>
      </li>`;
    })
    .join("");
  return `<div class="essay"><div class="essay-list-container"><div class="essay-content-wrapper"><section class="timeline"><ul id="waterfall" class="list ssr-feed-list" data-ssr-list>${html}</ul></section></div></div></div>`;
}

/** 关于页 SSR：后台关于文案直出，避免 /about 落到 SPA 空壳 */
export function renderAboutSsr(s: SiteSettings): string {
  const rows = (raw: string) =>
    String(raw || "")
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.split("|").map(cell => cell.trim()));
  const name = esc(s.author_name || s.site_title || "Nooj Log");
  const avatar = (s.about_avatar || s.author_avatar || s.brand_avatar || "").trim();
  const avatarHtml = avatar
    ? `<img class="about-avatar-img" src="${escAttr(avatar)}" alt="${name}" referrerpolicy="no-referrer" />`
    : "";
  const stats = rows(s.about_stats)
    .map(r => `<div class="about-stat-mini"><span class="about-stat-mini-num">${esc(r[1] || "")}</span><span class="about-stat-mini-label">${esc(r[0] || "")}</span>${r[2] ? `<span class="about-stat-mini-desc">${esc(r[2])}</span>` : ""}</div>`)
    .join("");
  const timeline = rows(s.about_timeline)
    .map(r => `<div class="about-tl-item"><div class="about-tl-dot"></div><div class="about-tl-body"><div class="about-tl-date">${esc(r[0] || "")}</div><div class="about-tl-title">${esc(r[1] || "")}</div>${r[2] ? `<div class="about-tl-desc">${esc(r[2])}</div>` : ""}</div></div>`)
    .join("");
  const big = rows(s.about_bigstats)
    .map(r => `<div class="about-big-item"><div class="about-big-num">${esc(r[0] || "")}</div><div class="about-big-label">${esc(r[1] || "")}</div></div>`)
    .join("");
  const contacts = rows(s.about_contacts)
    .map(r => {
      const inner = `<span class="about-contact-type">${esc(r[0] || "")}</span><span class="about-contact-val">${esc(r[1] || "")}</span>`;
      return r[2] ? `<a class="about-contact-item" href="${escAttr(r[2])}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>` : `<div class="about-contact-item">${inner}</div>`;
    })
    .join("");
  return `<div class="essay"><div class="about-wrap">
    <section class="about-card about-head">
      <div class="about-greet"><h1>${esc(s.about_greeting || "先认识一下，再慢慢读。")}</h1>${s.about_greeting_sub ? `<p class="about-greet-sub">${esc(s.about_greeting_sub)}</p>` : ""}</div>
      <div class="about-author"><div class="about-avatar">${avatarHtml}</div><div class="about-author-info"><div class="about-author-name">${name}</div>${s.about_signature ? `<div class="about-author-sign">${esc(s.about_signature)}</div>` : ""}</div></div>
    </section>
    ${stats ? `<aside class="about-card about-stats-aside"><div class="about-card-title">一些数字</div><div class="about-stats-mini">${stats}</div></aside>` : ""}
    <section class="about-card about-bio${stats ? " has-aside" : ""}"><div class="about-bio-main"><h2 class="about-card-title">关于我</h2><div class="article-body">${renderMarkdownSafe(s.about_bio || "", s.video_default_poster, s.r2_domain, s.b2_domain)}</div></div></section>
    ${timeline ? `<section class="about-card about-tl"><h2 class="about-card-title">时间线</h2><div class="about-timeline">${timeline}</div></section>` : ""}
    ${big ? `<section class="about-card about-big"><div class="about-card-title">累计记录</div><div class="about-big-grid">${big}</div></section>` : ""}
    ${contacts ? `<section class="about-card about-contact"><h2 class="about-card-title">联系我</h2><div class="about-contact-list">${contacts}</div></section>` : ""}
  </div></div>`;
}

/* ==================== 相册 / 友链 首屏直出 ====================
 * 这两页原本纯前端渲染，爬虫拿到空 <main>。此处按 nooj 主题的类名直出第一屏，
 * 前端 JS 加载后会接管并用接口数据整体替换，因此只需保证结构与样式一致。
 */

/** 缩略图推导：站内资源（/media/ 或 R2/B2 直连域名）把扩展名换成 _w1200.jpg；GIF / 外链原样 */
function ssrThumb(src: string, r2Domain = "", b2Domain = ""): string {
  if (!src) return "";
  const r2 = r2Domain.replace(/\/$/, "");
  const b2 = b2Domain.replace(/\/$/, "");
  const local = src.includes("/media/") || (!!r2 && src.startsWith(r2 + "/")) || (!!b2 && src.startsWith(b2 + "/"));
  if (!local) return src;
  if (src.includes("_w1200.")) return src;
  if (/\.gif(?:$|[?#])/i.test(src)) return src;
  return src.replace(/\.([^.]+)$/, "_w1200.jpg");
}

/** 相册首屏：.nj-gallery + .nj-photo，结构与主题 photos() 对齐 */
export function renderPhotosSsr(
  list: Array<{ src: string; title?: string }>,
  total: number,
  r2Domain = "",
  b2Domain = ""
): string {
  const items = list
    .map(p => {
      const thumb = ssrThumb(p.src, r2Domain, b2Domain);
      const orig = p.src;
      return `<a class="nj-photo" data-lightbox="${escAttr(orig)}" rel="external nofollow noreferrer">
        <img src="${escAttr(thumb)}" alt="${escAttr(p.title || "")}" loading="lazy" referrerpolicy="no-referrer"${
          thumb !== orig ? ` data-orig="${escAttr(orig)}"` : ""
        } />
        ${p.title ? `<span class="nj-photo-cap">${esc(p.title)}</span>` : ""}
      </a>`;
    })
    .join("");
  return `<div class="nj-wrap">
    <header class="nj-page-head">
      <div class="nj-page-head-main">
        <span class="nj-kicker">GALLERY</span>
        <h1>相册</h1>
        <p>共 ${total} 张图片</p>
      </div>
    </header>
    ${items ? `<div class="nj-gallery">${items}</div>` : `<div class="essay-empty">相册还是空的</div>`}
  </div>`;
}

/** 友链首屏：.nj-link-grid + .nj-link-card，结构与主题 links() 对齐 */
export function renderLinksSsr(
  list: Array<{
    name: string;
    url: string;
    avatar?: string;
    description?: string;
    feed_url?: string;
    feed_status?: string;
    last_post_at?: string;
    last_post_title?: string;
    last_post_link?: string;
  }>,
  stats: { total: number; newThisMonth: number },
  categories: string[] = []
): string {
  const domainOf = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const avatarOf = (name: string, url?: string) => {
    const initial = (name || "?").trim().charAt(0).toUpperCase();
    const img = url
      ? `<img src="${escAttr(url)}" alt="${escAttr(name)}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
      : "";
    const fb = `<span class="links-avatar-fb" style="${url ? "display:none" : "display:flex"}">${esc(initial)}</span>`;
    return `<div class="links-avatar">${img}${fb}</div>`;
  };
  // 与前端 friendLastPostHtml 文案一致（默认中文），前端接管后按语言设置再刷新
  const lastPostOf = (f: (typeof list)[number]) => {
    if (!f.feed_url) {
      return `<div class="links-card-update is-unsubscribed"><span class="links-card-update-text">未接入友圈</span></div>`;
    }
    if (!f.last_post_at) {
      const st = String(f.feed_status || "");
      if (st && st !== "ok") {
        return `<div class="links-card-update is-error"><span class="links-card-update-text">抓取异常</span></div>`;
      }
      return `<div class="links-card-update is-pending"><span class="links-card-update-text">等待抓取</span></div>`;
    }
    const ts = Date.parse(f.last_post_at);
    if (!Number.isFinite(ts)) return "";
    const days = Math.floor((Date.now() - ts) / 864e5);
    let cls = "";
    let text = "";
    if (days <= 0) {
      cls = " is-today";
      text = "今天更新";
    } else if (days === 1) {
      text = "昨天更新";
    } else if (days <= 30) {
      text = `${days} 天前更新`;
    } else {
      cls = " is-stale";
      text = "超过 1 个月未更新";
    }
    const post = f.last_post_title
      ? `<span class="links-card-post" data-post-link="${escAttr(f.last_post_link || "")}" title="${escAttr(f.last_post_title)}">《${esc(f.last_post_title)}》</span>`
      : "";
    return `<div class="links-card-update${cls}"><span class="links-card-update-text">${text}</span>${post}</div>`;
  };
  const cards = list
    .map(
      f => `<a class="nj-link-card" href="${escAttr(f.url)}" target="_blank" rel="noopener noreferrer nofollow">
        <span class="nj-link-head">
          <span class="nj-link-avatar">${avatarOf(f.name, f.avatar)}</span>
          <span class="nj-link-id">
            <span class="nj-link-name">${esc(f.name)}</span>
            <span class="nj-link-domain">${esc(domainOf(f.url))}</span>
          </span>
          <span class="nj-link-arrow"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></span>
        </span>
        <span class="nj-link-desc">${esc(f.description || "这个人很懒，什么都没写")}</span>
        ${lastPostOf(f)}
      </a>`
    )
    .join("");
  const chips = ["全部", ...categories]
    .map(
      (c, i) =>
        `<a class="nj-chip${i === 0 ? " is-active" : ""}" href="${i === 0 ? "/links" : "/links?category=" + encodeURIComponent(c)}">${esc(c)}</a>`
    )
    .join("");
  return `<div class="nj-wrap">
    <header class="nj-page-head">
      <div class="nj-page-head-main">
        <span class="nj-kicker">BLOGROLL</span>
        <h1>朋友们</h1>
        <p>${stats.total} 个站点 · 本月新增 ${stats.newThisMonth} 个</p>
      </div>
      <a class="nj-btn" href="/links/apply">申请友链</a>
    </header>
    <div class="nj-chips">${chips}</div>
    ${cards ? `<div class="nj-link-grid">${cards}</div>` : `<div class="essay-empty">还没有友链</div>`}
  </div>`;
}

/* ==================== robots / sitemap / rss ==================== */

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /sys-",
    "Disallow: /api/",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(origin: string, posts: PostRow[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  const add = (loc: string, priority: string, changefreq: string, lastmod?: string) => {
    lines.push("  <url>");
    lines.push(`    <loc>${esc(loc)}</loc>`);
    if (lastmod) lines.push(`    <lastmod>${esc(lastmod)}</lastmod>`);
    lines.push(`    <changefreq>${changefreq}</changefreq>`);
    lines.push(`    <priority>${priority}</priority>`);
    lines.push("  </url>");
  };
  add(origin + "/", "1.0", "daily");
  add(origin + "/posts", "0.8", "weekly");
  add(origin + "/photos", "0.7", "weekly");
  add(origin + "/about", "0.6", "monthly");
  add(origin + "/links", "0.6", "weekly");
  for (const p of posts) {
    add(origin + "/post/" + encodeURIComponent(p.slug), "0.9", "monthly", p.updated_at);
  }
  lines.push("</urlset>");
  return lines.join("\n");
}

export function rssXml(origin: string, s: SiteSettings, posts: PostRow[]): string {
  const items = posts
    .map(p => {
      const desc = esc(p.excerpt || "");
      const cover = p.cover ? `<p><img src="${esc(absoluteUrl(origin, keyToSrc(p.cover, s.r2_domain, s.b2_domain), s.site_domain))}" alt="${esc(p.title)}" /></p>` : "";
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(origin + "/post/" + encodeURIComponent(p.slug))}</link>
      <guid isPermaLink="true">${esc(origin + "/post/" + encodeURIComponent(p.slug))}</guid>
      <pubDate>${esc(new Date(p.updated_at).toUTCString())}</pubDate>
      <description><![CDATA[${cover}${desc}]]></description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(s.site_title)}</title>
    <link>${esc(origin)}/</link>
    <description>${esc(s.essay_subtitle)}</description>
    <language>zh-CN</language>
${items}
  </channel>
</rss>`;
}
