// Q3: does a plugin frame share a main thread / process with the shell?
// Four arrangements: (a) same-origin frame, no sandbox; (b) same-origin, sandbox="allow-scripts" + proposed CSP;
// (c) different site (127.0.0.1 vs localhost), no sandbox; (d) different site, sandbox + CSP.
// The frame busy-loops for 3 s. The shell keeps a setInterval + requestAnimationFrame heartbeat and a click handler;
// Playwright clicks the shell 1 s into the loop. A second test runs an infinite loop and asks the shell to remove
// the frame. Process counts come from CDP (Chromium) or ps (all).
import { execFileSync } from "node:child_process";
import { registerDoc, APP, OTHER } from "../server.mjs";
import { NONCE, policy, reporter, sleep, withTimeout } from "../common.mjs";

const LOOP_MS = 3000;
export const ARRANGEMENTS = [
  { id: "a", what: "same origin, no sandbox", origin: APP, sandbox: null, csp: false },
  { id: "b", what: "same origin, sandbox=allow-scripts + proposed CSP", origin: APP, sandbox: "allow-scripts", csp: true },
  { id: "c", what: "different site (127.0.0.1), no sandbox", origin: OTHER, sandbox: null, csp: false },
  { id: "d", what: "different site (127.0.0.1), sandbox + proposed CSP", origin: OTHER, sandbox: "allow-scripts", csp: true },
  { id: "b-attr-only", what: "same origin, sandbox attribute only (no CSP header)", origin: APP, sandbox: "allow-scripts", csp: false },
];

export function frameDoc(id) {
  return `<!doctype html><html><head><meta charset="utf-8">${reporter(id)}</head><body style="margin:0;background:#eef">
<p id="t">plugin frame</p>
<script nonce="${NONCE}">
window.addEventListener("message", function(e){
  if (!e.data || !e.data.cmd) return;
  if (e.data.cmd === "loop") {
    var start = Date.now(), end = start + e.data.ms;
    while (Date.now() < end) {}
    __r("looped", { start: start, end: Date.now() });
  }
  if (e.data.cmd === "forever") { __r("forever-start", Date.now()); while (true) {} }
});
__r("ready", { origin: self.origin });
</script></body></html>`;
}

export function shellDoc(src, sandbox) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<button id="btn" style="position:absolute;left:10px;top:10px;width:200px;height:60px">shell button</button>
<iframe id="f" ${sandbox ? `sandbox="${sandbox}"` : ""} src="${src}" style="position:absolute;left:10px;top:100px;width:300px;height:150px;border:0"></iframe>
<script>
window.msgs = []; window.beats = { interval: [], raf: [] }; window.clicks = [];
window.addEventListener("message", function(e){ if (e.data && e.data.tailorTest) msgs.push({ k: e.data.k, v: e.data.v, at: Date.now() }); });
document.getElementById("btn").addEventListener("click", function(e){ clicks.push({ handledAt: Date.now() }); });
setInterval(function(){ beats.interval.push(Date.now()); }, 10);
(function tick(){ beats.raf.push(Date.now()); requestAnimationFrame(tick); })();
window.startLoop = function(ms){ window.goAt = Date.now(); document.getElementById("f").contentWindow.postMessage({ cmd: "loop", ms: ms }, "*"); return goAt; };
window.startForever = function(){ window.goAt = Date.now(); document.getElementById("f").contentWindow.postMessage({ cmd: "forever" }, "*"); return goAt; };
window.maxGap = function(arr, from, to){ var m = 0, prev = null; for (var i = 0; i < arr.length; i++) { var t = arr[i]; if (t < from) { prev = t; continue; } if (t > to) { if (prev != null) m = Math.max(m, t - prev); break; } if (prev != null) m = Math.max(m, t - prev); prev = t; } return m; };
</script></body></html>`;
}

function psSnapshot() {
  try {
    return execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8", maxBuffer: 1 << 24 }).split("\n").filter(Boolean).map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m && { pid: +m[1], ppid: +m[2], args: m[3] };
    }).filter(Boolean);
  } catch { return []; }
}

// Renderer-ish processes belonging to this run: descendants of this node process (Chromium, Firefox) plus WebKit's
// XPC WebContent processes from the Playwright build, which launchd parents rather than the browser.
function rendererCount(browserName) {
  const ps = psSnapshot();
  const kids = new Map();
  ps.forEach((p) => { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); });
  const desc = [];
  const walk = (pid) => (kids.get(pid) || []).forEach((c) => { desc.push(c); walk(c.pid); });
  walk(process.pid);
  if (browserName.startsWith("chrom")) return desc.filter((p) => /--type=renderer/.test(p.args) && !/--extension-process/.test(p.args)).length;
  if (browserName.startsWith("firefox")) return desc.filter((p) => /plugin-container/.test(p.args) && /-isForBrowser|\stab$/.test(p.args)).length;
  if (browserName.startsWith("webkit")) return ps.filter((p) => /ms-playwright\/webkit[^ ]*\/.*WebContent/.test(p.args)).length;
  return null;
}

async function cdpInfo(browser, page) {
  if (!browser.newBrowserCDPSession) return null;
  try {
    const s = await browser.newBrowserCDPSession();
    const info = await s.send("SystemInfo.getProcessInfo");
    const targets = await s.send("Target.getTargets");
    await s.detach();
    return {
      rendererProcesses: info.processInfo.filter((p) => p.type === "renderer").length,
      iframeTargets: targets.targetInfos.filter((t) => t.type === "iframe").map((t) => t.url),
    };
  } catch (e) { return { error: String(e.message).split("\n")[0] }; }
}

// Two plugins from the app origin, both sandboxed: does one stuck plugin stall the other?
function siblingDoc(id) {
  return `<!doctype html><html><head><meta charset="utf-8">${reporter(id)}</head><body>
