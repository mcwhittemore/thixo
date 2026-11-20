// Q5: which ways of loading plugin code work inside a sandboxed (opaque-origin), CSP-restricted document.
// Every technique runs under three conditions:
//   control - no sandbox attribute, no CSP (proves the technique and harness work)
//   sandbox - sandbox="allow-scripts" attribute, no CSP (isolates the effect of the opaque origin)
//   policy  - sandbox attribute + the proposed CSP header with the technique's script-src
// All frames of one condition load in one shell page, in parallel.
import crypto from "node:crypto";
import { registerDoc, APP } from "../server.mjs";
import { NONCE, policy, reporter, collectorShell, sleep } from "../common.mjs";

const N = `'nonce-${NONCE}'`;
const P = "/plugin";

export function techniques(chunk) {
  return [
    { id: "inline-classic-nonce", q: "i", what: "inline <script nonce>", scriptSrc: N, body: `<script nonce="${NONCE}">__r('loaded','inline classic')</script>` },
    { id: "inline-classic-no-nonce", q: "i (negative)", what: "inline <script> without nonce (should be blocked by policy)", scriptSrc: N, body: `<script>__r('loaded','inline no nonce')</script>` },
    { id: "inline-module-nonce", q: "ii", what: "inline <script type=module nonce>", scriptSrc: N, body: `<script type="module" nonce="${NONCE}">__r('loaded','inline module')</script>` },
    { id: "classic-src-self", q: "iii", what: "<script src=/plugin/...> with script-src 'self'", scriptSrc: `${N} 'self'`, body: `<script src="${P}/none/classic.js"></script>` },
    { id: "classic-src-origin", q: "iv", what: `<script src> with script-src ${APP}`, scriptSrc: `${N} ${APP}`, body: `<script src="${P}/none/classic.js"></script>` },
    { id: "classic-src-nonce", q: "iv+", what: "<script nonce src=...> with script-src nonce only", scriptSrc: N, body: `<script nonce="${NONCE}" src="${P}/none/classic.js"></script>` },
    { id: "module-src-origin-acao-none", q: "v", what: "<script type=module src>, origin in script-src, no ACAO", scriptSrc: `${N} ${APP}`, body: `<script type="module" src="${P}/none/mod.js"></script>` },
    { id: "module-src-origin-acao-star", q: "v", what: "<script type=module src>, origin in script-src, ACAO *", scriptSrc: `${N} ${APP}`, body: `<script type="module" src="${P}/star/mod.js"></script>` },
    { id: "module-src-origin-acao-null", q: "v", what: "<script type=module src>, origin in script-src, ACAO null", scriptSrc: `${N} ${APP}`, body: `<script type="module" src="${P}/null/mod.js"></script>` },
    { id: "module-src-self-acao-star", q: "v", what: "<script type=module src>, script-src 'self', ACAO *", scriptSrc: `${N} 'self'`, body: `<script type="module" src="${P}/star/mod.js"></script>` },
    { id: "module-src-nonce-acao-star", q: "v", what: "<script type=module nonce src>, script-src nonce only, ACAO *", scriptSrc: N, body: `<script type="module" nonce="${NONCE}" src="${P}/star/mod.js"></script>` },
    { id: "module-static-import-origin", q: "vi", what: "module statically importing a second module, origin in script-src, ACAO *", scriptSrc: `${N} ${APP}`, body: `<script type="module" src="${P}/star/mod-imports.js"></script>` },
    { id: "module-static-import-nonce", q: "vi", what: "nonce'd module statically importing a second module, script-src nonce only", scriptSrc: N, body: `<script type="module" nonce="${NONCE}" src="${P}/star/mod-imports.js"></script>` },
    { id: "esm-react-chunk-origin", q: "vi", what: `esbuild ESM entry importing shared React chunk (${chunk}), origin in script-src, ACAO *`, scriptSrc: `${N} ${APP}`, body: `<script type="module" src="${P}/star/esm/esm-a.js"></script>` },
    { id: "esm-react-chunk-nonce", q: "vi", what: "same, nonce'd entry, script-src nonce only", scriptSrc: N, body: `<script type="module" nonce="${NONCE}" src="${P}/star/esm/esm-a.js"></script>` },
    { id: "esm-react-chunk-acao-none", q: "vi", what: "same, origin in script-src, no ACAO", scriptSrc: `${N} ${APP}`, body: `<script type="module" src="${P}/none/esm/esm-a.js"></script>` },
    { id: "importmap-nonce", q: "vii", what: "nonce'd import map + nonce'd inline module importing a bare specifier", scriptSrc: `${N} ${APP}`, body: `<script type="importmap" nonce="${NONCE}">{"imports":{"dep":"${P}/star/dep.js"}}</script><script type="module" nonce="${NONCE}">import { x } from "dep"; __r('loaded','importmap ' + x)</script>` },
    { id: "importmap-no-nonce", q: "vii", what: "import map without nonce + nonce'd inline module", scriptSrc: `${N} ${APP}`, body: `<script type="importmap">{"imports":{"dep":"${P}/star/dep.js"}}</script><script type="module" nonce="${NONCE}">import { x } from "dep"; __r('loaded','importmap ' + x)</script>` },
    { id: "blob-module-nonce", q: "viii", what: "blob: module via <script type=module nonce src=blob:>, script-src nonce only", scriptSrc: N, body: blobModule(true) },
    { id: "blob-module-no-blob-src", q: "viii", what: "blob: module via <script type=module src=blob:> (no nonce), script-src without blob:", scriptSrc: N, body: blobModule(false) },
    { id: "blob-module-blob-src", q: "viii", what: "blob: module via <script type=module src=blob:> (no nonce), script-src blob:", scriptSrc: `${N} blob:`, body: blobModule(false) },
    { id: "blob-import-blob-src", q: "viii", what: "blob: module via dynamic import(blobURL), script-src blob:", scriptSrc: `${N} blob:`, body: `<script nonce="${NONCE}">var u = URL.createObjectURL(new Blob(["window.__r('loaded','blob import ' + import.meta.url.slice(0,12))"], {type:"text/javascript"})); import(u).catch(function(e){ __r('error', 'import(blob) rejected: ' + e) });</script>` },
    { id: "dynamic-import-nonce", q: "ix", what: "import('/plugin/star/mod.js') from nonce'd inline script, script-src nonce only", scriptSrc: N, body: `<script nonce="${NONCE}">import('${P}/star/mod.js').catch(function(e){ __r('error', 'import() rejected: ' + e) })</script>` },
    { id: "dynamic-import-origin", q: "ix", what: "import() from nonce'd inline script, origin in script-src, ACAO *", scriptSrc: `${N} ${APP}`, body: `<script nonce="${NONCE}">import('${P}/star/mod.js').catch(function(e){ __r('error', 'import() rejected: ' + e) })</script>` },
    { id: "dynamic-import-origin-acao-none", q: "ix", what: "import(), origin in script-src, no ACAO", scriptSrc: `${N} ${APP}`, body: `<script nonce="${NONCE}">import('${P}/none/mod.js').catch(function(e){ __r('error', 'import() rejected: ' + e) })</script>` },
    { id: "strict-dynamic-inject", q: "extra", what: "trusted nonce'd script injects <script src> without nonce, script-src nonce 'strict-dynamic'", scriptSrc: `${N} 'strict-dynamic'`, body: `<script nonce="${NONCE}">var s=document.createElement('script'); s.src='${P}/none/inject.js'; document.head.appendChild(s);</script>` },
    { id: "inject-no-strict-dynamic", q: "extra", what: "same injection with script-src nonce only (no strict-dynamic)", scriptSrc: N, body: `<script nonce="${NONCE}">var s=document.createElement('script'); s.src='${P}/none/inject.js'; document.head.appendChild(s);</script>` },
    { id: "exfil-nonce", q: "leak", what: "plugin script reads the nonce from the DOM and injects <script nonce src=http://127.0.0.1:4202/...?d=secret>; script-src nonce only (yes = leak worked)", scriptSrc: N, body: `<script nonce="${NONCE}" src="${P}/none/exfil.js"></script>` },
    { id: "exfil-nonce-hidden", q: "leak", what: "same, but the host script first replaces HTMLElement.prototype.nonce with a getter returning '' (yes = leak worked)", scriptSrc: N, body: `<script nonce="${NONCE}">Object.defineProperty(HTMLElement.prototype, "nonce", { get: function(){ return ""; }, set: function(){}, configurable: false });</script><script nonce="${NONCE}" src="${P}/none/exfil.js"></script>` },
    { id: "exfil-hash-path", q: "leak", what: `no nonce anywhere: inline scripts by hash, bundle by path; script-src 'sha256-…' ${APP}/plugin/none/ (yes = leak worked)`, hashOnly: true, scriptSrc: `${APP}/plugin/none/`, body: `<script src="${P}/none/exfil.js"></script>` },
    { id: "bundle-hash-path", q: "iv (path)", what: `classic bundle allowed by path; inline host script by hash; script-src 'sha256-…' ${APP}/plugin/none/`, hashOnly: true, scriptSrc: `${APP}/plugin/none/`, body: `<script src="${P}/none/classic.js"></script>` },
    { id: "bundle-path-other-path", q: "iv (path)", what: `script outside the allowed path: <script src=/plugin/star/classic.js> with script-src 'sha256-…' ${APP}/plugin/none/`, hashOnly: true, scriptSrc: `${APP}/plugin/none/`, body: `<script src="${P}/star/classic.js"></script>` },
    { id: "eval", q: "extra", what: "eval('1') from nonce'd script (policy has no unsafe-eval)", scriptSrc: N, body: `<script nonce="${NONCE}">try { eval("1"); __r('loaded','eval ran') } catch (e) { __r('error', 'eval threw: ' + e) }</script>` },
    { id: "worker-blob", q: "Q3 worker", what: "new Worker(blob:) from nonce'd script", scriptSrc: `${N} blob:`, body: workerBody("URL.createObjectURL(new Blob([\"postMessage('w')\"], {type:'text/javascript'}))") },
    { id: "worker-url", q: "Q3 worker", what: "new Worker('/plugin/none/worker.js')", scriptSrc: `${N} ${APP}`, body: workerBody(`'${P}/none/worker.js'`) },
  ];
}

