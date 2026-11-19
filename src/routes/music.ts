
/**
 * 音乐路由 = 网易云解析代理（/163 系列，旧文章 [music=纯数字] 卡片用）
 *          + 中央音乐库代理（music-api 服务，[music=tN] / 胶囊歌单 / 后台曲库管理）
 *
 * GET /api/music/163/playlist?id=xxx
 *   → { id, name, cover, creator, songs: [{ id, name, artist, pic, duration }], total }
 *
 * GET /api/music/163?id=xxx
 *   → { url, title, artist, cover, available, proxied? }
 *   优先用网易云官方 outer URL 302 重定向拿 CDN 直链；
 *   若官方返回 404（VIP/下架/区域限制），降级为同源流代理
 *   （/api/music/163/stream?id= 让 <audio> 走后端转发）。
 *
 * GET /api/music/163/stream?id=xxx
 *   → 音频二进制流（Content-Type: audio/mpeg），供 <audio> 直接播放。
 *
 * GET /api/music/163/lyric?id=xxx
 *   → { lyric: "LRC 原文" }（无歌词时为空字符串）
 */
import { Hono } from "hono";
import { ok, fail } from "../respond";
import type { HonoEnv } from "../types";
import type { Context } from "hono";
import { requireAdmin } from "../auth";
import { getSettings } from "../settings";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const app = new Hono<HonoEnv>();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/* ---------- 解析结果内存缓存（跨访客复用，避免每次都请求外部接口导致卡片水合慢） ----------
 * 歌曲元信息（歌名/歌手/封面）几乎不变：24h；
 * CDN 播放地址会过期：20min；
 * 下架/无版权：负缓存 1h，期间不再重复探测。 */
type CacheEntry<T> = { data: T; ts: number };
const metaCache = new Map<string, CacheEntry<{ title: string; artist: string; cover: string; found: boolean }>>();
const urlCache = new Map<string, CacheEntry<string>>();
const lyricCache = new Map<string, CacheEntry<string>>();
const negCache = new Map<string, number>();
const META_TTL = 24 * 60 * 60 * 1000;
const URL_TTL = 20 * 60 * 1000;
const LYRIC_TTL = 24 * 60 * 60 * 1000;
const NEG_TTL = 60 * 60 * 1000;

function cacheGet<T>(m: Map<string, CacheEntry<T>>, key: string, ttl: number): T | undefined {
  const hit = m.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > ttl) {
    m.delete(key);
    return undefined;
  }
  return hit.data;
}

function cacheSet<T>(m: Map<string, CacheEntry<T>>, key: string, data: T) {
  m.set(key, { data, ts: Date.now() });
}

/** 通过网易云 outer URL 302 重定向获取真实 CDN 播放地址 */
async function getOuterUrl(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://music.163.com/song/media/outer/url?id=${id}.mp3`, {
      headers: { "User-Agent": UA, Referer: "https://music.163.com/" },
      redirect: "manual",
    });
    const location = res.headers.get("location") || res.headers.get("Location") || "";
    if (res.status === 302 && location && !location.endsWith("/404")) {
      return location.replace(/^http:/, "https:");
    }
  } catch {
    // 忽略，走降级
  }
  return null;
}

