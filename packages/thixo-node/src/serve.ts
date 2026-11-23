import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export interface ServeOptions {
  port: number;
  /** Default `127.0.0.1`. */
  hostname?: string;
  /** A folder of files to serve before the handler is asked, for GET and HEAD. */
  staticDir?: string;
  /** The URL path the folder is served under. Default `/`. */
  staticPrefix?: string;
}

export interface Served {
  url: string;
  close(): Promise<void>;
}

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
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function toRequest(req: IncomingMessage, signal: AbortSignal, fallbackHost: string): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    try {
      headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
    } catch {}
  }
  const host = req.headers.host ?? fallbackHost;
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as ReadableStream;
    init.duplex = "half";
  }
  return new Request(new URL(req.url ?? "/", `http://${host}`), init);
}

function writeHead(res: ServerResponse, response: Response): void {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText || undefined, headers);
  res.flushHeaders();
}

async function send(res: ServerResponse, response: Response, head: boolean): Promise<void> {
  writeHead(res, response);
  if (!response.body || head) {
    await response.body?.cancel();
    res.end();
    return;
  }
  const reader = response.body.getReader();
  const closed = () => void reader.cancel().catch(() => {});
  res.on("close", closed);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((done) => {
          const finish = () => {
            res.off("drain", finish);
            res.off("close", finish);
            done();
          };
          res.once("drain", finish);
          res.once("close", finish);
        });
      }
      if (res.destroyed) break;
    }
  } finally {
    res.off("close", closed);
  }
  res.end();
}

async function staticFile(root: string, prefix: string, req: IncomingMessage): Promise<{ file: string; size: number } | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  if (prefix !== "/" && path !== prefix && !path.startsWith(`${prefix}/`)) return null;
  const rest = path.slice(prefix.length).replace(/^\/+/, "");
  const base = resolve(root);
  let file = resolve(base, rest);
  if (file !== base && !file.startsWith(base + sep)) return null;
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = resolve(file, "index.html");
      info = await stat(file);
    }
    return info.isFile() ? { file, size: info.size } : null;
  } catch {
    return null;
  }
}

/** Serves a web-standard handler from a Node HTTP server. Request and response bodies stream both ways, so a
 * newline-delimited JSON response reaches the client as it is written. */
export async function serve(handler: (request: Request) => Promise<Response>, options: ServeOptions): Promise<Served> {
  const hostname = options.hostname ?? "127.0.0.1";
  const staticPrefix = "/" + (options.staticPrefix ?? "/").replace(/^\/+|\/+$/g, "");

  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    try {
      if (options.staticDir) {
        const hit = await staticFile(options.staticDir, staticPrefix, req);
        if (hit) {
          res.writeHead(200, { "content-type": TYPES[extname(hit.file).toLowerCase()] ?? "application/octet-stream", "content-length": hit.size });
          if (req.method === "HEAD") res.end();
          else createReadStream(hit.file).on("error", () => res.destroy()).pipe(res);
          return;
        }
      }
      const response = await handler(toRequest(req, controller.signal, `${hostname}:${options.port}`));
      await send(res, response, req.method === "HEAD");
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      console.error(error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    }
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(options.port, hostname, () => {
      server.off("error", reject);
      resolveListening();
    });
  });

  const { port } = server.address() as AddressInfo;
  const shown = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname.includes(":") ? `[${hostname}]` : hostname;
  return {
    url: `http://${shown}:${port}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => (error ? fail(error) : done()));
        server.closeAllConnections();
      }),
  };
}
