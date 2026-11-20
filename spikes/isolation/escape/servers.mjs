// Three local servers, all bound to loopback only:
//   app (origin A)   http://localhost:4101   shell, plugin route, control frames, /api/whoami
//   collector        http://127.0.0.1:4102   logs every TCP connection, HTTP request and WebSocket upgrade
//   udp listener     127.0.0.1:4103/udp      logs every datagram; answers TURN Allocate with 401 so the
//                                            client retries and sends its USERNAME
import http from "node:http";
import dgram from "node:dgram";
import crypto from "node:crypto";
import { findTest, renderShell, renderPlugin, renderControlFrame } from "./pages.mjs";

export const events = [];
const now = () => Date.now();
const firstSeenTx = new Map();

function cookieNames(h) {
  return (h || "").split(";").map((s) => s.trim().split("=")[0]).filter(Boolean);
}

// ---------- app server (origin A) ----------
function appHandler(req, res) {
  const url = new URL(req.url, "http://localhost:4101");
  const tk = url.searchParams.get("tk") || "";
  const id = url.searchParams.get("id") || "";
  if (url.pathname === "/shell") {
    const test = findTest(id);
    if (!test) return void res.writeHead(404).end("no test " + id);
    const mode = url.searchParams.get("mode") || "test";
    const { headers, body } = renderShell(test, tk, mode);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": [
        "c_lax=L; SameSite=Lax; Path=/",
        "c_strict=S; SameSite=Strict; Path=/",
        "c_none=N; SameSite=None; Secure; Path=/",
        "c_default=D; Path=/",
        "c_httponly=H; HttpOnly; SameSite=Lax; Path=/",
      ],
      ...headers,
    });
    return void res.end(body);
  }
  if (url.pathname === "/plugin/frame") {
    const test = findTest(id);
    if (!test) return void res.writeHead(404).end("no test");
    const { headers, body } = renderPlugin(test, tk);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
    return void res.end(body);
  }
  if (url.pathname === "/control-frame") {
    const test = findTest(id);
    if (!test) return void res.writeHead(404).end("no test");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return void res.end(renderControlFrame(test, tk));
  }
  if (url.pathname === "/api/whoami") {
    const cookies = req.headers.cookie || "";
    events.push({ server: "app", type: "http", t: now(), method: req.method, url: req.url, tk, cookies: cookieNames(cookies), origin: req.headers.origin || null, secFetchSite: req.headers["sec-fetch-site"] || null, raw: req.url });
    const cors = url.searchParams.get("cors") || "none";
    const h = { "content-type": "application/json", "cache-control": "no-store" };
    if (cors === "null") Object.assign(h, { "access-control-allow-origin": "null", "access-control-allow-credentials": "true" });
    if (cors === "star") Object.assign(h, { "access-control-allow-origin": "*" });
    res.writeHead(200, h);
    return void res.end(JSON.stringify({ user: "alice", cookies: cookieNames(cookies) }));
  }
  res.writeHead(404).end("not found");
}

// ---------- collector ----------
function collectorHandler(req, res) {
  let body = "";
  req.on("data", (c) => { if (body.length < 2000) body += c; });
  req.on("end", () => {
    const ev = { server: "collector", type: "http", t: now(), method: req.method, url: req.url, body: body.slice(0, 500), referer: req.headers.referer || null, purpose: req.headers["sec-purpose"] || req.headers.purpose || null, dest: req.headers["sec-fetch-dest"] || null, cookies: cookieNames(req.headers.cookie) };
    ev.raw = req.url + " " + body;
    if (req.socket.__conn) req.socket.__conn.requests.push(req.url);
    events.push(ev);
    const p = new URL(req.url, "http://127.0.0.1:4102").pathname;
    const h = { connection: "close", "access-control-allow-origin": "*", "cache-control": "no-store" };
    if (p.endsWith(".css")) h["content-type"] = "text/css";
    else if (p.endsWith(".js") || p.endsWith(".mjs")) h["content-type"] = "text/javascript";
    else if (p === "/sse") h["content-type"] = "text/event-stream";
    else h["content-type"] = "text/plain";
    res.writeHead(200, h);
    if (p === "/sse") return void res.end("data: hi\n\n");
    res.end(p.endsWith(".js") || p.endsWith(".mjs") ? "/* collector */" : "");
  });
}