<script nonce="${NONCE}">
var beats = []; setInterval(function(){ beats.push(Date.now()); }, 10);
window.addEventListener("message", function(e){ if (e.data && e.data.cmd === "beats") __r("beats", beats); });
__r("ready", 1);
</script></body></html>`;
}

async function siblingTest(ctx) {
  const { meta } = ctx;
  registerDoc("q3-sib-loop", frameDoc("q3-sib-loop"), { "content-security-policy": policy(`'nonce-${NONCE}'`) });
  registerDoc("q3-sib-beat", siblingDoc("q3-sib-beat"), { "content-security-policy": policy(`'nonce-${NONCE}'`) });
  registerDoc("q3-sib-shell", `<!doctype html><html><body>
<iframe id="l" sandbox="allow-scripts" src="/doc/q3-sib-loop"></iframe><iframe id="h" sandbox="allow-scripts" src="/doc/q3-sib-beat"></iframe>
<script>window.msgs = []; window.addEventListener("message", function(e){ if (e.data && e.data.tailorTest) msgs.push({ id: e.data.id, k: e.data.k, v: e.data.v }); });</script></body></html>`);
  const entry = { question: "Q3", test: "sibling-plugins-b", ...meta, attempted: "two sandboxed frames from the app origin; one busy-loops 3 s, the other keeps its own 10 ms heartbeat", arrangement: "b" };
  const c = await ctx.browser.newContext();
  try {
    const p = await c.newPage();
    await p.goto(`${APP}/doc/q3-sib-shell`);
    await p.waitForFunction(() => msgs.filter((m) => m.k === "ready").length >= 2, null, { timeout: 10000 });
    await sleep(500);
    await p.evaluate((ms) => document.getElementById("l").contentWindow.postMessage({ cmd: "loop", ms }, "*"), LOOP_MS);
    await sleep(LOOP_MS + 1200);
    await withTimeout(p.evaluate(() => document.getElementById("h").contentWindow.postMessage({ cmd: "beats" }, "*")), 10000);
    await p.waitForFunction(() => msgs.some((m) => m.k === "beats"), null, { timeout: 10000 });
    const r = await p.evaluate(() => ({ looped: msgs.find((m) => m.k === "looped").v, beats: msgs.find((m) => m.k === "beats").v }));
    let m = 0, prev = null;
    for (const t of r.beats) { if (t < r.looped.start - 50) { prev = t; continue; } if (prev != null) m = Math.max(m, t - prev); prev = t; if (t > r.looped.end + 200) break; }
    entry.numbers = { siblingMaxGapMs: m };
    entry.outcome = m > LOOP_MS * 0.8 ? "the other plugin froze too (sandboxed same-origin frames share one thread)" : "the other plugin kept running";
    entry.siblingIsolated = m <= LOOP_MS * 0.8;
  } catch (e) { entry.outcome = "error"; entry.error = String(e.message).split("\n")[0]; }
  await withTimeout(c.close(), 10000).catch(async () => { await ctx.relaunch(); });
  return entry;
}

export async function run(ctx) {
  const { meta } = ctx;
  const out = [];
  out.push(await siblingTest(ctx));
  for (const arr of ARRANGEMENTS) {
    const fid = `q3-frame-${arr.id}`;
    registerDoc(fid, frameDoc(fid), arr.csp ? { "content-security-policy": policy(`'nonce-${NONCE}'`) } : {});
    const sid = `q3-shell-${arr.id}`;
    registerDoc(sid, shellDoc(`${arr.origin}/doc/${fid}`, arr.sandbox));

    // --- 3 s busy loop ---
    const before = rendererCount(meta.browser);
    const context = await ctx.browser.newContext({ viewport: { width: 400, height: 300 } });
    const page = await context.newPage();
    const entry = { question: "Q3", test: `busy-loop-${arr.id}`, ...meta, attempted: `${arr.what}: frame busy-loops ${LOOP_MS} ms; shell heartbeat + click 1 s in`, arrangement: arr.id };
    try {
      await page.goto(`${APP}/doc/${sid}`);
      await page.waitForFunction(() => msgs.some((m) => m.k === "ready"), null, { timeout: 10000 });
      await sleep(600);
      const procs = { psRenderersBefore: before, psRenderersWithPage: rendererCount(meta.browser), cdp: await cdpInfo(ctx.browser, page) };
      const goAt = await page.evaluate((ms) => startLoop(ms), LOOP_MS);
      await sleep(1000);
      const clickSentAt = Date.now();
      const clickP = page.mouse.click(110, 40).then(() => Date.now(), (e) => "click error: " + e.message.split("\n")[0]);
      await sleep(LOOP_MS + 1200);
      const clickResolvedAt = await withTimeout(clickP, 10000).catch((e) => String(e.message));
      const r = await withTimeout(page.evaluate(() => ({ msgs, clicks, goAt, beats })), 15000);
      const looped = r.msgs.find((m) => m.k === "looped")?.v;
      const from = looped ? looped.start : goAt, to = looped ? looped.end : goAt + LOOP_MS;
      const gap = (a) => { let m = 0, prev = null; for (const t of a) { if (t < from - 50) { prev = t; continue; } if (prev != null) m = Math.max(m, t - prev); prev = t; if (t > to + 200) break; } return m; };
      const click = r.clicks[0];
      const shellFrozen = gap(r.beats.interval) > LOOP_MS * 0.8;
      entry.numbers = {
        loopMs: looped ? looped.end - looped.start : null,
        maxIntervalGapMs: gap(r.beats.interval),
        maxRafGapMs: gap(r.beats.raf),
        clickSentAfterLoopStartMs: looped ? clickSentAt - looped.start : null,
        clickHandledAfterLoopStartMs: click && looped ? click.handledAt - looped.start : null,
        clickHandledDuringLoop: click && looped ? click.handledAt < looped.end : null,
        clickApiResolvedAfterLoopStartMs: typeof clickResolvedAt === "number" && looped ? clickResolvedAt - looped.start : clickResolvedAt,
      };
      entry.processes = procs;
      entry.outcome = !looped ? "frame never reported loop end" : shellFrozen ? "shell frozen for the whole loop (shared main thread)" : "shell kept running during the loop (separate thread/process)";
      entry.shellIsolated = looped ? !shellFrozen : null;
    } catch (e) {
      entry.outcome = "error"; entry.error = String(e.message).split("\n")[0];
    }
    out.push(entry);
    await withTimeout(context.close(), 10000).catch(async () => { await ctx.relaunch(); });

    // --- infinite loop: can the shell still run and remove the frame? ---
    const e2 = { question: "Q3", test: `infinite-loop-${arr.id}`, ...meta, attempted: `${arr.what}: frame runs while(true){}; after 1.5 s the shell tries to run JS and remove the frame`, arrangement: arr.id };
    const c2 = await ctx.browser.newContext({ viewport: { width: 400, height: 300 } });
    const p2 = await c2.newPage();
    try {
      await p2.goto(`${APP}/doc/${sid}`);
      await p2.waitForFunction(() => msgs.some((m) => m.k === "ready"), null, { timeout: 10000 });
      await p2.evaluate(() => startForever());
      await sleep(1500);
      const t0 = Date.now();
      const res = await withTimeout(p2.evaluate(() => { const b = beats.interval.length; document.getElementById("f").remove(); return new Promise((r) => setTimeout(() => r({ beatsGrew: beats.interval.length > b, at: Date.now() }), 300)); }), 6000, "shell evaluate").then((v) => ({ ok: true, v }), (e) => ({ ok: false, error: e.message }));
      e2.numbers = { shellRespondedAfterMs: res.ok ? Date.now() - t0 : null };
      if (res.ok) {
        await sleep(300);
        const after = await withTimeout(p2.evaluate(() => { const n = beats.interval.length; return new Promise((r) => setTimeout(() => r(beats.interval.length - n), 500)); }), 5000).catch(() => null);
        e2.numbers.heartbeatsIn500msAfterRemoval = after;
        e2.outcome = "shell stayed responsive and removed the stuck frame";
        e2.shellIsolated = true;
      } else {
        e2.outcome = "shell unresponsive (could not run JS within 6 s): the stuck frame hangs the whole page";
        e2.shellIsolated = false;
        e2.error = res.error;
      }
    } catch (e) { e2.outcome = "error"; e2.error = String(e.message).split("\n")[0]; }
    out.push(e2);
    // A hung renderer may not close cleanly; relaunch the browser if it doesn't.
    await withTimeout(c2.close(), 8000).catch(async () => { await ctx.relaunch(); });
  }
  return out;
}
