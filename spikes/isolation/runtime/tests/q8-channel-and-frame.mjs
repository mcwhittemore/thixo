// Q8: the channel between shell and an opaque-origin frame, and the frame's place in the page.
// (a) MessagePort transfer both ways, event.origin / event.source on each side, telling two frames apart
// (b) ResizeObserver height reporting with no scrollbars  (c) Tab order shell -> frame -> shell and back
// (d) position:fixed / oversized content stays clipped to the frame  (e) rough cost of N frames vs direct render
import { registerDoc, APP } from "../server.mjs";
import { NONCE, policy, reporter, sleep, median, withTimeout } from "../common.mjs";

const CSP = { "content-security-policy": policy(`'nonce-${NONCE}'`) };

// ---------- (a) channel ----------
function channelFrame(id) {
  return `<!doctype html><html><head><meta charset="utf-8">${reporter(id)}</head><body>
<script nonce="${NONCE}">
var ch = new MessageChannel();
ch.port1.onmessage = function(e){
  if (e.data === "ping") ch.port1.postMessage({ pong: true, frameSawPortOrigin: e.origin, frameSawPortSourceNull: e.source === null, frameOrigin: self.origin });
};
window.addEventListener("message", function(e){
  if (!e.data || !e.data.cmd) return;
  if (e.data.cmd === "direct-star") __r("direct-star-seen", { origin: e.origin, sourceIsParent: e.source === parent });
  if (e.data.cmd === "direct-strict") __r("direct-strict-seen", { origin: e.origin });
  if (e.data.cmd === "shell-port" && e.ports[0]) {
    var p = e.ports[0];
    p.onmessage = function(ev){ p.postMessage({ echo: ev.data, frameSawOrigin: ev.origin }); };
    __r("got-shell-port", { origin: e.origin, sourceIsParent: e.source === parent, ports: e.ports.length });
  }
});
parent.postMessage({ tailorTest: 1, id: ${JSON.stringify(id)}, k: "hello" }, "*", [ch.port2]);
</script></body></html>`;
}

const channelShell = (ids) => `<!doctype html><html><body>
${ids.map((id) => `<iframe id="${id}" sandbox="allow-scripts" src="/doc/${id}" style="width:100px;height:50px;border:0"></iframe>`).join("")}
<script>
window.log = {};
window.addEventListener("message", function(e){
  if (!e.data || e.data.k !== "hello") { if (e.data && e.data.tailorTest) { (log[e.data.id] ||= {})[e.data.k] = e.data.v; } return; }
  var id = e.data.id, mine = document.getElementById(id);
  var other = [${ids.map((i) => JSON.stringify(i)).join(",")}].filter(function(x){ return x !== id; }).map(function(x){ return document.getElementById(x).contentWindow; });
  var L = (log[id] ||= {});
  L.hello = { origin: e.origin, sourceIsThisFrame: e.source === mine.contentWindow, sourceIsOtherFrame: other.indexOf(e.source) >= 0, ports: e.ports.length };
  var port = e.ports[0];
  port.onmessage = function(ev){ L.pong = Object.assign({ shellSawPortOrigin: ev.origin, shellSawPortSourceNull: ev.source === null }, ev.data); };
  port.postMessage("ping");
  mine.contentWindow.postMessage({ cmd: "direct-star" }, "*");
  try { mine.contentWindow.postMessage({ cmd: "direct-strict" }, ${JSON.stringify(APP)}); L.strictThrew = false; } catch (err) { L.strictThrew = String(err); }
  var c2 = new MessageChannel();
  c2.port1.onmessage = function(ev){ L.shellPortReply = { data: ev.data, origin: ev.origin }; };
  mine.contentWindow.postMessage({ cmd: "shell-port" }, "*", [c2.port2]);
  setTimeout(function(){ c2.port1.postMessage("over shell-made port"); }, 100);
});
</script></body></html>`;

