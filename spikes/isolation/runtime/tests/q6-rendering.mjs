// Q6: render a real React component in the sandboxed frame under the proposed policy and check each technique.
// Conditions: control (no sandbox, no CSP), proposed policy, policy with style-src 'none' (what needs unsafe-inline),
// policy + font-src data: (the minimal font allowance), and the React development build under the policy.
import { registerDoc, APP } from "../server.mjs";
import { NONCE, policy, reporter, collectorShell, sleep } from "../common.mjs";

const N = `'nonce-${NONCE}'`;

// The host document: runs first, opens a MessageChannel to the shell, waits for context, then the bundle mounts.
function hostDoc(id, bundle) {
  return `<!doctype html><html><head><meta charset="utf-8">${reporter(id)}
<script nonce="${NONCE}">
(function(){
  var ch = new MessageChannel();
  window.__ctxReady = new Promise(function(resolve){
    ch.port1.onmessage = function(e){ resolve(e.data); };
  });
  parent.postMessage({ tailorTest: 1, id: ${JSON.stringify(id)}, k: "hello" }, "*", [ch.port2]);
})();
</script>
<style>html,body{margin:0}</style></head><body><div id="root"></div>
<script nonce="${NONCE}" src="/plugin/none/${bundle}"></script>
</body></html>`;
}

const shellScript = `<script>
window.addEventListener("message", async function(e){
  if (e.data && e.data.k === "hello" && e.ports[0]) {
    const buf = await (await fetch("/plugin/none/font.ttf")).arrayBuffer();
    e.ports[0].postMessage({
      tokens: { "--brand": "rgb(10, 20, 30)", "--gap": "7px" },
      fontBuffer: buf,
      fontUrl: location.origin + "/plugin/star/font.ttf",
      workerUrl: location.origin + "/plugin/none/worker.js"
    }, [buf]);
  }
});
</script>`;

export const CONDITIONS = [
  { id: "control", what: "no sandbox, no CSP", sandbox: null, csp: null, bundle: "q6-plugin.js" },
  { id: "policy", what: "proposed policy", sandbox: "allow-scripts", csp: policy(N), bundle: "q6-plugin.js" },
  { id: "policy-style-none", what: "proposed policy but style-src 'none'", sandbox: "allow-scripts", csp: policy(N, { style: "'none'" }), bundle: "q6-plugin.js" },
  { id: "policy-font-data", what: "proposed policy + font-src data:", sandbox: "allow-scripts", csp: policy(N, { extra: "; font-src data:" }), bundle: "q6-plugin.js" },
  { id: "policy-font-origin", what: `proposed policy + font-src ${APP} (font served with ACAO *)`, sandbox: "allow-scripts", csp: policy(N, { extra: `; font-src ${APP}` }), bundle: "q6-plugin.js" },
  { id: "policy-dev-react", what: "proposed policy, React development build", sandbox: "allow-scripts", csp: policy(N), bundle: "q6-plugin-dev.js" },
];

export async function run({ browser, meta }) {
  const frames = CONDITIONS.map((c) => {
    const id = `q6-${c.id}`;
    registerDoc(id, hostDoc(id, c.bundle), c.csp ? { "content-security-policy": c.csp } : {});
    return { id, src: `/doc/${id}`, sandbox: c.sandbox, width: 400, height: 200 };
  });
  registerDoc("q6-shell", collectorShell(frames, { extraHead: shellScript }));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleLines = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) consoleLines.push({ url: m.location()?.url || "", text: m.text() }); });
  await page.goto(`${APP}/doc/q6-shell`);
  try {
    await page.waitForFunction((n) => window.msgs.filter((m) => m.k === "q6").length >= n, CONDITIONS.length, { timeout: 15000 });
  } catch { /* report what arrived */ }
  await sleep(300);
  const msgs = await page.evaluate(() => window.msgs);
  await ctx.close();
  const out = [];
  const checksSeen = new Set();
  const byCond = {};
  for (const c of CONDITIONS) {
    const id = `q6-${c.id}`;
    const r = msgs.find((m) => m.id === id && m.k === "q6");
    byCond[c.id] = {
      checks: r ? r.v : null,
      csp: msgs.filter((m) => m.id === id && m.k === "csp").map((m) => `${m.v.directive} blocked ${m.v.blocked.slice(0, 60)}`),
      errors: msgs.filter((m) => m.id === id && m.k === "error").map((m) => m.v),
      console: consoleLines.filter((l) => l.url.includes(id)).map((l) => l.text.slice(0, 200)).slice(0, 6),
    };
    if (r) Object.keys(r.v).forEach((k) => checksSeen.add(k));
  }
  for (const check of checksSeen) {
    const outcome = {};
    const detail = {};
    for (const c of CONDITIONS) {
      const v = byCond[c.id].checks?.[check];
      outcome[c.id] = v ? v.ok : null;
      detail[c.id] = v || null;
    }
    out.push({ question: "Q6", test: check, ...meta, attempted: `${check} inside React component`, outcome, controlValid: outcome.control === true || check === "evalRuns" ? true : outcome.control, detail,
      error: Object.entries(detail).filter(([, v]) => v && !v.ok).map(([k, v]) => `${k}: ${v.error || v.got || v.status || ""}`).join(" | ") || null });
  }
  out.push({ question: "Q6", test: "violations", ...meta, attempted: "CSP violations and errors per condition", outcome: Object.fromEntries(CONDITIONS.map((c) => [c.id, byCond[c.id].checks ? "reported" : "no report"])),
    detail: Object.fromEntries(CONDITIONS.map((c) => [c.id, { csp: [...new Set(byCond[c.id].csp)], errors: byCond[c.id].errors, console: byCond[c.id].console }])) });
  return out;
}