/** http 资源升级为 https（HTTPS 页面混合内容会被浏览器拦截） */
function toHttps(url: string): string {
  return url ? url.replace(/^http:\/\//i, "https://") : "";
}

/** 获取歌曲元信息（歌名/歌手/封面）；found=false 表示歌曲已下架/ID 无效 */
async function getSongMeta(
  id: string
): Promise<{ title: string; artist: string; cover: string; found: boolean }> {
  try {
    const res = await fetch(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(`[${id}]`)}`,
      { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
    );
    const data = (await res.json()) as {
      songs?: Array<{
        name?: string;
        artists?: Array<{ name?: string }>;
        album?: { picUrl?: string };
      }>;
    };
    const s = data.songs?.[0];
    if (!s?.name) return { title: "", artist: "", cover: "", found: false };
    return {
      title: s.name,
      artist: s.artists?.map(a => a.name).filter(Boolean).join(" / ") || "未知歌手",
      cover: toHttps(s.album?.picUrl || ""),
      found: true,
    };
  } catch {
    return { title: "", artist: "", cover: "", found: false };
  }
}

interface PlaylistSong {
  id: number;
  name: string;
  artist: string;
  pic: string;
  duration: number;
}

function normalizeTrack(t: Record<string, unknown>): PlaylistSong | null {
  const id = Number(t.id);
  const name = String(t.name ?? "");
  if (!id || !name) return null;
  const artists = Array.isArray(t.artists) ? (t.artists as Array<{ name?: string }>) : [];
  const album = (t.album as { name?: string; picUrl?: string } | undefined) || {};
  return {
    id,
    name,
    artist: artists.map(a => a.name).filter(Boolean).join(" / ") || "未知歌手",
    pic: toHttps(album.picUrl || ""),
    duration: Number(t.duration ?? 0),
  };
}

/** 歌单只返回 trackIds 时，用 song/detail 批量补齐歌曲信息（每批 100） */
async function getTracksByIds(ids: number[]): Promise<PlaylistSong[]> {
  const songs: PlaylistSong[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetch(
        `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(chunk))}`,
        { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
      );
      const data = (await res.json()) as { songs?: Array<Record<string, unknown>> };
      for (const t of data.songs || []) {
        const song = normalizeTrack(t);
        if (song) songs.push(song);
      }
    } catch {
      // 单批失败不影响其他批次
    }
  }
  return songs;
}

/** 获取 LRC 歌词原文 */
async function getLyric(id: string): Promise<string> {
  const res = await fetch(
    `https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`,
    { headers: { "User-Agent": UA, Referer: "https://music.163.com/" } }
  );
  const data = (await res.json()) as { lrc?: { lyric?: string }; nolyric?: boolean };
  if (data.nolyric) return "";
  return data.lrc?.lyric || "";
}

/** 获取歌单详情 */
async function getPlaylistDetail(id: string): Promise<{
  id: number;
  name: string;
  cover: string;
  creator: string;
  songs: PlaylistSong[];
}> {
  const res = await fetch(
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000`,
    { headers: { "User-Agent": UA, Referer: "https://music.163.com/", Cookie: `NMTID=${Math.random().toString(36).slice(2)}` } }
  );
  const data = (await res.json()) as {
    code: number;
    playlist?: {
      id?: number;
      name?: string;
      coverImgUrl?: string;
      creator?: { nickname?: string };
      tracks?: Array<Record<string, unknown>>;
      trackIds?: Array<{ id: number }>;
    };
  };
  const pl = data.playlist;
  if (!pl || data.code !== 200) {
    throw new Error("歌单不存在或解析失败");
  }

  // v6 内联 tracks 只含前若干首，完整列表在 trackIds；优先用 trackIds 逐首补齐
  const ids = Array.isArray(pl.trackIds) ? pl.trackIds.map(t => t.id).filter(Boolean) : [];
  let songs: PlaylistSong[];
  if (ids.length > 0) {
    songs = await getTracksByIds(ids);
  } else {
    songs = (pl.tracks || [])
      .map(normalizeTrack)
      .filter((s): s is PlaylistSong => s !== null);
  }

  return {
    id: pl.id || Number(id),
    name: pl.name || "未知歌单",
    cover: toHttps(pl.coverImgUrl || ""),
    creator: pl.creator?.nickname || "",
    songs,
  };
}

