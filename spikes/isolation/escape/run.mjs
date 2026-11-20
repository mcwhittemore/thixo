// Runs every escape test in every browser and writes results.json and results.md.
//   node run.mjs                       everything
//   node run.mjs --q Q4 --browser chromium --only webrtc --no-control
import "./webkit-compat.mjs";
import { chromium, firefox, webkit } from "playwright";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startServers, events } from "./servers.mjs";
import { tests, caseList } from "./cases.mjs";
import { pluginCsp } from "./pages.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const onlyQ = arg("--q"), onlyB = arg("--browser"), only = arg("--only");
const noControl = args.includes("--no-control");
const outName = arg("--out") || "results";

const BROWSERS = [
  { name: "chromium", type: chromium, opts: {} },
  { name: "chrome", type: chromium, opts: { channel: "chrome" } },
  // Firefox leaves loopback interfaces out of ICE by default; without this pref no STUN packet can reach a
  // listener on 127.0.0.1 even from an unrestricted page. It is a browser pref, not a system setting.
  { name: "firefox", type: firefox, opts: { firefoxUserPrefs: { "media.peerconnection.ice.loopback": true } } },
  { name: "webkit", type: webkit, opts: {} },
].filter((b) => !onlyB || onlyB.split(",").includes(b.name));

const sel = tests.filter((t) => (!onlyQ || onlyQ.split(",").includes(t.q)) && (!only || t.id.includes(only)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function relevantConsole(msgs) {
  return msgs.filter((m) => /security policy|csp|sandbox|refused|blocked|unsafe attempt|not allowed|denied|insecure|violat/i.test(m)).slice(0, 6).map((m) => m.slice(0, 300));
}

function gather(t, tk, t0, t1) {
  const win = events.filter((e) => e.t >= t0 && e.t <= t1);
  const http = win.filter((e) => (e.type === "http" || e.type === "ws-upgrade") && e.raw && e.raw.includes(tk));
  const udp = t.udp ? win.filter((e) => e.type === "udp" && (e.username ? e.username.includes(tk) : (e.txFirstSeen ?? e.t) >= t0)) : [];
  const tcp = t.tcp ? win.filter((e) => e.type === "tcp" && (e.requests.length === 0 || e.requests.some((u) => u.includes(tk)))) : [];
  return { http, udp, tcp };
}

async function runOne(browser, t, mode) {
  const tk = "t" + crypto.randomBytes(5).toString("hex");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const reports = [];
  const consoleMsgs = [];
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  await page.exposeBinding("__report", (_src, s) => { try { const d = JSON.parse(s); if (d.tk === tk) { reports.push(d); if (d.done && d.from === "frame") resolveDone(); } } catch {} });
  page.on("console", (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => consoleMsgs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  let harnessError = null;
  try {
    await page.goto(`http://localhost:4101/shell?id=${encodeURIComponent(t.id)}&tk=${tk}&mode=${mode}`, { waitUntil: "load", timeout: 10000 });
  } catch (e) { harnessError = "goto: " + e.message.split("\n")[0]; }
  await Promise.race([done, sleep((t.wait ?? 300) + 6000)]);
  const gotDone = reports.some((r) => r.done && r.from === "frame");
  await sleep(t.settle ?? (t.udp ? 1500 : t.tcp ? 1000 : 700));
  const t1 = Date.now();
  await ctx.close().catch(() => {});
  await sleep(150);
  const ev = gather(t, tk, t0, t1);
  const appEv = events.filter((e) => e.server === "app" && e.t >= t0 && e.t <= t1 && e.raw.includes(tk));
  return { tk, reports, consoleMsgs, ev, appEv, gotDone, harnessError };
}

const short = { fetch: "fetch", XMLHttpRequest: "XHR", WebSocket: "WS", RTCPeerConnection: "RTC" };

function frameOut(r) {
  const f = [...r.reports].reverse().find((x) => x.from === "frame");
  return f ? f.out : { notes: {}, errors: [], csp: [] };
}

function blockReason(r, out) {
  const csp = [...new Set([...(out.csp || []), ...r.reports.filter((x) => x.from !== "frame").flatMap((x) => (x.out && x.out.csp) || [])].map((s) => s.split(" ")[0]))];
  if (csp.length) return "blocked: CSP " + csp.join(",");
  const c = relevantConsole(r.consoleMsgs);
  const sb = c.find((m) => /sandbox|allow-top-navigation|allow-popups|allow-forms/i.test(m));
  if (sb) { const f = sb.match(/'(allow-[a-z-]+)'/); return "blocked: sandbox" + (f ? " (no " + f[1] + ")" : ""); }
  const cspMsg = c.find((m) => /content.security.policy/i.test(m));
  if (cspMsg) { const d = cspMsg.match(/directive:? ["“]?([a-z-]+)/i) || cspMsg.match(/\(([a-z-]+-src|[a-z-]+)\)/i) || cspMsg.match(/in the ([a-z-]+) directive/i); return "blocked: CSP" + (d ? " " + d[1] : " (console)"); }
  if (out.errors && out.errors.length) return "threw: " + out.errors[0].slice(0, 60);
  const notes = out.notes || {};
  for (const k of ["r", "rtc", "ret", "na"]) {
    if (typeof notes[k] === "string" && notes[k] !== "constructed" && notes[k] !== "called") return "no request (" + k + ": " + notes[k].slice(0, 50) + ")";
    if (notes[k] && typeof notes[k] === "object" && notes[k].err) return "threw: " + notes[k].err.slice(0, 60);
  }
  return "no request (no error seen)";
}

function leakDetail(ev) {
  const parts = [];
  if (ev.http.length) parts.push([...new Set(ev.http.map((e) => (e.type === "ws-upgrade" ? "ws-upgrade" : e.method) + (e.purpose ? " " + e.purpose : "")))].join("/"));
  if (ev.udp.length) {
    const users = ev.udp.filter((e) => e.username).length;
    parts.push("udp " + ev.udp.length + " pkts" + (users ? ", TURN USERNAME carried token" : ""));
  }
  if (ev.tcp.length) parts.push(ev.tcp.some((e) => e.requests.length) ? "tcp+request" : "TCP connect only");
  return parts.join("; ");
}

function cell(t, r, control) {
  if (r.harnessError && !r.reports.length) return { text: "harness error", saw: false };
  const out = frameOut(r);
  const saw = r.ev.http.length > 0 || r.ev.udp.length > 0 || r.ev.tcp.length > 0;
  const ctlNote = control && !control.saw && t.kind !== "probe" && t.kind !== "q1" ? " [control did not reach either]" : "";
  if (t.kind === "leak" || t.kind === "nav") {
    if (saw) return { text: "LEAKED (" + leakDetail(r.ev) + ")", saw };
    if (control && !control.saw) return { text: "n/a: control failed too (" + blockReason(r, out).replace(/^blocked: /, "") + ")", saw };
    return { text: blockReason(r, out), saw };
  }
  if (t.kind === "nav-app" || t.kind === "whoami") {
    const a = r.appEv[0];
    let text = a ? `reached A, cookies: [${a.cookies.join(",") || "none"}]` : blockReason(r, out) + ctlNote;
    if (out.notes.result) text += "; response: " + String(out.notes.result).replace(/\{.*\}/, (m) => m.length > 80 ? m.slice(0, 80) + "…" : m);
    return { text, saw: !!a };
  }
  if (t.kind === "probe") {
    const n = { ...out.notes }; delete n.parentTypes;
    const text = Object.entries(n).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ") + (out.errors.length ? "; threw " + out.errors[0] : "");
    return { text: text.slice(0, 400) || "no report", saw };
  }
  if (t.kind === "q1") {
    const c = out.notes.child || {};
    const parts = [];
    if (c.none) parts.push(c.none);
    else if (!Object.keys(c).length && t.caseId.startsWith("replay")) parts.push("assign: " + (out.notes.assign || "?"));
    else if (!Object.keys(c).length) parts.push("no report" + (out.errors.length ? " (threw " + out.errors[0].slice(0, 50) + ")" : ""));
    else {
      const got = Object.keys(short).filter((k) => c[k] === "function").map((k) => short[k]);
      if (got.length) parts.push("realm: " + got.join(" "));
      else parts.push("no realm access (" + String(c.fetch).slice(0, 25) + ")");
      if (c.Function === "function") parts.push("Function(): " + (c.FunctionCall === 7 ? "ran" : "blocked"));
    }
    const kids = r.reports.filter((x) => x.from && x.from.startsWith("child-"));
    if (kids.length) { const k = kids[kids.length - 1].out; parts.push(`child script ran (origin ${k.origin}, Function ${k.fn === 7 ? "ran" : "blocked"})`); }
    const via = [...new Set(r.ev.http.map((e) => new URL(e.url, "http://x").searchParams.get("s")).filter(Boolean).map((s) => s.replace(/^[a-z]+-/, "")))];
    if (r.ev.udp.length) via.push("rtc(" + r.ev.udp.length + " udp" + (r.ev.udp.some((e) => e.username) ? ", username" : "") + ")");
    parts.push(via.length ? "LEAKED via " + via.join(",") : "net: nothing reached collector");
    const cspNote = blockReason(r, out);
    if (cspNote.startsWith("blocked: CSP")) parts.push(cspNote.replace("blocked: ", "") + " seen");
    return { text: parts.join("; "), saw };
  }
  return { text: "?", saw };
}

const results = [];
const untestable = [];
const mergeFrom = arg("--merge");
if (mergeFrom) {
  for (const f of mergeFrom.split(",")) { const j = JSON.parse(fs.readFileSync(path.join(here, f), "utf8")); results.push(...j.results); untestable.push(...(j.untestable || [])); }
  writeOut();
  console.log("merged", results.length, "rows");
  process.exit(0);
}
const stop = await startServers();

try {
  for (const b of BROWSERS) {
    let browser;
    try { browser = await b.type.launch(b.opts); } catch (e) { console.log(b.name, "launch failed", e.message); continue; }
    const version = browser.version();
    // Preflight: can this build open a page at all? (Playwright 1.65 on macOS 14 ships a frozen WebKit build
    // that fails here with a protocol error.) A browser that cannot is recorded as untestable, not as results.
    const pre = await Promise.race([
      (async () => { const c = await browser.newContext(); const p = await c.newPage(); await p.goto("http://localhost:4101/shell?id=fetch%40full&tk=tpre&mode=control"); await c.close(); return null; })().catch((e) => e.message.split("\n")[0]),
      sleep(20000).then(() => "preflight timed out after 20 s"),
    ]);
    if (pre) {
      console.log(`== ${b.name} ${version}: NOT TESTABLE: ${pre}`);
      untestable.push({ browser: b.name, browserVersion: version, reason: pre });
      await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
      writeOut();
      continue;
    }
    console.log(`== ${b.name} ${version}`);
    const controls = new Map();
    const relaunch = async () => { try { await browser.close(); } catch {} browser = await b.type.launch(b.opts); console.log("  (relaunched " + b.name + ")"); };
    const safeRun = async (t, mode) => {
      for (let i = 0; i < 2; i++) {
        try { if (!browser.isConnected()) await relaunch(); return await runOne(browser, t, mode); }
        catch (e) { console.log("  harness: " + e.message.split("\n")[0]); await relaunch(); }
      }
      return { tk: "", reports: [], consoleMsgs: [], ev: { http: [], udp: [], tcp: [] }, appEv: [], gotDone: false, harnessError: "browser crashed twice" };
    };
    for (const t of sel) {
      let control = controls.get(t.caseId);
      if (!control && !noControl && t.control !== false) {
        const cr = await safeRun(t, "control");
        const cc = cell(t, cr, null);
        control = { saw: cc.saw || cr.appEv.length > 0, text: cc.text, tk: cr.tk };
        controls.set(t.caseId, control);
        results.push({ id: t.caseId + "@control", question: t.q, technique: t.label, variant: "control (no sandbox, no CSP, no host doc)", browser: b.name, browserVersion: version, attempted: t.label, observed: cc.text, collectorSawRequest: control.saw, error: cr.harnessError, events: summarizeEv(cr), frameReports: cr.reports.map((x) => ({ from: x.from, out: x.out })), console: relevantConsole(cr.consoleMsgs) });
        console.log(`  [control] ${t.caseId}: ${cc.text}`);
      }
      const r = await safeRun(t, "test");
      const c = cell(t, r, control);
      results.push({ id: t.id, question: t.q, technique: t.label, variant: t.variant, shellCsp: t.shellCsp, hostdoc: t.hostdoc, pluginCsp: pluginCsp(t.variant, ["<scripts>"], "<nonce>"), browser: b.name, browserVersion: version, attempted: t.label, observed: c.text, collectorSawRequest: c.saw || r.appEv.length > 0, error: r.harnessError || (r.gotDone ? null : "no done report from frame (may have navigated)"), events: summarizeEv(r), frameReports: r.reports.map((x) => ({ from: x.from, out: x.out })), console: relevantConsole(r.consoleMsgs) });
      console.log(`  ${t.id}: ${c.text}`);
    }
    await browser.close().catch(() => {});
    writeOut();
  }
} finally {
  await stop();
}

function summarizeEv(r) {
  return {
    http: r.ev.http.map((e) => ({ type: e.type, method: e.method, url: e.url, purpose: e.purpose, dest: e.dest })),
    udp: r.ev.udp.map((e) => ({ stunType: e.stunType, username: e.username, from: e.from })),
    tcp: r.ev.tcp.map((e) => ({ requests: e.requests })),
    app: r.appEv.map((e) => ({ url: e.url, cookies: e.cookies, origin: e.origin, secFetchSite: e.secFetchSite })),
  };
}

// ---------- write ----------
function writeOut() {
const md = [];
fs.writeFileSync(path.join(here, outName + ".json"), JSON.stringify({ generated: new Date().toISOString(), untestable, note: "Playwright WebKit is not shipping Safari. Firefox ran with media.peerconnection.ice.loopback=true so loopback STUN is observable.", results }, null, 2));
const bnames = [...new Set(results.map((r) => r.browser))];
const vers = Object.fromEntries(results.map((r) => [r.browser, r.browserVersion]));
md.push(`# Tailor escape spike results\n\nGenerated ${new Date().toISOString()} by \`node run.mjs\`. Browsers: ${bnames.map((b) => `${b} ${vers[b]}`).join(", ")}.`);
md.push(`Playwright WebKit is not the shipping Safari. "chromium" is Playwright's headless Chromium build; "chrome" is the installed Google Chrome. Firefox ran with \`media.peerconnection.ice.loopback=true\`, without which no STUN reaches 127.0.0.1 even from an unrestricted page. WebKit is Playwright's frozen macOS 14 build 2251, driven through \`webkit-compat.mjs\`, which drops one Push API setting call the old build rejects.`);
for (const u of untestable) md.push(`**${u.browser} ${u.browserVersion} could not be tested:** ${u.reason}`);
md.push(`Verdicts come from the servers' logs: LEAKED means the collector (127.0.0.1:4102 TCP, 4103 UDP) logged a request carrying the test's token. "control" rows are the same code in an unsandboxed frame with no CSP and no host document.\n`);
md.push(`Plugin CSP variants: \`full\` = ${"`"}${pluginCsp("full", ["<scripts>"], "N")}${"`"}; \`full-hash\` = same with script-src hashes instead of a nonce; \`noframe\` = full minus frame-src and child-src; \`frames-open\` = full with \`frame-src * data: blob:\` and no child-src; \`sandbox-only\` = only \`sandbox allow-scripts\` (the iframe sandbox attribute is always present); \`connect\` = full + \`connect-src http://localhost:4101\`; \`no-form-action\` = full minus form-action; \`webrtc-block\` = full + \`webrtc 'block'\`. "+shellcsp" means the shell sent \`frame-src http://localhost:4101/plugin/\`.\n`);
const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
for (const q of ["Q1", "Q2", "Q4", "Q7"]) {
  const rows = results.filter((r) => r.question === q);
  if (!rows.length) continue;
  md.push(`## ${q}\n`);
  md.push(`| technique | variant | ${bnames.join(" | ")} |`);
  md.push(`| --- | --- | ${bnames.map(() => "---").join(" | ")} |`);
  const keys = [...new Set(rows.map((r) => r.id))];
  for (const k of keys) {
    const rr = rows.filter((r) => r.id === k);
    const label = rr[0].technique;
    const variant = k.includes("@control") ? "control" : k.split("@")[1];
    md.push(`| ${esc(label)} | ${esc(variant)} | ${bnames.map((b) => esc((rr.find((r) => r.browser === b) || {}).observed ?? "")).join(" | ")} |`);
  }
  md.push("");
}
fs.writeFileSync(path.join(here, outName + ".md"), md.join("\n"));
}
writeOut();
console.log("wrote", outName + ".json", outName + ".md", results.length, "rows");
