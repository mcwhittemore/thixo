import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { buildSite } from "../src/build.ts";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

test("the built site compiles the spinner, animates it and shows how to install thixo, under a subpath", async (t) => {
  const dist = mkdtempSync(join(tmpdir(), "thixo-site-"));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  await buildSite(dist);

  const server = createServer((req, res) => {
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
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(`${origin}/thixo/`);
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
