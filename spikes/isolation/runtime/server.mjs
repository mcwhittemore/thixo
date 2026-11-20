// Plain Node servers for the runtime spike. One handler, two listeners:
//   http://localhost:4201  - the app origin (shell + same-origin plugin route)
//   http://127.0.0.1:4202  - a different site, for the separate-origin arrangement
// Pages are registered in-process by the tests: registerDoc(id, html, headers).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BUILD = path.join(here, "build");
export const APP = "http://localhost:4201";
export const OTHER = "http://127.0.0.1:4202";

const docs = new Map();
// Optional extra routes (the manual runner uses this to receive results): (req, res, url) => true if handled.
const routes = [];
export function addRoute(fn) { routes.push(fn); }
export function registerDoc(id, html, headers = {}) {
  docs.set(id, { html, headers });
  return `/doc/${id}`;
}

const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".ttf": "font/ttf", ".png": "image/png", ".css": "text/css", ".html": "text/html" };
const acaoFor = { none: null, star: "*", null: "null", app: APP };

function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  for (const r of routes) if (r(req, res, url)) return;
  if (p.startsWith("/doc/")) {
    const d = docs.get(p.slice(5));
    if (!d) { res.writeHead(404); return res.end("no doc"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...d.headers });
    return res.end(d.html);
  }
  // /plugin/<acao>/<file...>: static build output with a chosen Access-Control-Allow-Origin
  const m = p.match(/^\/plugin\/(none|star|null|app)\/(.+)$/);
  if (m) {
    const file = path.join(BUILD, path.normalize(m[2]).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(BUILD) || !fs.existsSync(file)) { res.writeHead(404); return res.end("missing"); }
    const h = { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "max-age=600" };
    if (acaoFor[m[1]]) h["access-control-allow-origin"] = acaoFor[m[1]];
    res.writeHead(200, h);
    return res.end(fs.readFileSync(file));
  }
  if (p === "/favicon.ico") { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end("not found");
}

export async function startServers() {
  const servers = [];
  const listen = (port, host) => new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.on("error", reject);
    s.listen(port, host, () => { servers.push(s); resolve(); });
  });
  // localhost may resolve to ::1 or 127.0.0.1 depending on the browser; listen on both loopbacks for 4201.
  await listen(4201, "127.0.0.1");
  try { await listen(4201, "::1"); } catch { /* no IPv6 loopback */ }
  await listen(4202, "127.0.0.1");
  return () => Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(r); })));
}
