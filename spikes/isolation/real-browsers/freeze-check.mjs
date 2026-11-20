// Freeze check for browsers Playwright can't drive (shipping Safari, shipping Firefox).
//   node freeze-check.mjs   then open http://localhost:4301/ in the browser and leave it in front for ~30 s.
// A frame busy-loops for 3 s while the shell page records the longest gap in a main-thread heartbeat.
// Results are appended to freeze-results.json. All timing uses the shell's own clock.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "freeze-results.json");
const CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";
const ARR = [
  { id: "same-origin-plain", origin: "http://localhost:4301", sandbox: false },
  { id: "same-origin-sandbox", origin: "http://localhost:4301", sandbox: true },
  { id: "other-site-plain", origin: "http://127.0.0.1:4301", sandbox: false },
  { id: "other-site-sandbox", origin: "http://127.0.0.1:4301", sandbox: true },
];

const frame = `<!doctype html><body>frame<script>
addEventListener("message", function (e) {
  if (e.data !== "loop") return;
  parent.postMessage("starting", "*");
  setTimeout(function () { var end = Date.now() + 3000; while (Date.now() < end) {} parent.postMessage("done", "*"); }, 50);
});
parent.postMessage("ready", "*");
</script></body>`;

function shell(i) {
  const a = ARR[i];
  const next = i + 1 < ARR.length ? "/?i=" + (i + 1) : "/summary";
  return `<!doctype html><body style="font:14px sans-serif"><p>${a.id} (${i + 1}/${ARR.length}). Keep this window in front.</p>
<iframe id="f" ${a.sandbox ? 'sandbox="allow-scripts"' : ""} src="${a.origin}/frame${a.sandbox ? "?csp=1" : ""}" width="300" height="60"></iframe>
<script>
var beats = [], startedAt = null, doneAt = null;
// A message-channel loop on the shell's main thread. Unlike a timer, it is not slowed when the window is hidden.
var mc = new MessageChannel(), last = 0;
mc.port1.onmessage = function () { var n = Date.now(); if (n - last >= 5) { beats.push(n); last = n; } mc.port2.postMessage(0); };
mc.port2.postMessage(0);
addEventListener("message", function (e) {
  if (e.data === "ready") setTimeout(function () { document.getElementById("f").contentWindow.postMessage("loop", "*"); }, 800);
  if (e.data === "starting") startedAt = Date.now();
  if (e.data === "done") { doneAt = Date.now(); setTimeout(report, 500); }
});
function report() {
  var max = 0, inWindow = 0;
  for (var k = 1; k < beats.length; k++) {
    if (beats[k] < startedAt) continue;
    if (beats[k - 1] > doneAt) break;
    max = Math.max(max, beats[k] - beats[k - 1]);
    if (beats[k] <= doneAt) inWindow++;
  }
  var r = { arrangement: ${JSON.stringify(a.id)}, userAgent: navigator.userAgent, visible: document.visibilityState,
    doneArrivedAfterMs: doneAt - startedAt, longestTimerGapMs: max, beatsDuringLoop: inWindow, totalBeats: beats.length };
  fetch("/result", { method: "POST", body: JSON.stringify(r) }).then(function () { location.href = ${JSON.stringify(next)}; });
}
</script></body>`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/frame") {
    const h = { "content-type": "text/html" };
    if (url.searchParams.get("csp")) h["content-security-policy"] = CSP;
    res.writeHead(200, h); return res.end(frame);
  }
  if (url.pathname === "/result" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      const all = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : [];
      all.push(JSON.parse(b)); fs.writeFileSync(out, JSON.stringify(all, null, 2));
      res.writeHead(204); res.end();
    });
    return;
  }
  if (url.pathname === "/summary") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<p>Done. Results are in freeze-results.json.</p>"); }
  res.writeHead(200, { "content-type": "text/html" }); res.end(shell(Number(url.searchParams.get("i") || 0)));
}).listen(4301, () => console.log("open http://localhost:4301/"));
