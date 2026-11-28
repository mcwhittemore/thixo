import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openSite } from "./serve-site.ts";

test("the built site compiles the spinner, animates it and shows how to install thixo, under a subpath", async (t) => {
  const { page, problems } = await openSite(t);
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
