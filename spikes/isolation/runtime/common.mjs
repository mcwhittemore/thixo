// Shared bits: the proposed policy, the in-frame reporter, and a shell page that collects what frames report.
export const NONCE = "tailorN0nce4201";

// The proposed plugin-document policy, with script-src (and optional overrides) to fill in.
export function policy(scriptSrc, { style = "'unsafe-inline'", extra = "" } = {}) {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src ${style}`,
    "img-src data: blob:",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ") + extra;
}

// Runs first in every frame doc. __r(k, v) posts to the parent tagged with this doc's id.
// Records CSP violations and load/runtime errors so a "no" has a reason attached.
export function reporter(id) {
  return `<script nonce="${NONCE}">
(function(){
  var id = ${JSON.stringify(id)};
  window.__r = function(k, v){ try { parent.postMessage({ tailorTest: 1, id: id, k: k, v: v }, "*"); } catch (e) {} };
  document.addEventListener("securitypolicyviolation", function(e){
    __r("csp", { directive: e.effectiveDirective || e.violatedDirective, blocked: String(e.blockedURI || ""), sample: e.sample || "", disposition: e.disposition });
  });
  window.addEventListener("error", function(e){
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) __r("error", "load error: " + (t.src || t.href));
    else __r("error", String(e.message || e.error));
  }, true);
  window.addEventListener("unhandledrejection", function(e){ __r("error", "rejection: " + String(e.reason && (e.reason.message || e.reason))); });
  window.__originInfo = { origin: self.origin, isSecureContext: self.isSecureContext };
})();
</script>`;
}

// A shell page that embeds frames and keeps every tagged message in window.msgs.
export function collectorShell(frames, { extraHead = "", extraBody = "" } = {}) {
  const tags = frames.map((f) => `<iframe id="${f.id}" data-id="${f.id}" ${f.sandbox == null ? "" : `sandbox="${f.sandbox}"`} src="${f.src}" style="width:${f.width || 300}px;height:${f.height || 150}px;border:0"></iframe>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">${extraHead}
<script>
window.msgs = [];
window.addEventListener("message", function(e){
  if (e.data && e.data.tailorTest) {
    var fr = document.getElementById(e.data.id);
    window.msgs.push({ id: e.data.id, k: e.data.k, v: e.data.v, origin: e.origin, sourceIsFrame: !!(fr && e.source === fr.contentWindow) });
  }
});
</script></head><body>
${tags}
${extraBody}
</body></html>`;
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(p, ms, label = "timeout") {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} after ${ms}ms`)), ms); })]).finally(() => clearTimeout(t));
}