async function channelTest(browser, meta) {
  const ids = ["q8-ch-1", "q8-ch-2"];
  ids.forEach((id) => registerDoc(id, channelFrame(id), CSP));
  registerDoc("q8-ch-shell", channelShell(ids));
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${APP}/doc/q8-ch-shell`);
  await sleep(1500);
  const log = await p.evaluate(() => window.log);
  await c.close();
  const a = log[ids[0]] || {}, b = log[ids[1]] || {};
  const ok = !!(a.pong?.pong && b.pong?.pong && a.hello?.sourceIsThisFrame && !a.hello?.sourceIsOtherFrame && b.hello?.sourceIsThisFrame && a.shellPortReply);
  return {
    question: "Q8", test: "a-message-port", ...meta,
    attempted: "frame transfers a MessagePort to the shell; shell pings over it; shell posts to frame with '*' and with its own origin; shell transfers a port to the frame; two frames",
    outcome: ok ? "ports work both ways; e.source identifies the frame" : "incomplete",
    numbers: {
      shellSawHelloOrigin: a.hello?.origin, shellHelloSourceIsThisFrame: a.hello?.sourceIsThisFrame, shellHelloSourceIsOtherFrame: a.hello?.sourceIsOtherFrame,
      secondFrameSourceIsThisFrame: b.hello?.sourceIsThisFrame,
      shellSawPortMessageOrigin: a.pong?.shellSawPortOrigin, shellPortMessageSourceNull: a.pong?.shellSawPortSourceNull,
      frameSawPortMessageOrigin: a.pong?.frameSawPortOrigin, frameSelfOrigin: a.pong?.frameOrigin,
      frameSawDirectStarOrigin: a["direct-star-seen"]?.origin, frameDirectSourceIsParent: a["direct-star-seen"]?.sourceIsParent,
      directWithShellOriginDelivered: !!a["direct-strict-seen"], directWithShellOriginThrew: a.strictThrew,
      shellMadePortDelivered: !!a["got-shell-port"], shellMadePortReply: a.shellPortReply?.data?.echo,
    },
    detail: log,
  };
}

// ---------- shared host doc for (b)-(e): React plugin in the frame, ResizeObserver, port commands ----------
function pluginFrame(id, { rows = 5, extraBody = "", measure = "body" } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8">${reporter(id)}<style>html,body{margin:0}</style></head><body>
<div id="root"></div>${extraBody}
<script nonce="${NONCE}" src="/plugin/none/q8-plugin.js"></script>
<script nonce="${NONCE}">
(function(){
  var api = TailorPlugin.mount(document.getElementById("root"), ${rows});
  var ch = new MessageChannel(), port = ch.port1;
  function metrics(){ var d = document.documentElement; return { scrollHeight: d.scrollHeight, clientHeight: d.clientHeight, innerHeight: innerHeight, clientWidth: d.clientWidth, innerWidth: innerWidth, scrollable: d.scrollHeight > d.clientHeight || d.scrollWidth > d.clientWidth, active: document.activeElement && document.activeElement.id, hasFocus: document.hasFocus() }; }
  // measure "body": the body's own box (shrinks with content). "documentElement": html.scrollHeight, which never drops below the viewport.
  var M = ${JSON.stringify(measure)};
  var target = M === "body" ? document.body : document.documentElement;
  new ResizeObserver(function(){ port.postMessage({ height: M === "body" ? Math.ceil(document.body.getBoundingClientRect().height) : document.documentElement.scrollHeight }); }).observe(target);
  port.onmessage = function(e){
    var m = e.data;
    if (m.cmd === "rows") { api.setRows(m.n); }
    if (m.cmd === "metrics") port.postMessage({ metrics: metrics(), q: m.q });
    if (m.cmd === "overlay") { document.getElementById("overlay").style.display = "block"; requestAnimationFrame(function(){ requestAnimationFrame(function(){ port.postMessage({ overlayShown: true }); }); }); }
  };
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ parent.postMessage({ tailorTest: 1, id: ${JSON.stringify(id)}, k: "painted" }, "*", [ch.port2]); }); });
})();
</script></body></html>`;
}

const hostShellScript = `<script>
window.ports = {}; window.heights = {}; window.replies = {}; window.painted = {};
window.addEventListener("message", function(e){
  if (!e.data || e.data.k !== "painted") return;
  var id = e.data.id, fr = document.getElementById(id);
  if (!fr || e.source !== fr.contentWindow) return;
  painted[id] = performance.now();
  var port = e.ports[0]; ports[id] = port;
  port.onmessage = function(ev){
    if (ev.data.height != null && fr.dataset.autosize) { fr.style.height = ev.data.height + "px"; (heights[id] ||= []).push(ev.data.height); }
    if (ev.data.metrics) replies[id + ":" + ev.data.q] = ev.data.metrics;
    if (ev.data.overlayShown) replies[id + ":overlay"] = true;
  };
});
window.ask = function(id, q){ return new Promise(function(res){ ports[id].postMessage({ cmd: "metrics", q: q }); (function poll(){ if (replies[id + ":" + q]) res(replies[id + ":" + q]); else setTimeout(poll, 10); })(); }); };
</script>`;

