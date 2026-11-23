// An app made by create-thixo-app, end to end, the way its readme says: create it outside the repo, `npm install`
// with no registry (the Thixo packages and React are linked from this checkout), `thixo dev`, then drive it as the
// template's two users. Run it with `npm run e2e` after `npm run build`.

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

const hello = (page) => page.getByRole("region", { name: "Hello (main)" });

async function as(user) {
  const context = await browser.newContext();
  await context.addCookies([{ name: "thixo-user", value: user, url: dev.url }]);
  const page = await context.newPage();
  await page.goto(dev.url);
  await hello(page).getByText("Hello from the app's API.").waitFor();
  return page;
}

test("create-thixo-app says it links the checkout, and npm install worked without the registry", () => {
  assert.match(created.stdout, /not on npm yet, so package\.json links them, and React, from the Thixo checkout/);
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.thixo, `file:${join(ROOT, "packages/core")}`);
  assert.equal(pkg.dependencies.react, `file:${join(ROOT, "node_modules/react")}`);
});

test("the hello plugin calls the endpoint as the signed-in user", async () => {
  const ana = await as("ana");
  await hello(ana).getByText("Hello, ana").waitFor();
  assert.equal(await ana.getByRole("heading", { name: "notes-app" }).count(), 1, "the app's name is in the shell");
  await ana.context().close();
  const ben = await as("ben");
  await hello(ben).getByText("Hello, ben").waitFor();
  await ben.context().close();
});

test("the nickname is plugin data: saved, kept across a reload, and private to the user", async () => {
  const ana = await as("ana");
  const saved = ana.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/_thixo/data/patch");
  await hello(ana).getByRole("textbox").fill("Annie");
  await hello(ana).getByRole("button", { name: "Save nickname" }).click();
  assert.equal((await saved).status(), 204);
  await hello(ana).getByText("Hello, Annie").waitFor();
  await ana.reload();
  await hello(ana).getByText("Hello, Annie").waitFor();
  await ana.context().close();

  const ben = await as("ben");
  await hello(ben).getByText("Hello, ben").waitFor();
  await ben.context().close();
});

test("the shell has the plugin browser and the authoring chat wired", async () => {
  const ana = await as("ana");
  await ana.getByRole("button", { name: "Plugins" }).click();
  await ana.getByRole("region", { name: "Plugin browser" }).getByText("Hello", { exact: true }).first().waitFor();
  await ana.getByRole("button", { name: "Ask for a plugin" }).click();
  await ana.getByRole("region", { name: "Authoring chat" }).waitFor();
  await ana.context().close();
});

test("thixo new plugin prints the layout line with the slot's real path", () => {
  const made = thixo(["new", "plugin", "notes", "--slot", "main"], { cwd: app });
  assert.equal(made.code, 0, made.stderr);
  assert.match(made.stdout, /Add it to the layout in thixo\.config\.ts to make it a default: "main": "notes"/);
  assert.match(readFileSync(join(app, "plugins/notes/plugin.thx"), "utf8"), /id: "plg_[0-9a-f]{18}"/);
  rmSync(join(app, "plugins/notes"), { recursive: true });
});

test("a default plugin the layout names that stops compiling is reported as that, and the last release stays", async () => {
  const file = join(app, "plugins/hello/plugin.thx");
  const good = readFileSync(file, "utf8");
  const before = dev.output().length;
  writeFileSync(file, good.replace("useQuery(hello", "window.fetch(hello"));
  try {
    const deadline = Date.now() + 20_000;
    while (!/not deployed/.test(dev.output().slice(before)) && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 100));
    const said = dev.output().slice(before);
    assert.match(said, /FAILED {2}hello/);
    assert.match(said, /not deployed: the layout names plugins\/hello, which did not compile \(see above\)\. The app keeps the last release until it compiles\./);
    assert.doesNotMatch(said, /there is no plugins\/hello/);
  } finally {
    writeFileSync(file, good);
  }
});