/** 解析歌曲播放地址：GET /api/music/163?id=xxx */
app.get("/163", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌曲 ID", 400);

  // 负缓存命中：短时间内重复请求下架/无版权歌曲直接返回，不再探测
  const negTs = negCache.get(id);
  if (negTs && Date.now() - negTs < NEG_TTL) {
    return ok(
      c,
      { url: "", title: "", artist: "", cover: "", available: false },
      "歌曲不可用（已下架或版权限制）"
    );
  }

  let meta = cacheGet(metaCache, id, META_TTL);
  if (!meta) {
    meta = await getSongMeta(id);
    if (meta.found) cacheSet(metaCache, id, meta);
    else negCache.set(id, Date.now());
  }

  // 网易云曲库查不到该歌曲：已下架 / ID 无效 / 区域版权不可用
  if (!meta.found) {
    return ok(
      c,
      { url: "", title: "", artist: "", cover: "", available: false },
      "歌曲不可用（已下架或版权限制）"
    );
  }

  let url: string | null = cacheGet(urlCache, id, URL_TTL) ?? null;
  if (url === null) {
    url = await getOuterUrl(id);
    if (url) cacheSet(urlCache, id, url);
  }

  if (url) {
    return ok(c, { url: toHttps(url), title: meta.title, artist: meta.artist, cover: meta.cover, available: true }, "解析成功");
  }

  // 降级：同源流代理（VIP 歌曲通常为试听片段）
  const proxiedUrl = `/api/music/163/stream?id=${id}`;
  return ok(
    c,
    { url: proxiedUrl, title: meta.title, artist: meta.artist, cover: meta.cover, available: true, proxied: true },
    "解析成功（流代理）"
  );
});

/** 音频流代理：GET /api/music/163/stream?id=xxx
 *  透传 Range 请求支持拖拽快进 */
app.get("/163/stream", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌曲 ID", 400);

  try {
    const range = c.req.header("range") || "";
    const upstreamHeaders: Record<string, string> = { "User-Agent": UA };
    if (range) upstreamHeaders.Range = range;

    const res = await fetch(`https://api.injahow.cn/meting/?type=url&id=${id}`, {
      headers: upstreamHeaders,
    });
    if (!res.body || (res.status !== 200 && res.status !== 206)) {
      return fail(c, "音频获取失败", 502);
    }
    // 上游对下架/无版权歌曲会返回 HTML 提示页而非音频，避免把 HTML 当音频下发
    const upstreamType = res.headers.get("content-type") || "";
    if (upstreamType.includes("text/html")) {
      return fail(c, "该歌曲暂无可用音源（版权或已下架）", 502);
    }

    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("content-type") || "audio/mpeg");
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
    headers.set("Accept-Ranges", res.headers.get("accept-ranges") || "bytes");
    const contentRange = res.headers.get("content-range");
    const contentLength = res.headers.get("content-length");
    if (contentRange) headers.set("Content-Range", contentRange);
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(res.body, { status: res.status, headers });
  } catch {
    return fail(c, "音频代理请求失败", 502);
  }
});

/** 封面图代理：GET /api/music/163/cover?url=xxx
 *  网易云 p1/p2.music.126.net 有防盗链，浏览器直链会被 403，走 Worker 中转 */
app.get("/163/cover", async c => {
  const url = c.req.query("url") || "";
  if (!url || !/^https?:\/\/.+\.music\.126\.net\//.test(url)) {
    return fail(c, "无效的封面地址", 400);
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://music.163.com/" },
    });
    if (!res.body || res.status >= 400) return fail(c, "封面获取失败", 502);
    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("content-type") || "image/jpeg");
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return fail(c, "封面代理失败", 502);
  }
});

/** LRC 歌词：GET /api/music/163/lyric?id=xxx */
app.get("/163/lyric", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌曲 ID", 400);

  // 歌词基本不变：命中缓存直接返回
  const cached = cacheGet(lyricCache, id, LYRIC_TTL);
  if (cached !== undefined) {
    return ok(c, { lyric: cached }, cached ? "歌词获取成功" : "该歌曲暂无歌词");
  }

  try {
    const lyric = await getLyric(id);
    cacheSet(lyricCache, id, lyric);
    return ok(c, { lyric }, lyric ? "歌词获取成功" : "该歌曲暂无歌词");
  } catch {
    return fail(c, "歌词获取失败", 502);
  }
});

