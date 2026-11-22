// An app made by create-thixo-app, end to end, the way its readme says: create it outside the repo, `npm install`
// with no registry (the Thixo packages and React are linked from this checkout), `thixo dev`, then drive it as the
// template's two users. ana can't delete, so the list's Delete is grayed out (useCan on an optional endpoint); ben
// can. Run it with `npm run e2e` after `npm run build`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { ROOT, removeCopy, startDev, thixo } from "./support.mjs";

let base;
let app;
let dev;
let browser;
let created;

before(async () => {
  base = mkdtempSync(join(process.env.THIXO_E2E_TMP ?? tmpdir(), "thixo-create-"));
  created = spawnSync(process.execPath, [join(ROOT, "packages/create-thixo-app/bin/create-thixo-app.js"), "notes-app"], { cwd: base, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  app = join(base, "notes-app");
  // --offline: every dependency is a file: link into this checkout, so nothing is fetched.
  const installed = spawnSync("npm", ["install", "--offline", "--no-audit", "--no-fund"], { cwd: app, encoding: "utf8" });
  assert.equal(installed.status, 0, installed.stderr);
  dev = await startDev(app);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await dev?.stop();
  removeCopy(base);
});

async function as(user) {
  const context = await browser.newContext();
  await context.addCookies([{ name: "thixo-user", value: user, url: dev.url }]);
  const page = await context.newPage();
  await page.goto(dev.url);
  await page.getByRole("region", { name: "Todo list (main)" }).getByRole("button", { name: "Write the first page", exact: true }).waitFor();
  return page;
}

test("create-thixo-app says it links the checkout, and npm install worked without the registry", () => {
  assert.match(created.stdout, /not on npm yet, so package\.json links them, and React, from the Thixo checkout/);
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.thixo, `file:${join(ROOT, "packages/core")}`);
  assert.equal(pkg.dependencies.react, `file:${join(ROOT, "node_modules/react")}`);
});

test("ana gets the list with Delete grayed out; ben can delete", async () => {
  const ana = await as("ana");
  const list = ana.getByRole("region", { name: "Todo list (main)" });
  assert.equal(await list.getByRole("button", { name: "Delete" }).first().isDisabled(), true);
  await ana.context().close();

  const ben = await as("ben");
  const bens = ben.getByRole("region", { name: "Todo list (main)" });
  assert.equal(await bens.getByRole("button", { name: "Delete" }).first().isDisabled(), false);
  await bens.getByRole("textbox").fill("Throw this away");
  await bens.getByRole("textbox").press("Enter");
  const row = bens.getByRole("button", { name: "Throw this away", exact: true });
  await row.waitFor();
  const deleted = ben.waitForResponse((r) => r.request().method() === "DELETE" && new URL(r.url()).pathname.startsWith("/api/todos/"));
  await row.locator("xpath=..").getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal((await deleted).status(), 204);
  await row.waitFor({ state: "detached" });
  await ben.context().close();
});

test("thixo new plugin prints the layout line with the slot's real path", () => {
  const made = thixo(["new", "plugin", "notes", "--slot", "todo-detail"], { cwd: app });
  assert.equal(made.code, 0, made.stderr);
  assert.match(made.stdout, /Add it to the layout in thixo\.config\.ts to make it a default: "todo-detail": "notes"/);
  assert.match(readFileSync(join(app, "plugins/notes/plugin.thx"), "utf8"), /id: "plg_[0-9a-f]{18}"/);
  rmSync(join(app, "plugins/notes"), { recursive: true });
});

test("a default plugin the layout names that stops compiling is reported as that, and the last release stays", async () => {
  const file = join(app, "plugins/todo-info/plugin.thx");
  const good = readFileSync(file, "utf8");
  const before = dev.output().length;
  writeFileSync(file, good.replace("useQuery(getTodo", "window.fetch(getTodo"));
  try {
    const deadline = Date.now() + 20_000;
    while (!/not deployed/.test(dev.output().slice(before)) && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 100));
    const said = dev.output().slice(before);
    assert.match(said, /FAILED {2}todo-info/);
    assert.match(said, /not deployed: the layout names plugins\/todo-info, which did not compile \(see above\)\. The app keeps the last release until it compiles\./);
    assert.doesNotMatch(said, /there is no plugins\/todo-info/);
  } finally {
    writeFileSync(file, good);
  }
});