// ---------- (b) resize ----------
async function resizeTest(browser, meta, measure = "body") {
  registerDoc("q8-rs", pluginFrame("q8-rs", { rows: 5, measure }), CSP);
  registerDoc("q8-rs-shell", `<!doctype html><html><head>${hostShellScript}</head><body style="margin:0">
<iframe id="q8-rs" data-autosize="1" sandbox="allow-scripts" src="/doc/q8-rs" style="width:320px;height:40px;border:0;display:block"></iframe><p id="after">after</p></body></html>`);
  const c = await browser.newContext({ viewport: { width: 500, height: 900 } });
  const p = await c.newPage();
  await p.goto(`${APP}/doc/q8-rs-shell`);
  await p.waitForFunction(() => window.ports["q8-rs"], null, { timeout: 10000 });
  await sleep(400);
  const m1 = await p.evaluate(() => ask("q8-rs", "m1"));
  const h1 = await p.evaluate(() => document.getElementById("q8-rs").getBoundingClientRect().height);
  await p.evaluate(() => ports["q8-rs"].postMessage({ cmd: "rows", n: 25 }));
  await sleep(500);
  const m2 = await p.evaluate(() => ask("q8-rs", "m2"));
  const h2 = await p.evaluate(() => document.getElementById("q8-rs").getBoundingClientRect().height);
  await p.evaluate(() => ports["q8-rs"].postMessage({ cmd: "rows", n: 2 }));
  await sleep(500);
  const m3 = await p.evaluate(() => ask("q8-rs", "m3"));
  const h3 = await p.evaluate(() => document.getElementById("q8-rs").getBoundingClientRect().height);
  const heights = await p.evaluate(() => heights["q8-rs"]);
  await c.close();
  const ok = [m1, m2, m3].every((m) => !m.scrollable) && h2 > h1 && h3 < h2;
  return { question: "Q8", test: `b-resize-observer-${measure}`, ...meta, attempted: `frame reports its height (${measure === "body" ? "body box, observing body" : "documentElement.scrollHeight"}) via ResizeObserver over its port; shell sets iframe height; rows 5 -> 25 -> 2`,
    outcome: ok ? "frame tracks content height (grow and shrink) with nothing left to scroll" : "frame left scrollable or did not resize",
    numbers: { frameHeights: [h1, h2, h3], scrollableAfterEach: [m1.scrollable, m2.scrollable, m3.scrollable], contentHeights: [m1.scrollHeight, m2.scrollHeight, m3.scrollHeight], reportsReceived: heights?.length },
    detail: { m1, m2, m3 } };
}