/** 歌单详情：GET /api/music/163/playlist?id=xxx */
app.get("/163/playlist", async c => {
  const id = c.req.query("id") || "";
  if (!/^\d+$/.test(id)) return fail(c, "无效的歌单 ID", 400);

  try {
    const playlist = await getPlaylistDetail(id);
    return ok(c, { ...playlist, total: playlist.songs.length }, "歌单获取成功");
  } catch {
    return fail(c, "歌单获取失败，请检查歌单 ID 是否正确", 502);
  }
});

/* ============================================================
 * 中央音乐库代理（music-api 服务）
 * 本地不再落库：搜索/试听/入库/曲库管理全部带 X-Api-Key 转发到中央服务；
 * /track、/playlist.json 为公开读取直通（无需 ApiKey）。
 * 服务地址与 ApiKey 在「后台 - 音乐」配置（music_api_url / music_api_key）。
 * ============================================================ */

interface MusicApiCfg {
  base: string;
  key: string;
}

/** 读取中央服务配置；未配置返回 null */
async function musicApiCfg(c: Context<HonoEnv>): Promise<MusicApiCfg | null> {
  const s = await getSettings(c.env.DB);
  const base = s.music_api_url.replace(/\/+$/, "");
  if (!base) return null;
  return { base, key: s.music_api_key };
}

interface ProxyInit {
  method?: string;
  json?: unknown; // JSON body（自动加 Content-Type）
  raw?: ArrayBuffer; // 原始 body（multipart 直通，保留 boundary）
  rawType?: string; // 原始 body 的 Content-Type
  auth?: boolean; // 默认 true=带 X-Api-Key；公开读取端点传 false
}

