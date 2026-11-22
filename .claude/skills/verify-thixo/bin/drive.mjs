#!/usr/bin/env node
// Drives this run's app in headless Chromium as one user, then saves a screenshot and an ARIA snapshot.
//   node .claude/skills/verify-thixo/bin/drive.mjs [--run <id>] --as <user> [--script <file.mjs>] [--name <label>]
// The users are the app's own: todo has ana, ben and cy; crm has rita, ravi, mia, sam and ada; an app create-thixo-app
// made has ana and ben.
// A script's default export is `async ({ page, url, as, step, expect }) => {}`. `step(label)` saves a screenshot
// and ARIA snapshot mid-run; `expect(condition, message)` fails the drive. Without --script it only opens the app.
// Evidence goes to artifacts/verify/<run>/<name>/: <n>-<label>.png, <n>-<label>.aria.txt, requests.json, console.txt.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { args, fail, readState, ROOT, runDir } from "./common.mjs";

const { chromium } = await import(pathToFileURL(join(ROOT, "node_modules/playwright/index.mjs")).href);

const a = args();
const run = a.run ?? "default";
const as = a.as;
if (!as || as === true) fail("say who to drive as: --as <user>. todo has ana, ben and cy; crm has rita, ravi, mia, sam and ada; a created app has ana and ben.");
const state = readState(run);
if (!state?.url) fail(`no instance for run "${run}". Run launch.mjs and doctor.mjs first.`);
const name = a.name ?? `${as}-${Date.now()}`;
const out = join(runDir(run), name);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addCookies([{ name: "thixo-user", value: as, url: state.url }]);
const page = await context.newPage();
const requests = [];
const consoleLines = [];
page.on("request", (r) => {
  if (new URL(r.url()).pathname.startsWith("/_thixo") || new URL(r.url()).pathname.startsWith("/api")) {
    requests.push({ method: r.method(), path: new URL(r.url()).pathname, body: r.postData() ?? undefined });
  }
});
page.on("response", (r) => {
  const entry = [...requests].reverse().find((q) => q.path === new URL(r.url()).pathname && q.status === undefined);
  if (entry) entry.status = r.status();
});
page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`));

let n = 0;
async function step(label) {
  n++;
  const base = join(out, `${String(n).padStart(2, "0")}-${label}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: `${base}.png`, fullPage: true });
  writeFileSync(`${base}.aria.txt`, await page.locator("body").ariaSnapshot());
  console.log(`saved ${base}.png and .aria.txt`);
}
function expect(condition, message) {
  if (!condition) throw new Error(`expectation failed: ${message}`);
  console.log(`ok ${message}`);
}

let failed = null;
try {
  await page.goto(state.url);
  await page.getByRole("banner").waitFor();
  if (a.script && a.script !== true) {
    const script = await import(pathToFileURL(resolve(a.script)).href);
    await script.default({ page, url: state.url, as, step, expect, dir: state.dir });
  }
  await step("end");
} catch (error) {
  failed = error;
  await step("failed").catch(() => {});
} finally {
  writeFileSync(join(out, "requests.json"), JSON.stringify(requests, null, 2));
  writeFileSync(join(out, "console.txt"), consoleLines.join("\n") + "\n");
  await browser.close();
}
console.log(`evidence in ${out}`);
// Name what failed and where: a Playwright timeout's message carries the locator it waited for, and the step saved at
// the failure ("…-failed.aria.txt") shows the page as it was.
if (failed) fail(`${failed.name ?? "Error"}: ${failed.message}\nThe page at the failure: ${out}/*-failed.aria.txt and .png`);
