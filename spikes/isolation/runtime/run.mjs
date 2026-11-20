// Runs the Tailor runtime spike: Q3, Q5, Q6, Q8 in every browser, writes results.json and results.md.
//   node run.mjs                 everything
//   node run.mjs q5 chromium     only some questions / browsers (filters, any order)
//   node run.mjs --no-headed     skip the headed Q3 runs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webkitCompatPatched } from "./webkit-compat.mjs";
const { chromium, firefox, webkit } = await import("playwright");
import { build } from "./build.mjs";
import { startServers } from "./server.mjs";
import { withTimeout } from "./common.mjs";
import * as q3 from "./tests/q3-main-thread.mjs";
import * as q5 from "./tests/q5-loading.mjs";
import * as q6 from "./tests/q6-rendering.mjs";
import * as q8 from "./tests/q8-channel-and-frame.mjs";
import { writeMarkdown } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const want = (kind, all) => { const f = args.filter((a) => all.includes(a)); return f.length ? f : all; };

const BROWSERS = {
  // channel "chromium" = the full Chromium build in new headless mode, the same process model as headed.
  chromium: { type: chromium, opts: { channel: "chromium" }, note: "Playwright Chromium (full build; new headless)" },
  chrome: { type: chromium, opts: { channel: "chrome" }, note: "installed Google Chrome" },
  firefox: { type: firefox, opts: {}, note: "Playwright Firefox (Juggler build)" },
  webkit: { type: webkit, opts: {}, note: "Playwright WebKit build, not shipping Safari" },
};
// Extra Q3 configuration: Playwright Firefox with Fission prefs forced on, closer to shipping Firefox.
// Extra Q3 configuration: Playwright's default headless Chromium, chromium-headless-shell, which has no site isolation.
const HEADLESS_SHELL = { type: chromium, opts: {}, note: "chromium-headless-shell (Playwright's default headless Chromium)" };
const FIREFOX_FISSION = { type: firefox, opts: { firefoxUserPrefs: { "fission.autostart": true, "fission.webContentIsolationStrategy": 1 } }, note: "Playwright Firefox with fission.autostart=true" };

const questions = want("q", ["q3", "q5", "q6", "q8"]);
const browsers = want("b", Object.keys(BROWSERS));
const headedToo = !args.includes("--no-headed");

async function launch(name, spec, headless) {
  const browser = await spec.type.launch({ ...spec.opts, headless });
  return { browser, meta: { browser: name, browserVersion: browser.version(), mode: headless ? "headless" : "headed", browserNote: spec.note } };
}

async function main() {
  const { chunk } = await build();
  const stop = await startServers();
  const results = [];
  const outPath = path.join(here, "results.json");
  const prev = fs.existsSync(outPath) && args.length ? JSON.parse(fs.readFileSync(outPath, "utf8")).results : [];
  try {
    for (const name of browsers) {
      const spec = BROWSERS[name];
      let l;
      try { l = await launch(name, spec, true); } catch (e) {
        results.push({ question: "all", test: "launch", browser: name, outcome: "could not launch", error: String(e.message).split("\n")[0] });
        continue;
      }
      const ctx = { ...l, chunk, relaunch: async () => { await l.browser.close().catch(() => {}); l = await launch(name, spec, true); ctx.browser = l.browser; return l.browser; } };
      for (const q of questions) {
        const mod = { q3, q5, q6, q8 }[q];
        console.log(`[${name} headless] ${q}`);
        try { results.push(...(await mod.run(ctx))); } catch (e) {
          console.error(e);
          results.push({ question: q.toUpperCase(), test: "harness", ...l.meta, outcome: "harness error", error: String(e.stack || e) });
          await ctx.relaunch();
        }
      }
      await withTimeout(ctx.browser.close(), 10000).catch(() => {});

      if (questions.includes("q3")) {
        const variants = [];
        if (headedToo) variants.push({ label: name, spec, headless: false });
        if (name === "chromium") variants.push({ label: "chromium-headless-shell", spec: HEADLESS_SHELL, headless: true });
        if (name === "firefox") { variants.push({ label: "firefox-fission", spec: FIREFOX_FISSION, headless: true }); if (headedToo) variants.push({ label: "firefox-fission", spec: FIREFOX_FISSION, headless: false }); }
        for (const v of variants) {
          console.log(`[${v.label} ${v.headless ? "headless" : "headed"}] q3`);
          let lv;
          try { lv = await launch(v.label, v.spec, v.headless); } catch (e) {
            results.push({ question: "Q3", test: "launch", browser: v.label, mode: v.headless ? "headless" : "headed", outcome: "could not launch", error: String(e.message).split("\n")[0] });
            continue;
          }
          const c2 = { ...lv, relaunch: async () => { await lv.browser.close().catch(() => {}); lv = await launch(v.label, v.spec, v.headless); c2.browser = lv.browser; return lv.browser; } };
          try { results.push(...(await q3.run(c2))); } catch (e) { console.error(e); results.push({ question: "Q3", test: "harness", ...lv.meta, outcome: "harness error", error: String(e.stack || e) }); }
          await withTimeout(c2.browser.close(), 10000).catch(() => {});
        }
      }
    }
  } finally {
    await stop();
  }
  // With filters, merge into the previous results so a partial re-run keeps the rest.
  const key = (r) => [r.question, r.test, r.browser, r.mode].join("|");
  const fresh = new Set(results.map(key));
  const merged = [...prev.filter((r) => !fresh.has(key(r))), ...results];
  if (browsers.includes("webkit") && !merged.some((r) => r.test === "webkit-compat")) merged.push({ question: "all", test: "webkit-compat", browser: "webkit", outcome: `Playwright 1.65 + WebKit build 2251 (macOS 14) needed one protocol call dropped (Page.overrideSetting PushAPIEnabled); patched ${webkitCompatPatched()} call site at load time` });
  const doc = { generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`, playwright: JSON.parse(fs.readFileSync(path.join(here, "..", "node_modules", "playwright", "package.json"), "utf8")).version, results: merged };
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  fs.writeFileSync(path.join(here, "results.md"), writeMarkdown(doc));
  console.log(`wrote ${merged.length} results`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
