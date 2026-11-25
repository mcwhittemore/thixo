// Mounts a compiled thixo program the way a host page does (thixo-react's `load` and `mount`) in headless Chromium,
// drives the pointer and keys, and saves screenshots and what the page saw. Used by the verify-thixo skill.
//
//   render.sh <compiled.js> --out <dir> [--wait <ms>] [--no-poke]
//
// Exit 0 when the program mounted with no runtime errors, 1 when it failed or threw, 2 for bad usage.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const USAGE = "usage: render.sh <compiled.js> --out <dir> [--wait <ms>] [--no-poke]\n";

const PAGE_SCRIPT = `
import { load, mount } from "thixo-react";
const said = [];
const errors = [];
let box;
window.__verify = {
  async run(code) {
    box = document.getElementById("box");
    mount(box, await load(code), {
      modules: { bench: { say: (text) => void said.push(String(text)) } },
      onError: (e) => void errors.push(String(e?.message ?? e)),
    });
  },
  seen() {
    return {
      said: said.slice(0, 200),
      boxText: (box?.innerText ?? "").slice(0, 4000),
      boxHtml: (box?.innerHTML ?? "").slice(0, 20000),
      runtimeErrors: errors.slice(0, 50),
      outside: document.getElementById("outside")?.textContent ?? null,
    };
  },
};
`;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>verify-thixo</title>
<style>
  body { margin: 0; font: 14px system-ui; background: #fff; }
  #outside { padding: 8px; }
  #box { position: absolute; left: 40px; top: 40px; width: 400px; height: 300px; border: 1px solid #999; }
</style></head>
<body><div id="outside">host page text</div><div id="box"></div><script src="/page.js"></script></body></html>`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  const input = args[0];
  const outArg = arg(args, "--out");
  if (!input || input.startsWith("-") || !outArg) {
    process.stderr.write(USAGE);
    return 2;
  }
  const code = readFileSync(resolve(input), "utf8");
  const out = resolve(outArg);
  const wait = Number(arg(args, "--wait") ?? 500);
  const poke = !args.includes("--no-poke");
  mkdirSync(out, { recursive: true });

  const bundle = await build({
    stdin: { contents: PAGE_SCRIPT, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const server: Server = createServer((req, res) => {
    if (req.url === "/page.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
    } else if (req.url === "/" || req.url?.startsWith("/?")) {
      res.setHeader("content-type", "text/html");
      res.end(PAGE);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const pageErrors: string[] = [];
  const consoleLines: string[] = [];
  const requests: string[] = [];
  const steps: { step: string; screenshot: string; seen: unknown }[] = [];
  let mountError: string | undefined;
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 380 } });
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
    page.on("request", (r) => {
      if (!r.url().startsWith(origin)) requests.push(`${r.method()} ${r.url()}`);
    });
    await page.goto(origin + "/");
    await page
      .evaluate((c) => (window as unknown as { __verify: { run(c: string): Promise<void> } }).__verify.run(c), code)
      .catch((e) => (mountError = String(e?.message ?? e)));
    const seen = () => page.evaluate(() => (window as unknown as { __verify: { seen(): unknown } }).__verify.seen());
    const shot = async (step: string) => {
      const file = `${String(steps.length + 1).padStart(2, "0")}-${step}.png`;
      await page.screenshot({ path: join(out, file) });
      steps.push({ step, screenshot: file, seen: await seen() });
    };
    await page.waitForTimeout(wait);
    await shot("mounted");
    if (poke && !mountError) {
      // Off-centre on purpose: a program that centres itself looks the same with the pointer at the centre.
      const b = (await page.locator("#box").boundingBox())!;
      const at = { x: b.x + b.width / 4, y: b.y + b.height / 4 };
      await page.mouse.move(b.x + 10, b.y + 10);
      await page.mouse.move(at.x, at.y, { steps: 5 });
      await page.waitForTimeout(200);
      await shot("pointer-at-quarter");
      await page.mouse.down();
      await page.waitForTimeout(200);
      await shot("pointer-held");
      await page.mouse.up();
      await page.waitForTimeout(200);
      await shot("pointer-released");
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(200);
      await shot("arrow-right-held");
      await page.keyboard.up("ArrowRight");
      await page.keyboard.type("go");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      await shot("typed-go-enter");
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  const last = steps.at(-1)?.seen as { runtimeErrors?: string[] } | undefined;
  const failed = !!mountError || pageErrors.length > 0 || (last?.runtimeErrors?.length ?? 0) > 0;
  const report = { input: resolve(input), ok: !failed, mountError, pageErrors, console: consoleLines, offOriginRequests: requests, steps };
  writeFileSync(join(out, "render.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${failed ? "FAILED" : "ok"}: ${steps.length} steps, evidence in ${out}\n`);
  if (mountError) process.stdout.write(`mount error: ${mountError}\n`);
  for (const e of [...pageErrors, ...(last?.runtimeErrors ?? [])]) process.stdout.write(`error: ${e}\n`);
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e) => {
    process.stderr.write(`${e?.stack ?? e}\n`);
    process.exitCode = 1;
  },
);