function blobModule(withNonce) {
  return `<script nonce="${NONCE}">var u = URL.createObjectURL(new Blob(["window.__r('loaded','blob module')"], {type:"text/javascript"})); var s = document.createElement('script'); s.type='module'; s.src=u; ${withNonce ? `s.nonce='${NONCE}';` : ""} document.head.appendChild(s);</script>`;
}

function workerBody(src) {
  return `<script nonce="${NONCE}">try { var w = new Worker(${src}); w.onmessage = function(e){ __r('loaded','worker said ' + e.data) }; w.onerror = function(e){ e.preventDefault(); __r('error','worker error event ' + (e.message||'')) }; } catch (e) { __r('error', 'new Worker threw: ' + e) }</script>`;
}

// hashOnly: the reporter carries no nonce and is allowed by its sha256 instead, so there is no nonce to steal.
function doc(t, cond) {
  const id = `q5-${cond}-${t.id}`;
  let rep = reporter(id);
  let scriptSrc = t.scriptSrc;
  if (t.hashOnly) {
    rep = rep.replace(` nonce="${NONCE}"`, "");
    const body = rep.slice(rep.indexOf(">") + 1, rep.lastIndexOf("</script>"));
    scriptSrc = `'sha256-${crypto.createHash("sha256").update(body).digest("base64")}' ${t.scriptSrc}`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8">${rep}</head><body>${t.body}</body></html>`;
  const headers = cond === "policy" ? { "content-security-policy": policy(scriptSrc) } : {};
  registerDoc(id, html, headers);
  return { id, src: `/doc/${id}`, sandbox: cond === "control" ? null : "allow-scripts", width: 120, height: 40 };
}

export async function run({ browser, meta, chunk }) {
  const ts = techniques(chunk);
  const results = [];
  const byKey = {};
  for (const cond of ["control", "sandbox", "policy"]) {
    const frames = ts.map((t) => doc(t, cond));
    const shellId = `q5-shell-${cond}`;
    registerDoc(shellId, collectorShell(frames));
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const consoleLines = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleLines.push({ url: m.location()?.url || "", text: m.text() }); });
    await page.goto(`${APP}/doc/${shellId}`);
    await sleep(3500);
    const msgs = await page.evaluate(() => window.msgs);
    await ctx.close();
    for (const t of ts) {
      const id = `q5-${cond}-${t.id}`;
      const mine = msgs.filter((m) => m.id === id);
      const loaded = mine.find((m) => m.k === "loaded");
      const csp = mine.filter((m) => m.k === "csp").map((m) => `${m.v.directive} blocked ${m.v.blocked}`);
      const errors = mine.filter((m) => m.k === "error").map((m) => m.v);
      const cons = consoleLines.filter((c) => c.url.includes(id) || c.text.includes(id)).map((c) => c.text);
      (byKey[t.id] ||= { technique: t.id, q: t.q, attempted: t.what, scriptSrc: t.scriptSrc })[cond] = {
        loaded: !!loaded, detail: loaded?.v, attempt: mine.find((m) => m.k === "attempt")?.v, csp, errors, console: cons.slice(0, 4),
      };
    }
  }
  for (const r of Object.values(byKey)) {
    const harnessOk = r.control.loaded || ["eval", "inline-classic-no-nonce", "importmap-no-nonce"].includes(r.technique);
    results.push({
      question: "Q5", test: r.technique, sub: r.q, ...meta, attempted: r.attempted, scriptSrc: r.scriptSrc,
      outcome: { control: r.control.loaded, sandboxOnly: r.sandbox.loaded, policy: r.policy.loaded },
      controlValid: harnessOk,
      detail: { control: r.control, sandbox: r.sandbox, policy: r.policy },
      error: [...r.policy.csp, ...r.policy.errors, ...(r.policy.loaded ? [] : r.policy.console)].join(" | ") || null,
      sandboxError: [...r.sandbox.errors, ...(r.sandbox.loaded ? [] : r.sandbox.console)].join(" | ") || null,
    });
  }
  return results;
}
