import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { chromium, type Page } from "playwright";
import { buildSite } from "../src/build.ts";
import { GALLERY } from "../src/gallery-entries.ts";
import { readProgram } from "../src/programs.ts";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

async function openSite(t: TestContext): Promise<{ page: Page; problems: string[] }> {
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
  return { page, problems };
}

test("the built site compiles the spinner, animates it and shows how to install thixo, under a subpath", async (t) => {
  const { page, problems } = await openSite(t);
  const rect = page.locator('#live [data-testid="box"] rect');
  await rect.waitFor();
  const first = await rect.getAttribute("transform");
  await page.waitForTimeout(300);
  const second = await rect.getAttribute("transform");
  assert.match(first ?? "", /^rotate\([\d.]+ 100 100\)$/);
  assert.notEqual(first, second, "the spinner moves between frames");

  const source = await page.locator('#live [data-testid="source"]').innerText();
  assert.equal(source.trim(), readFileSync(new URL("../programs/spin/main.thx", import.meta.url), "utf8").trim());

  const install = await page.locator("#install").innerText();
  for (const step of ["npm i @thixo/core @thixo/react", "npx @thixo/cli compile <folder> -o out.js", "await load(code)"]) {
    assert.ok(install.includes(step), `the install panel shows ${step}`);
  }
  assert.deepEqual(problems, []);
});

const numbers = (attr: string | null): number[] => (attr ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];

test("the gallery mounts every program beside its source, and they answer the pointer, the keys and the clock", async (t) => {
  const { page, problems } = await openSite(t);

  for (const entry of GALLERY) {
    const item = page.locator(`[data-testid="gallery-${entry.id}"]`);
    await item.locator('[data-testid="box"] svg').waitFor();
    for (const [name, text] of Object.entries(readProgram(entry.id))) {
      const shown = await item.locator(`[data-file="${name}"] pre`).innerText();
      assert.equal(shown.trim(), text.trim(), `${entry.id} shows ${name}`);
    }
  }

  const drag = page.locator('[data-testid="gallery-drag"] [data-testid="box"]');
  const tile = drag.locator('rect[fill="teal"]');
  const before = { x: Number(await tile.getAttribute("x")), y: Number(await tile.getAttribute("y")) };
  await drag.scrollIntoViewIfNeeded();
  const box = (await drag.boundingBox())!;
  await page.mouse.move(box.x + before.x + 20, box.y + before.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + before.x + 60, box.y + before.y + 50, { steps: 10 });
  assert.equal(await tile.getAttribute("stroke"), "#1d2421", "the held tile is outlined");
  assert.equal(await drag.locator("rect").last().getAttribute("fill"), "teal", "and drawn on top");
  await page.mouse.up();
  const after = { x: Number(await tile.getAttribute("x")), y: Number(await tile.getAttribute("y")) };
  assert.deepEqual(after, { x: before.x + 40, y: before.y + 30 }, "the teal tile follows the drag");
  assert.equal(await drag.locator('rect[fill="tomato"]').getAttribute("x"), "24", "the other tiles stay put");

  const keys = page.locator('[data-testid="gallery-keys"] [data-testid="box"]');
  const dot = keys.locator("circle");
  await keys.click({ position: { x: 20, y: 200 } });
  const start = Number(await dot.getAttribute("cx"));
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  const moved = Number(await dot.getAttribute("cx"));
  assert.ok(moved > start + 10, `the dot moves right with ArrowRight (${start} to ${moved})`);
  assert.equal(await dot.getAttribute("cy"), "120", "and not down");
  await page.waitForTimeout(200);
  assert.equal(Number(await dot.getAttribute("cx")), moved, "and stops when the key comes up");

  const group = page.locator('[data-testid="gallery-bloom"] [data-testid="box"] g');
  const turn1 = numbers(await group.getAttribute("transform"))[0];
  await page.waitForTimeout(300);
  const turn2 = numbers(await group.getAttribute("transform"))[0];
  assert.ok(turn2! > turn1!, `the bloom turns between frames (${turn1} to ${turn2})`);
  assert.equal(await page.locator('[data-testid="gallery-bloom"] ellipse').count(), 12);

  assert.deepEqual(problems, []);
});
