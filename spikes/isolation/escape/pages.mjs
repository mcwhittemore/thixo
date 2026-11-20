// Renders the shell page, the plugin document (with its CSP header) and the unsandboxed control frame.
import crypto from "node:crypto";
import { tests } from "./cases.mjs";

const byId = new Map(tests.map((t) => [t.id, t]));
export const findTest = (id) => byId.get(id);

export const PLUGIN_ROUTE = "http://localhost:4101/plugin/";

// Safe embedding of a JS value inside an inline <script>.
const J = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

// The trusted host document: runs first in the frame and deletes dangerous constructors.
export const HOSTDOC = `(() => {
  const r = {};
  for (const n of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','fetch','XMLHttpRequest','WebSocket','WebSocketStream','EventSource','WebTransport','Worker','SharedWorker','fetchLater']) {
    if (n in self) { try { r[n] = (delete self[n]) && !(n in self); } catch (e) { r[n] = 'threw ' + e.name; } }
  }
  try { r.sendBeacon = (delete Navigator.prototype.sendBeacon) && !('sendBeacon' in navigator); } catch (e) { r.sendBeacon = 'threw'; }
  self.__hostdoc = r;
})();`;

// Runs inside a child document's own realm (srcdoc, data:, blob:, javascript:, object, embed).
function childMain(TK, S) {
  const C = "http://127.0.0.1:4102";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => { try { top.postMessage({ __t: 1, tk: TK, from: "child-" + S, out: o }, "*"); } catch (e) {} };
  (async () => {
    const o = { origin: String(self.origin), types: {} };
    for (const n of ["fetch", "XMLHttpRequest", "WebSocket", "RTCPeerConnection"]) o.types[n] = typeof self[n];
    try { o.fn = Function("return 7")(); } catch (e) { o.fn = "threw " + e.name; }
    post(o);
    try { await fetch(C + "/hit?tk=" + TK + "&s=" + S + "-selffetch", { mode: "no-cors" }); o.fetch = "resolved"; } catch (e) { o.fetch = "threw " + e.name; }
    try { const ws = new WebSocket("ws://127.0.0.1:4102/ws?tk=" + TK + "&s=" + S + "-selfws"); ws.onerror = () => {}; o.ws = "constructed"; } catch (e) { o.ws = "threw " + e.name; }
    if (typeof RTCPeerConnection === "function") {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "turn:127.0.0.1:4103?transport=udp", username: TK + "." + S + "-selfrtc", credential: "x" }] });
        pc.createDataChannel("x"); await pc.setLocalDescription(await pc.createOffer()); await sleep(2000); pc.close(); o.rtc = "ran";
      } catch (e) { o.rtc = "threw " + e.name; }
    }
    post(o);
  })();
}

function prelude(tk) {
  return `
const TK = ${J(tk)}, C = 'http://127.0.0.1:4102', A = 'http://localhost:4101';
const NONCE = (document.currentScript && document.currentScript.nonce) || '';
const SELF_SRC = (document.currentScript && document.currentScript.textContent) || '';
const out = { notes: {}, errors: [], csp: [] };
const U = (s, path = '/hit', base = C) => base + path + '?tk=' + TK + '&s=' + s;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const note = (k, v) => { out.notes[k] = v; };
const send = (done) => { try { parent.postMessage({ __t: 1, tk: TK, from: 'frame', done: !!done, out: JSON.parse(JSON.stringify(out)) }, '*'); } catch (e) {} };
const add = (html, where) => { const d = document.createElement('div'); d.innerHTML = html; (where || document.body).appendChild(d); return d; };
const tryv = (f) => { try { return f(); } catch (e) { return 'threw ' + e.name; } };
const loaded = (el, ms = 1500) => new Promise((r) => { el.addEventListener('load', () => r('load'), { once: true }); el.addEventListener('error', () => r('error'), { once: true }); setTimeout(() => r('timeout'), ms); });
const CHILD_SRC = ${J("(" + childMain.toString() + ")")};
const CHILD = (s) => '<script nonce="' + NONCE + '">' + CHILD_SRC + '(' + JSON.stringify(TK) + ',' + JSON.stringify(s) + ')</' + 'script>';
async function rtc(PC, s, ms = 2500) {
  const r = { cands: [] };
  try {
    const pc = new PC({ iceServers: [{ urls: 'stun:127.0.0.1:4103' }, { urls: 'turn:127.0.0.1:4103?transport=udp', username: TK + '.' + s, credential: 'x' }] });
    pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate) r.cands.push(e.candidate.type || e.candidate.candidate.split(' ')[7]); };
    pc.onicecandidateerror = (e) => { r.iceErr = (r.iceErr || []).concat(String(e.errorCode) + ' ' + (e.url || '')); };
    pc.createDataChannel('x');
    await pc.setLocalDescription(await pc.createOffer());
    await sleep(ms);
    r.state = pc.iceGatheringState;
    pc.close();
  } catch (e) { r.err = e.name + ': ' + e.message; }
  return r;
}
async function probeRealm(w, s) {
  const r = {};
  for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket', 'RTCPeerConnection', 'Function', 'eval']) r[n] = tryv(() => typeof w[n]);
  r.origin = tryv(() => String(w.origin));
  if (r.Function === 'function') r.FunctionCall = tryv(() => w.Function('return 7')());
  if (r.eval === 'function') r.evalCall = tryv(() => w.eval('7'));
  const jobs = [];
  if (r.fetch === 'function') jobs.push(w.fetch(U(s + '-fetch'), { mode: 'no-cors' }).then(() => (r.fetchUse = 'resolved'), (e) => (r.fetchUse = 'threw ' + e.name)));
  if (r.XMLHttpRequest === 'function') jobs.push(new Promise((res) => { try { const x = new w.XMLHttpRequest(); x.open('GET', U(s + '-xhr')); x.onload = () => res('load'); x.onerror = () => res('error'); x.send(); setTimeout(() => res('timeout'), 1500); } catch (e) { res('threw ' + e.name); } }).then((v) => (r.xhrUse = v)));
  if (r.WebSocket === 'function') jobs.push(new Promise((res) => { try { const ws = new w.WebSocket('ws://127.0.0.1:4102/ws?tk=' + TK + '&s=' + s + '-ws'); ws.onopen = () => res('open'); ws.onerror = () => res('error'); setTimeout(() => res('timeout'), 1500); } catch (e) { res('threw ' + e.name); } }).then((v) => (r.wsUse = v)));
  if (r.RTCPeerConnection === 'function') jobs.push(rtc(w.RTCPeerConnection, s + '-rtc', 2000).then((v) => (r.rtcUse = v)));
  await Promise.all(jobs);
  return r;
}
document.addEventListener('securitypolicyviolation', (e) => out.csp.push((e.effectiveDirective || e.violatedDirective) + ' ' + String(e.blockedURI || '').slice(0, 60)));
note('parentTypes', { fetch: typeof self.fetch, RTCPeerConnection: typeof self.RTCPeerConnection, WebSocket: typeof self.WebSocket, origin: String(self.origin) });
`;
}

