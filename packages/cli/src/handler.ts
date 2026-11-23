import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Thixo } from "thixo/server";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

/** Defence in depth behind the compiler (L7): the page loads script, connects and frames from itself only, and
 * fonts from itself and `data:`. Images may come from any https host, because a `Url` the app hands a plugin (an
 * avatar, a url field) may load wherever it points; an image written in a plugin's source was copied into the app at
 * build, and the runtime refuses it from anywhere else. */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export interface HandlerOptions {
  /** The live server, which `thixo dev` swaps. Null while the app does not build. */
  thixo(): Thixo | null;
  /** Why there is no server, for the page. */
  problem?(): string | null;
  clientDir: string;
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function readIfFile(file: string): Promise<Uint8Array | null> {
  try {
    if (!(await stat(file)).isFile()) return null;
    return await readFile(file);
  } catch {
    return null;
  }
}

function staticPath(clientDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(clientDir);
  const file = resolve(base, normalize(`.${sep}${decoded}`));
  return file === base || file.startsWith(base + sep) ? file : null;
}

/** `/_thixo/*` and `/api/*` go to Thixo. A file in the client build is served as it is. Any other GET is a
 * client-side route and gets index.html, which carries the Content-Security-Policy. */
export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api" || path.startsWith("/api/") || path === "/_thixo" || path.startsWith("/_thixo/")) {
      const thixo = options.thixo();
      if (!thixo) return text(503, `The app is not running: ${options.problem?.() ?? "it has not built yet"}`);
      return thixo.fetch(request);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Method not allowed");

    const file = staticPath(options.clientDir, path);
    if (!file) return text(400, "Bad path");
    const common = { "x-content-type-options": "nosniff", "cache-control": "no-cache" };
    const isIndex = file === resolve(options.clientDir) || file === join(resolve(options.clientDir), "index.html");
    if (!isIndex) {
      const bytes = await readIfFile(file);
      if (bytes) return new Response(bytes as BodyInit, { headers: { ...common, "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" } });
      if (extname(path)) return text(404, `Not found: ${path}`);
    }
    const index = await readIfFile(join(options.clientDir, "index.html"));
    if (!index) return text(404, `The app has not built yet: ${options.problem?.() ?? "no index.html in the client build"}`);
    return new Response(index as BodyInit, {
      headers: { ...common, "content-type": TYPES[".html"], "content-security-policy": contentSecurityPolicy() },
    });
  };
}
