/**
 * ASSETS 绑定适配器：本地 public/ 静态文件服务
 * 文件存在则返回文件，其余路径回退 index.html（SPA 兜底）。
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Readable } from "node:stream";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
};

export class AssetsFetcher implements Fetcher {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private respondFile(absPath: string, urlPath: string): Response {
    const st = statSync(absPath);
    if (!st.isFile()) return this.respondIndex();
    const type = MIME[extname(absPath).toLowerCase()] || "application/octet-stream";
    const body = Readable.toWeb(createReadStream(absPath)) as ReadableStream;
    // 带版本号 query（?v=...）的资源可强缓存；但 /themes/* 和 /app.js 必须走短缓存：
    // 升版本号 CDN 会回源拉新（immutable 会导致 CDN 永远不回源，卡死在旧版本）
    const ext = extname(absPath).toLowerCase();
    const isThemeFile = urlPath.startsWith("/themes/") || urlPath.startsWith("/app.js") || urlPath.startsWith("/style.css");
    const hasVer = /[?&]v=\w+/.test(urlPath);
    let cache = "public, max-age=60";
    if (hasVer && !isThemeFile && ext !== ".html") {
      // 媒体图片等（非主题 JS/CSS）可以 immutable
      cache = "public, max-age=31536000, immutable";
    } else if (hasVer && isThemeFile) {
      // 主题 JS/CSS 走短缓存 + must-revalidate，升版本号立刻回源
      cache = "public, max-age=60, must-revalidate";
    }
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(st.size),
        "cache-control": cache,
        "last-modified": st.mtime.toUTCString(),
      },
    });
  }

  private respondIndex(): Response {
    const idx = join(this.root, "index.html");
    if (!existsSync(idx)) return new Response("Not Found", { status: 404 });
    const st = statSync(idx);
    return new Response(Readable.toWeb(createReadStream(idx)) as ReadableStream, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(st.size),
        "cache-control": "public, max-age=60",
      },
    });
  }

  async fetch(input: RequestInfo | URL): Promise<Response> {
    let pathname = "/";
    let search = "";
    try {
      const u = typeof input === "string" || input instanceof URL ? new URL(input.toString(), "http://local") : new URL(input.url);
      pathname = decodeURIComponent(u.pathname);
      search = u.search;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // 防目录穿越
    const safe = join(this.root, pathname);
    if (resolve(safe) !== this.root && !resolve(safe).startsWith(this.root + "\\") && !resolve(safe).startsWith(this.root + "/")) {
      return new Response("Forbidden", { status: 403 });
    }

    const abs = join(this.root, pathname);
    if (pathname !== "/" && existsSync(abs)) return this.respondFile(abs, pathname + search);
    if (pathname === "/" || existsSync(join(this.root, "index.html"))) return this.respondIndex();
    return new Response("Not Found", { status: 404 });
  }
}
