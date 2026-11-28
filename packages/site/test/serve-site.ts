import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import type { TestContext } from "node:test";
import { chromium, type Page } from "playwright";
import { buildSite } from "../src/build.ts";

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export async function openSite(t: TestContext): Promise<{ page: Page; problems: string[]; origin: string }> {
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${origin}/thixo/`);
  return { page, problems, origin };
}