// ---------- UDP / STUN-TURN ----------
function parseStun(buf) {
  if (buf.length < 20) return null;
  const type = buf.readUInt16BE(0);
  const magic = buf.readUInt32BE(4);
  if (magic !== 0x2112a442) return null;
  const txid = buf.subarray(8, 20).toString("hex");
  const attrs = {};
  let off = 20;
  while (off + 4 <= buf.length) {
    const at = buf.readUInt16BE(off), al = buf.readUInt16BE(off + 2);
    const v = buf.subarray(off + 4, off + 4 + al);
    if (at === 0x0006) attrs.username = v.toString("utf8");
    if (at === 0x0014) attrs.realm = v.toString("utf8");
    off += 4 + al + ((4 - (al % 4)) % 4);
  }
  return { type, txid, attrs };
}

function stunAttr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0); b.writeUInt16BE(value.length, 2); value.copy(b, 4);
  return b;
}

function allocate401(txidHex) {
  const err = Buffer.concat([Buffer.from([0, 0, 4, 1]), Buffer.from("Unauthorized")]);
  const attrs = Buffer.concat([stunAttr(0x0009, err), stunAttr(0x0014, Buffer.from("tailor")), stunAttr(0x0015, Buffer.from(crypto.randomBytes(8).toString("hex")))]);
  const h = Buffer.alloc(20);
  h.writeUInt16BE(0x0113, 0); h.writeUInt16BE(attrs.length, 2); h.writeUInt32BE(0x2112a442, 4);
  Buffer.from(txidHex, "hex").copy(h, 8);
  return Buffer.concat([h, attrs]);
}

export async function startServers() {
  const app4 = http.createServer(appHandler);
  const app6 = http.createServer(appHandler);
  const col = http.createServer(collectorHandler);
  col.on("connection", (sock) => {
    const conn = { server: "collector", type: "tcp", t: now(), requests: [] };
    sock.__conn = conn;
    events.push(conn);
  });
  col.on("upgrade", (req, sock) => {
    events.push({ server: "collector", type: "ws-upgrade", t: now(), url: req.url, raw: req.url });
    if (sock.__conn) sock.__conn.requests.push(req.url);
    sock.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
  });
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    const s = parseStun(msg);
    const ev = { server: "udp", type: "udp", t: now(), len: msg.length, from: rinfo.address + ":" + rinfo.port };
    if (s) {
      ev.stunType = "0x" + s.type.toString(16).padStart(4, "0");
      ev.txid = s.txid;
      ev.username = s.attrs.username || null;
      if (!firstSeenTx.has(s.txid)) firstSeenTx.set(s.txid, ev.t);
      ev.txFirstSeen = firstSeenTx.get(s.txid);
      ev.raw = ev.username || "";
      if (s.type === 0x0003 && !s.attrs.username) udp.send(allocate401(s.txid), rinfo.port, rinfo.address);
    } else {
      ev.stunType = "non-stun (first byte 0x" + msg[0].toString(16) + ")";
      ev.raw = "";
    }
    events.push(ev);
  });
  await Promise.all([
    new Promise((r) => app4.listen(4101, "127.0.0.1", r)),
    new Promise((r) => app6.listen(4101, "::1", r)),
    new Promise((r) => col.listen(4102, "127.0.0.1", r)),
    new Promise((r) => udp.bind(4103, "127.0.0.1", r)),
  ]);
  return async () => {
    for (const s of [app4, app6, col]) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
    await new Promise((r) => udp.close(r));
  };
}