// ---------- (c) keyboard ----------
async function tabTest(browser, meta) {
  registerDoc("q8-tab", `<!doctype html><html><head><meta charset="utf-8">${reporter("q8-tab")}</head><body>
<input id="f1" placeholder="frame input"><button id="f2">frame button</button><input id="f3" placeholder="frame input 2">
<script nonce="${NONCE}">
var ch = new MessageChannel();
ch.port1.onmessage = function(e){ if (e.data.cmd === "metrics") ch.port1.postMessage({ metrics: { active: document.activeElement && document.activeElement.id, hasFocus: document.hasFocus() }, q: e.data.q }); };
requestAnimationFrame(function(){ parent.postMessage({ tailorTest: 1, id: "q8-tab", k: "painted" }, "*", [ch.port2]); });
</script></body></html>`, CSP);
  registerDoc("q8-tab-shell", `<!doctype html><html><head>${hostShellScript}</head><body>
<input id="s1" placeholder="shell before"><br><iframe id="q8-tab" sandbox="allow-scripts" src="/doc/q8-tab" style="width:400px;height:60px;border:1px solid #999"></iframe><br><input id="s2" placeholder="shell after">
<script>window.where = async function(q){ var a = document.activeElement; if (a && a.id === "q8-tab") { var m = await ask("q8-tab", q); return "frame:" + m.active; } return "shell:" + (a ? (a.id || a.tagName) : "none"); };</script>
</body></html>`);
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`${APP}/doc/q8-tab-shell`);
  await p.waitForFunction(() => window.ports["q8-tab"], null, { timeout: 10000 });
  await p.click("#s1");
  const seq = [await p.evaluate(() => where("start"))];
  for (let i = 0; i < 4; i++) { await p.keyboard.press("Tab"); await sleep(120); seq.push(await withTimeout(p.evaluate((q) => where(q), "f" + i), 3000).catch(() => "?")); }
  for (let i = 0; i < 4; i++) { await p.keyboard.press("Shift+Tab"); await sleep(120); seq.push(await withTimeout(p.evaluate((q) => where(q), "b" + i), 3000).catch(() => "?")); }
  await c.close();
  const expected = ["shell:s1", "frame:f1", "frame:f2", "frame:f3", "shell:s2", "frame:f3", "frame:f2", "frame:f1", "shell:s1"];
  // Inputs only, with repeats and BODY dropped: what is left must be s1 f1 f3 s2 forward and s2 f3 f1 s1 back.
  const compact = (xs) => xs.filter((x) => !/BODY|f2|\?/.test(x)).filter((x, i, a) => x !== a[i - 1]);
  const inputsInOrder = JSON.stringify(compact(seq)) === JSON.stringify(["shell:s1", "frame:f1", "frame:f3", "shell:s2", "frame:f3", "frame:f1", "shell:s1"]);
  const full = JSON.stringify(seq) === JSON.stringify(expected);
  return { question: "Q8", test: "c-tab-order", ...meta, attempted: "shell input -> Tab x4 -> Shift+Tab x4 across a sandboxed frame holding input, button, input",
    outcome: full ? "Tab goes into the frame, through its controls in order, and back out, both directions"
      : inputsInOrder ? "Tab enters and leaves the frame in order both ways; the button is skipped (Tab reaches text fields only by default here)"
      : "focus order broken (see numbers)",
    tabWorks: full || inputsInOrder, numbers: { sequence: seq, expected } };
}

// ---------- (d) clipping ----------
async function clipTest(browser, meta) {
  const overlay = `<div id="overlay" style="display:none;position:fixed;left:-500px;top:-500px;width:4000px;height:4000px;background:rgb(255,0,0);z-index:2147483647"></div><div style="position:absolute;left:150px;top:80px;width:600px;height:600px;background:rgb(0,0,255)"></div>`;
  registerDoc("q8-clip", pluginFrame("q8-clip", { rows: 1, extraBody: overlay }), CSP);
  registerDoc("q8-clip-shell", `<!doctype html><html><head>${hostShellScript}</head><body style="margin:0;background:#fff">
<iframe id="q8-clip" sandbox="allow-scripts" src="/doc/q8-clip" style="position:absolute;left:100px;top:100px;width:200px;height:100px;border:0"></iframe></body></html>`);
  const c = await browser.newContext({ viewport: { width: 500, height: 400 } });
  const p = await c.newPage();
  await p.goto(`${APP}/doc/q8-clip-shell`);
  await p.waitForFunction(() => window.ports["q8-clip"], null, { timeout: 10000 });
  await sleep(300);
  const regions = { outsideTopLeft: { x: 0, y: 0, width: 90, height: 90 }, outsideRight: { x: 310, y: 100, width: 150, height: 250 }, outsideBelow: { x: 100, y: 210, width: 200, height: 150 }, insideFrame: { x: 110, y: 110, width: 30, height: 30 } };
  const shot = async () => Object.fromEntries(await Promise.all(Object.entries(regions).map(async ([k, clip]) => [k, (await p.screenshot({ clip })).toString("base64")])));
  const before = await shot();
  const scrollBefore = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  await p.evaluate(() => ports["q8-clip"].postMessage({ cmd: "overlay" }));
  await p.waitForFunction(() => window.replies["q8-clip:overlay"], null, { timeout: 5000 });
  await sleep(200);
  const after = await shot();
  const scrollAfter = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  await c.close();
  const changed = Object.fromEntries(Object.keys(regions).map((k) => [k, before[k] !== after[k]]));
  const clipped = !changed.outsideTopLeft && !changed.outsideRight && !changed.outsideBelow;
  return { question: "Q8", test: "d-fixed-clipping", ...meta, attempted: "frame shows a position:fixed 4000x4000 red overlay at -500,-500 with max z-index, plus an absolutely positioned 600x600 box running past its edges; compare screenshots of shell regions outside the frame",
    outcome: !changed.insideFrame ? "harness: overlay did not paint inside the frame" : clipped ? "clipped: nothing in the frame paints outside its box; overlays must be drawn by the shell" : "frame content painted outside the frame",
    controlValid: changed.insideFrame, numbers: { regionChanged: changed, shellScrollSizeBefore: scrollBefore, shellScrollSizeAfter: scrollAfter } };
}