/** JSON 直通代理：转发到中央服务并把 {code,message,data} 原样回给前端；transform 可改写 data */
async function proxyMusicJson(
  c: Context<HonoEnv>,
  path: string,
  init: ProxyInit = {},
  transform?: (data: Record<string, unknown>) => void
): Promise<Response> {
  const cfg = await musicApiCfg(c);
  if (!cfg) return fail(c, "未配置中央音乐服务：请到「后台 - 音乐」填写服务地址与 ApiKey", 503);
  const headers: Record<string, string> = {};
  if (init.auth !== false && cfg.key) headers["X-Api-Key"] = cfg.key;
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.raw) {
    headers["Content-Type"] = init.rawType || "application/octet-stream";
    body = init.raw;
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.base}${path}`, { method: init.method || "GET", headers, body });
  } catch {
    return fail(c, "中央音乐服务连接失败", 502);
  }
  const text = await res.text();
  let payload: { data?: unknown } | null = null;
  try {
    payload = JSON.parse(text) as { data?: unknown };
  } catch {
    // 非 JSON：原样透传
  }
  if (!payload || typeof payload !== "object") {
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  }
  if (transform && payload.data && typeof payload.data === "object") {
    transform(payload.data as Record<string, unknown>);
  }
  return new Response(JSON.stringify(payload), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 入库类响应：数字 id → "tN"（前台按 [music=tN] 插入编辑器） */
function prefixTrackId(data: Record<string, unknown>) {
  if (data.id != null && !String(data.id).startsWith("t")) data.id = `t${data.id}`;
}

/** 五平台聚合搜索（管理端）：GET /api/music/search?kw=xxx */
app.get("/search", requireAdmin, async c => {
  const kw = (c.req.query("kw") || "").trim();
  if (!kw) return fail(c, "请输入搜索关键词", 400);
  return proxyMusicJson(c, `/api/search?kw=${encodeURIComponent(kw)}`);
});

/** 试听地址解析（管理端）：GET /api/music/preview?source=&id=&title=&artist= */
app.get("/preview", requireAdmin, c => {
  const q = new URL(c.req.url).searchParams;
  return proxyMusicJson(c, `/api/resolve?${q.toString()}`);
});

/** 试听音频代理（管理端）：GET /api/music/stream?url=xxx
 *  汽水等平台直链有防盗链，浏览器 <audio> 直接请求 403，
 *  通过 Worker 代理 fetch 绕过（入库也走 Worker fetch 所以没问题） */
app.get("/stream", requireAdmin, async c => {
  const url = c.req.query("url") || "";
  if (!/^https?:\/\//i.test(url)) return fail(c, "参数错误", 400);
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!resp.ok) return fail(c, `音频获取失败 HTTP ${resp.status}`, 502);
  const ct = resp.headers.get("Content-Type") || "audio/mpeg";
  const cl = resp.headers.get("Content-Length") || "";
  return new Response(resp.body, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "no-store",
      ...(cl ? { "Content-Length": cl } : {}),
      "Accept-Ranges": "bytes",
    },
  });
});

/** 搜索结果入库（管理端）：POST /api/music/import { source, songId, ... } */
app.post("/import", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) return fail(c, "参数错误", 400);
  return proxyMusicJson(c, "/api/ingest", { method: "POST", json: body }, prefixTrackId);
});

/** 异步入库提交（管理端）：POST /api/music/import/async → 立即返回 { job_id } */
app.post("/import/async", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) return fail(c, "参数错误", 400);
  return proxyMusicJson(c, "/api/ingest/async", { method: "POST", json: body });
});

/** 入库任务进度（管理端）：GET /api/music/import/progress/:jobId */
app.get("/import/progress/:jobId", requireAdmin, c =>
  proxyMusicJson(c, `/api/ingest/progress/${c.req.param("jobId")}`)
);

/** 本地上传入库（管理端）：POST /api/music/upload（multipart 直通） */
app.post("/upload", requireAdmin, async c => {
  const raw = await c.req.arrayBuffer();
  return proxyMusicJson(
    c,
    "/api/ingest/upload",
    { method: "POST", raw, rawType: c.req.header("content-type") || "" },
    prefixTrackId
  );
});

/** 网络地址转存（管理端）：POST /api/music/url { url, title?, artist?, cover? } */
app.post("/url", requireAdmin, async c => {
  const body = await c.req.json().catch(() => null);
  if (!body) return fail(c, "参数错误", 400);
  return proxyMusicJson(c, "/api/ingest/url", { method: "POST", json: body }, prefixTrackId);
});

/** 站内曲目元数据（公开）：GET /api/music/track?id=tN
 *  中央服务响应较慢（秒级）：进程内缓存 + 并发去重 + 失败短缓存，
 *  同曲目 10 分钟内只回源一次，失败 30 秒内不重复打上游 */
const trackCache = new Map<string, CacheEntry<{ status: number; body: string }>>();
const trackInflight = new Map<string, Promise<{ status: number; body: string }>>();
app.get("/track", async c => {
  const m = /^t(\d+)$/.exec(c.req.query("id") || "");
  if (!m) return fail(c, "无效的曲目 ID", 400);
  const key = m[1];
  const hit = cacheGet(trackCache, key, 10 * 60 * 1000);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }
  // 并发去重：同一曲目的并行请求共享一次回源
  let p = trackInflight.get(key);
  if (!p) {
    p = (async () => {
      const res = await proxyMusicJson(c, `/track/${key}`, { auth: false });
      const body = await res.text();
      return { status: res.status, body };
    })().finally(() => trackInflight.delete(key));
    trackInflight.set(key, p);
  }
  const { status, body } = await p;
  if (status === 200) {
    cacheSet(trackCache, key, { status, body });
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  }
  // 失败负缓存 30s：避免水合重试期间持续打慢上游
  cacheSet(trackCache, key, { status, body });
  setTimeout(() => trackCache.delete(key), 30 * 1000);
  return new Response(body, { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
});

/** 胶囊播放器歌单（公开）：GET /api/music/playlist.json[?tag=xxx]
 *  中央服务返回纯数组（非信封），原样透传并保留缓存头。
 *  中央服务（music_api_url）响应慢且间歇性不可用，这里做三层兜底：
 *  1. 进程内缓存 10 分钟 + 并发去重，热数据毫秒级返回；
 *  2. stale-if-error：回源失败/超时/非 200 时，只要历史成功过就返回旧缓存（哪怕已过期）；
 *  3. 落盘持久化（data/playlist-cache.json）：服务重启后仍有旧歌单可用，彻底免疫中央服务故障。 */
type PlaylistPayload = { status: number; body: string };
const playlistCache = new Map<string, CacheEntry<PlaylistPayload>>();
const playlistInflight = new Map<string, Promise<PlaylistPayload>>();
const PLAYLIST_TTL = 10 * 60 * 1000;
const PLAYLIST_STORE = join(process.cwd(), "data", "playlist-cache.json");

// 启动时恢复落盘缓存（中央服务挂着重启也能立刻有歌单）
try {
  const saved = JSON.parse(readFileSync(PLAYLIST_STORE, "utf8")) as Record<string, CacheEntry<PlaylistPayload>>;
  for (const [k, v] of Object.entries(saved)) {
    if (v && typeof v.data?.body === "string" && typeof v.ts === "number") playlistCache.set(k, v);
  }
} catch {
  // 无落盘文件或内容损坏：忽略，首次请求会重建
}

function persistPlaylistCache() {
  try {
    mkdirSync(dirname(PLAYLIST_STORE), { recursive: true });
    writeFileSync(PLAYLIST_STORE, JSON.stringify(Object.fromEntries(playlistCache)), "utf8");
  } catch {
    // 落盘失败不影响接口
  }
}

app.get("/playlist.json", async c => {
  const cfg = await musicApiCfg(c);
  if (!cfg) return c.json([]); // 未配置时返回空歌单，避免前台播放器报错
  const tag = (c.req.query("tag") || "").trim().slice(0, 30);
  const key = tag || "__all__";
  const respond = (out: PlaylistPayload) =>
    new Response(out.body, {
      status: out.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=300" },
    });

  // 新鲜缓存直接返回
  const cached = playlistCache.get(key);
  if (cached && Date.now() - cached.ts < PLAYLIST_TTL) return respond(cached.data);

  let inflight = playlistInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(`${cfg.base}/playlist.json${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`, {
        signal: AbortSignal.timeout(8000), // 中央服务偶尔挂起，8 秒超时走 stale 兜底
      });
      return { status: res.status, body: await res.text() };
    })();
    playlistInflight.set(key, inflight);
  }
  try {
    const out = await inflight;
    if (out.status === 200) {
      playlistCache.set(key, { data: out, ts: Date.now() });
      persistPlaylistCache();
      return respond(out);
    }
    // 非 200：有旧缓存回旧缓存，否则透传错误
    if (cached) return respond(cached.data);
    return respond(out);
  } catch {
    // 回源失败/超时：stale-if-error，历史成功过就永远有歌单
    if (cached) return respond(cached.data);
    return c.json([]);
  } finally {
    playlistInflight.delete(key);
  }
});

/** 音乐库列表（管理端）：GET /api/music/library */
app.get("/library", requireAdmin, c =>
  proxyMusicJson(c, "/api/library", {}, data => {
    const list = (data as { list?: Array<Record<string, unknown>> }).list;
    if (Array.isArray(list)) list.forEach(t => prefixTrackId(t));
  })
);

/** 曲库管理操作直通（管理端）：tag / fill / edit / toggle / delete */
for (const op of ["tag", "fill", "edit", "toggle", "delete"] as const) {
  app.post(`/library/${op}`, requireAdmin, async c => {
    const body = await c.req.json().catch(() => null);
    if (!body) return fail(c, "参数错误", 400);
    return proxyMusicJson(c, `/api/library/${op}`, { method: "POST", json: body });
  });
}

export default app;
