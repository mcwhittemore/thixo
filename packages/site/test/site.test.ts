import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { compile } from "@thixo/core";
import { chromium, type Browser, type Page } from "playwright";
import { buildSite } from "../src/build.ts";
import { ESCAPES } from "../src/escapes.ts";
import { formatErrors } from "../src/format-errors.ts";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let dist: string;
let server: Server;
let browser: Browser;
let page: Page;
const problems: string[] = [];

before(async () => {
  dist = mkdtempSync(join(tmpdir(), "thixo-site-"));
  await buildSite(dist);

  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (!path.startsWith("/thixo/")) {
      res.statusCode = 404;
      return res.end();
    }
    const file = normalize(join(dist, path.slice("/thixo/".length) || "index.html"));
    try {
      if (!file.startsWith(dist)) throw new Error("outside the site");
      const body = readFileSync(file);
      res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  browser = await chromium.launch();
  page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${origin}/thixo/`);
});

after(async () => {
  await browser?.close();
  server?.close();
  rmSync(dist, { recursive: true, force: true });
});

test("the built site compiles the spinner, animates it and shows how to install thixo, under a subpath", async () => {
  const rect = page.locator('[data-testid="box"] rect');
  await rect.waitFor();
  const first = await rect.getAttribute("transform");
  await page.waitForTimeout(300);
  const second = await rect.getAttribute("transform");
  assert.match(first ?? "", /^rotate\([\d.]+ 100 100\)$/);
  assert.notEqual(first, second, "the spinner moves between frames");

  const source = await page.locator('[data-testid="source"]').innerText();
  assert.equal(source.trim(), readFileSync(new URL("../programs/spin/main.thx", import.meta.url), "utf8").trim());

  const install = await page.locator("#install").innerText();
  for (const step of ["npm i @thixo/core @thixo/react", "npx @thixo/cli compile <folder> -o out.js", "await load(code)"]) {
    assert.ok(install.includes(step), `the install panel shows ${step}`);
  }
  assert.deepEqual(problems, []);
});

test("each escape on the site still fails to compile as thx, with the error the page shows", async () => {
  assert.equal(await page.locator("#escapes .escape").count(), ESCAPES.length);
  for (const escape of ESCAPES) {
    const thx = readFileSync(new URL(`../programs/escapes/${escape.id}/main.thx`, import.meta.url), "utf8");
    const result = compile({ "main.thx": thx });
    assert.equal(result.ok, false, `${escape.id} must not compile`);
    if (result.ok) continue;

    const pair = page.locator(`[data-testid="escape-${escape.id}"]`);
    assert.equal((await pair.locator('[data-testid="js"]').innerText()).trim(), escape.js);
    assert.equal((await pair.locator('[data-testid="thx"]').innerText()).trim(), thx.trim());
    assert.equal((await pair.locator('[data-testid="error"]').innerText()).trim(), formatErrors(result.errors));
  }
  assert.deepEqual(problems, []);
});
