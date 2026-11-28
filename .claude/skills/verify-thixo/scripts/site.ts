// Builds @thixo/site, serves packages/site/dist under /thixo/ as GitHub Pages will, opens it in headless Chromium,
// takes the actions it's given, and saves screenshots and what the page showed. Used by the verify-thixo skill.
//
//   site.sh --out <dir> [--do <json | @file>] [--no-build] [--wait <ms>]
//
// Exit 0 when the site built and loaded with no errors, 1 when the build failed or the page had errors, 2 for bad usage.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const USAGE = "usage: site.sh --out <dir> [--do <json | @file>] [--no-build] [--wait <ms>]\n";
const BASE = "/thixo/";
const DIST = resolve("packages/site/dist");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

type Point = { x: number; y: number; in?: string };
type Action =
  | { goto: string }
  | { click: string }
  | { type: { into: string; text: string } }
  | { pointer: Point }
  | { down: true }
  | { up: true }
  | { press: string }
  | { keyDown: string }
  | { keyUp: string }
  | { wait: number }
  | { frames: number }
  | { shot: string };

const DEFAULT_ACTIONS: Action[] = [{ shot: "loaded" }, { goto: "#live" }, { shot: "frame-1" }, { wait: 300 }, { shot: "frame-2" }];

// A thrown value that isn't an Error reaches Playwright's pageerror as "Object"; this records what it was.
const UNCAUGHT = `
window.__uncaught = [];
const describe = (v) => {
  if (v instanceof Error) return v.name + ": " + v.message;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};
window.addEventListener("error", (e) => window.__uncaught.push(describe(e.error ?? e.message)));
window.addEventListener("unhandledrejection", (e) => window.__uncaught.push("unhandled rejection: " + describe(e.reason)));
`;