function caseScript(test, tk) {
  return `(async () => {
${prelude(tk)}
try { await (${test.code.toString()})(); } catch (e) { out.errors.push(e.name + ': ' + e.message); }
await sleep(${test.wait ?? 300});
send(true);
})();`;
}

const sha = (s) => "'sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64") + "'";

export function pluginCsp(variant, scripts, nonce) {
  if (variant === "sandbox-only") return "sandbox allow-scripts";
  const hashed = variant === "full-hash" || variant.startsWith("single-hash");
  const scriptSrc = hashed ? "script-src " + scripts.map(sha).join(" ") : `script-src 'nonce-${nonce}'`;
  let d = ["sandbox allow-scripts", "default-src 'none'", scriptSrc, "style-src 'unsafe-inline'", "img-src data: blob:", "frame-src 'none'", "child-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'"];
  if (variant === "noframe") d = d.filter((x) => !x.startsWith("frame-src") && !x.startsWith("child-src"));
  if (variant === "frames-open") d = d.filter((x) => !x.startsWith("child-src")).map((x) => (x.startsWith("frame-src") ? "frame-src * data: blob:" : x));
  if (variant === "connect") d.push("connect-src http://localhost:4101");
  if (variant === "no-form-action") d = d.filter((x) => !x.startsWith("form-action"));
  if (variant === "webrtc-block") d.push("webrtc 'block'");
  if (variant === "tt" || variant === "single-hash-tt") d.push("require-trusted-types-for 'script'", "trusted-types 'none'");
  return d.join("; ");
}

export function renderPlugin(test, tk) {
  const nonce = crypto.randomBytes(12).toString("base64");
  const scripts = [];
  if (test.variant.startsWith("single-hash")) scripts.push((test.hostdoc ? HOSTDOC + "\n" : "") + caseScript(test, tk));
  else {
    if (test.hostdoc) scripts.push(HOSTDOC);
    scripts.push(caseScript(test, tk));
  }
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>plugin</title></head><body>
${scripts.map((s) => `<script nonce="${nonce}">${s}</script>`).join("\n")}
</body></html>`;
  return { headers: { "content-security-policy": pluginCsp(test.variant, scripts, nonce) }, body };
}

// Positive control: same case code, no sandbox, no CSP, no host document.
export function renderControlFrame(test, tk) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>control</title></head><body>
<script>${caseScript(test, tk)}</script>
</body></html>`;
}

export function renderShell(test, tk, mode) {
  const headers = {};
  if (mode === "test" && test.shellCsp) headers["content-security-policy"] = `frame-src ${PLUGIN_ROUTE}`;
  const src = mode === "test" ? `/plugin/frame?id=${encodeURIComponent(test.id)}&tk=${tk}` : `/control-frame?id=${encodeURIComponent(test.id)}&tk=${tk}`;
  const sandbox = mode === "test" ? ` sandbox="allow-scripts"` : "";
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>shell</title></head><body>
<script>
try { localStorage.setItem('secret', 'LS-${tk}'); } catch (e) {}
addEventListener('message', (e) => { const d = e.data; if (d && d.__t) { try { window.__report(JSON.stringify(d)); } catch (err) {} } });
</script>
<iframe id="plugin"${sandbox} src="${src}" width="400" height="300"></iframe>
</body></html>`;
  return { headers, body };
}
