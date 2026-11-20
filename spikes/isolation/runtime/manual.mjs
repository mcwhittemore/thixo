// Manual Q3 runner for browsers Playwright can't drive (shipping Safari, shipping Firefox).
//   node manual.mjs      then open http://localhost:4201/doc/manual-q3-0 in the browser and wait ~30 s.
// Each page runs one arrangement (frame busy-loops 3 s, shell records heartbeat gaps), posts its result to this
// server, and moves on. Results append to manual-results.json, tagged with the browser's user agent. Ctrl-C to stop.
// There is no click test here: nothing drives input.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServers, registerDoc, addRoute, APP } from "./server.mjs";
import { NONCE, policy } from "./common.mjs";
import { ARRANGEMENTS, frameDoc, shellDoc } from "./tests/q3-main-thread.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "manual-results.json");
const arrs = ARRANGEMENTS;

arrs.forEach((arr, i) => {
  const fid = `manual-frame-${arr.id}`;
  registerDoc(fid, frameDoc(fid), arr.csp ? { "content-security-policy": policy(`'nonce-${NONCE}'`) } : {});
  const next = i + 1 < arrs.length ? `/doc/manual-q3-${i + 1}` : "/manual-summary";
  const auto = `<p style="position:absolute;top:270px;left:10px;font:14px sans-serif">Arrangement ${arr.id}: ${arr.what} (${i + 1}/${arrs.length})</p>
<script>
(function(){
  function waitReady(){ if (msgs.some(function(m){ return m.k === "ready"; })) setTimeout(go, 600); else setTimeout(waitReady, 50); }
  function go(){
    startLoop(3000);
    setTimeout(function(){
      var l = (msgs.find(function(m){ return m.k === "looped"; }) || {}).v;
      var from = l ? l.start : goAt, to = l ? l.end : goAt + 3000;
      function gap(a){ var m = 0, prev = null; for (var i = 0; i < a.length; i++) { var t = a[i]; if (t < from - 50) { prev = t; continue; } if (prev != null) m = Math.max(m, t - prev); prev = t; if (t > to + 200) break; } return m; }
      var r = { arrangement: ${JSON.stringify(arr.id)}, what: ${JSON.stringify(arr.what)}, userAgent: navigator.userAgent, loopMs: l ? l.end - l.start : null, maxIntervalGapMs: gap(beats.interval), maxRafGapMs: gap(beats.raf), at: new Date().toISOString() };
      fetch("/manual-result", { method: "POST", body: JSON.stringify(r) }).then(function(){ location.href = ${JSON.stringify(next)}; });
    }, 4200);
  }
  waitReady();
})();
</script>`;
  registerDoc(`manual-q3-${i}`, shellDoc(`${arr.origin}/doc/${fid}`, arr.sandbox).replace("</body>", auto + "</body>"));
});

addRoute((req, res, url) => {
  if (url.pathname === "/manual-result" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const all = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
      all.push(JSON.parse(body));
      fs.writeFileSync(out, JSON.stringify(all, null, 2));
      res.writeHead(204); res.end();
    });
    return true;
  }
  if (url.pathname === "/manual-summary") {
    const all = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
    const rows = all.map((r) => `<tr><td>${r.arrangement}</td><td>${r.what}</td><td>${r.maxIntervalGapMs}</td><td>${r.maxRafGapMs}</td><td>${r.maxIntervalGapMs > 2400 ? "shell froze" : "shell kept running"}</td><td style="font-size:11px">${r.userAgent}</td></tr>`).join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>manual Q3</title><body style="font:14px sans-serif"><h1>Q3 manual results</h1><table border="1" cellpadding="4"><tr><th>arr</th><th>what</th><th>max interval gap ms</th><th>max rAF gap ms</th><th>reading</th><th>user agent</th></tr>${rows}</table><p>Saved to manual-results.json.</p></body>`);
    return true;
  }
  return false;
});

await startServers();
console.log(`Open ${APP}/doc/manual-q3-0 in the browser to test (Safari, Firefox...). Results go to ${out}. Ctrl-C to stop.`);