// ---------- (e) cost ----------
function costShell() {
  return `<!doctype html><html><head>${hostShellScript}</head><body>
<div id="host"></div>
<script>
window.runFrames = function(n){
  return new Promise(function(resolve){
    var t0 = performance.now(), ids = [];
    for (var i = 0; i < n; i++) { var f = document.createElement("iframe"); f.id = "cost-" + i; f.setAttribute("sandbox", "allow-scripts"); f.src = "/doc/q8-cost?i=" + i; f.style.cssText = "width:300px;height:200px;border:0"; ids.push(f.id); document.getElementById("host").appendChild(f); }
    (function poll(){ var done = ids.filter(function(id){ return painted[id]; }); if (done.length === n) { var ts = ids.map(function(id){ return painted[id] - t0; }); resolve({ allMs: Math.max.apply(null, ts), firstMs: Math.min.apply(null, ts) }); } else setTimeout(poll, 2); })();
  });
};
window.runDirect = function(n){
  return new Promise(function(resolve){
    var t0 = performance.now(); var s = document.createElement("script"); s.src = "/plugin/none/q8-plugin.js";
    s.onload = function(){
      for (var i = 0; i < n; i++) { var d = document.createElement("div"); d.style.cssText = "width:300px;height:200px;overflow:hidden;display:inline-block"; document.getElementById("host").appendChild(d); TailorPlugin.mount(d, 20); }
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ var t = performance.now() - t0; resolve({ allMs: t, firstMs: t }); }); });
    };
    document.head.appendChild(s);
  });
};
</script></body></html>`;
}

async function costTest(browser, meta) {
  // Each frame is its own document and loads its own copy of React from the (HTTP-cached) bundle.
  registerDoc("q8-cost", pluginFrame("q8-cost-x", { rows: 20 }).replace(/"q8-cost-x"/g, "location.search.replace('?i=', 'cost-')"), CSP);
  registerDoc("q8-cost-shell", costShell());
  const RUNS = 5;
  const res = {};
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await c.newPage();
  await p.goto(`${APP}/doc/q8-cost-shell`);
  await withTimeout(p.evaluate(() => runFrames(1)), 20000); // warm the HTTP cache
  for (const n of [1, 5, 20]) {
    for (const mode of ["frames", "direct"]) {
      const xs = [];
      for (let r = 0; r < RUNS; r++) {
        await p.goto(`${APP}/doc/q8-cost-shell`);
        const v = await withTimeout(p.evaluate(([m, k]) => (m === "frames" ? runFrames(k) : runDirect(k)), [mode, n]), 60000);
        xs.push(Math.round(v.allMs));
      }
      res[`${mode}-${n}`] = { medianMs: median(xs), runsMs: xs };
    }
  }
  await c.close();
  return { question: "Q8", test: "e-cost", ...meta, attempted: `time from insertion to painted (React render + 2 rAF), ${RUNS} runs each, warm HTTP cache; frames = N sandboxed frames each running its own React; direct = one React in the shell rendering N roots`,
    outcome: "measured (rough; headless, one machine)", numbers: res };
}

export async function run({ browser, meta }) {
  const out = [];
  const resizeHtml = (b, m) => resizeTest(b, m, "documentElement");
  Object.defineProperty(resizeHtml, "name", { value: "resizeTestDocumentElement" });
  for (const t of [channelTest, resizeTest, resizeHtml, tabTest, clipTest, costTest]) {
    try { out.push(await t(browser, meta)); } catch (e) { out.push({ question: "Q8", test: t.name, ...meta, outcome: "harness error", error: String(e.message).split("\n")[0] }); }
  }
  return out;
}