interface Seen {
  url: string;
  text: string;
  boxes: string[];
  errorText: string[];
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseActions(raw: string | undefined): Action[] {
  if (raw === undefined) return DEFAULT_ACTIONS;
  const parsed: unknown = JSON.parse(raw.startsWith("@") ? readFileSync(resolve(process.env.VERIFY_CALLER_DIR ?? ".", raw.slice(1)), "utf8") : raw);
  if (!Array.isArray(parsed)) throw new Error("--do takes a JSON array of actions");
  return parsed as Action[];
}

function buildSite(out: string): { ok: boolean; output: string } {
  const r = spawnSync("npm", ["run", "build", "-w", "@thixo/site"], { encoding: "utf8" });
  const output = `$ npm run build -w @thixo/site\n${r.stdout}${r.stderr}exit ${r.status}\n`;
  writeFileSync(join(out, "build.txt"), output);
  return { ok: r.status === 0, output };
}

function serve(): Server {
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const file = normalize(join(DIST, path.slice(BASE.length) || "index.html"));
    if (!path.startsWith(BASE) || !file.startsWith(DIST) || !existsSync(file)) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
}

async function point(page: Page, p: Point): Promise<{ x: number; y: number }> {
  if (!p.in) return p;
  const b = await page.locator(p.in).first().boundingBox();
  if (!b) throw new Error(`pointer: ${p.in} isn't on the page`);
  return { x: b.x + p.x, y: b.y + p.y };
}

async function act(page: Page, a: Action): Promise<void> {
  if ("goto" in a) {
    await page.evaluate((hash) => (location.hash = hash), a.goto);
    await page.locator(a.goto).first().scrollIntoViewIfNeeded();
  } else if ("click" in a) await page.locator(a.click).first().click();
  else if ("type" in a) {
    await page.locator(a.type.into).first().click();
    await page.keyboard.type(a.type.text);
  } else if ("pointer" in a) {
    const at = await point(page, a.pointer);
    await page.mouse.move(at.x, at.y, { steps: 5 });
  } else if ("down" in a) await page.mouse.down();
  else if ("up" in a) await page.mouse.up();
  else if ("press" in a) await page.keyboard.press(a.press);
  else if ("keyDown" in a) await page.keyboard.down(a.keyDown);
  else if ("keyUp" in a) await page.keyboard.up(a.keyUp);
  else if ("wait" in a) await page.waitForTimeout(a.wait);
  else if ("frames" in a) await page.evaluate(`new Promise((done) => { let left = ${Number(a.frames)}; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); })`);
  else throw new Error(`unknown action ${JSON.stringify(a)}`);
}

const seen = (page: Page): Promise<Seen> =>
  page.evaluate(() => ({
    url: location.pathname + location.hash,
    text: document.body.innerText.slice(0, 20000),
    boxes: [...document.querySelectorAll('[data-testid="box"]')].map((b) => b.innerHTML.slice(0, 20000)),
    errorText: [...document.querySelectorAll(".error")].map((e) => (e as HTMLElement).innerText),
  }));

async function main(args: string[]): Promise<number> {
  const outArg = arg(args, "--out");
  if (!outArg) {
    process.stderr.write(USAGE);
    return 2;
  }
  let actions: Action[];
  try {
    actions = parseActions(arg(args, "--do"));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const out = resolve(process.env.VERIFY_CALLER_DIR ?? ".", outArg);
  const wait = Number(arg(args, "--wait") ?? 500);
  mkdirSync(out, { recursive: true });

  if (!args.includes("--no-build")) {
    const built = buildSite(out);
    if (!built.ok) {
      writeFileSync(join(out, "site.json"), JSON.stringify({ ok: false, buildError: built.output }, null, 2) + "\n");
      process.stdout.write(`FAILED: the site didn't build, see ${join(out, "build.txt")}\n${built.output}`);
      return 1;
    }
  }

  const server = serve();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleLines: string[] = [];
  const failedRequests: string[] = [];
  const offOriginRequests: string[] = [];
  const steps: ({ step: string; screenshot: string } & Seen)[] = [];
  const uncaught: string[] = [];
  let actionError: string | undefined;
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    page.setDefaultTimeout(5000);
    await page.addInitScript(UNCAUGHT);
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => {
      consoleLines.push(`${m.type()}: ${m.text()}`);
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("request", (r) => {
      if (!r.url().startsWith(origin)) offOriginRequests.push(`${r.method()} ${r.url()}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(origin + BASE);
    await page.waitForTimeout(wait);
    for (const a of actions) {
      try {
        if ("shot" in a) {
          const file = `${String(steps.length + 1).padStart(2, "0")}-${a.shot}.png`;
          await page.screenshot({ path: join(out, file) });
          steps.push({ step: a.shot, screenshot: file, ...(await seen(page)) });
        } else await act(page, a);
      } catch (e) {
        actionError = `${JSON.stringify(a)}: ${(e as Error).message.split("\n")[0]}`;
        break;
      }
    }
    writeFileSync(join(out, "page.txt"), (await seen(page)).text + "\n");
    uncaught.push(...(await page.evaluate(() => (window as unknown as { __uncaught: string[] }).__uncaught)));
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  const errorText = [...new Set(steps.flatMap((s) => s.errorText))];
  const failed = !!actionError || pageErrors.length + consoleErrors.length + failedRequests.length + errorText.length > 0;
  const first = steps[0]?.boxes ?? [];
  const boxesChanged = first.map((html, i) => steps.some((s) => s.boxes[i] !== html));
  const report = { url: origin + BASE, ok: !failed, actionError, pageErrors, uncaught, consoleErrors, failedRequests, errorText, offOriginRequests, boxesChanged, console: consoleLines, steps };
  writeFileSync(join(out, "site.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${failed ? "FAILED" : "ok"}: ${steps.length} steps, evidence in ${out}\n`);
  for (const e of [actionError, ...uncaught, ...consoleErrors, ...failedRequests, ...errorText]) if (e) process.stdout.write(`error: ${e}\n`);
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exitCode = 1;
  },
);
