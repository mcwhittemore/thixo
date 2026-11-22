// The todo example end to end: `thixo dev` on a disposable copy, driven in headless Chromium as ana, ben and cy,
// and the authoring agent's tools through `thixo agent`. Run it with `npm run e2e` after `npm run build`.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { copyExample, removeCopy, startDev, thixo } from "./support.mjs";

const SUMMARY_PLUGIN = `import { definePlugin, useQuery } from "thixo/plugin";
import { Card, Text } from "thixo/ui";
import { todoDetail } from "@app/slots";
import { getTodo } from "@app/sdk";

export default definePlugin(
  todoDetail,
  { name: "Todo summary", description: "Shows the selected todo's title and whether it is done." },
  function TodoSummary({ context }) {
    const todo = useQuery(getTodo, { id: context.todoId });
    if (!todo.data) return <Text tone="muted">Loading…</Text>;
    return (
      <Card title={\`Summary: \${todo.data.title}\`}>
        <Text>{todo.data.done ? "This one is done." : "Still open."}</Text>
      </Card>
    );
  },
);
`;

let dir;
let dev;
let browser;
let pluginDir;
let summaryId;
const problems = [];

before(async () => {
  dir = copyExample("todo");
  dev = await startDev(dir);
  browser = await chromium.launch();
  pluginDir = mkdtempSync(join(tmpdir(), "thixo-plugin-"));
  writeFileSync(join(pluginDir, "plugin.thx"), SUMMARY_PLUGIN);
});

after(async () => {
  await browser?.close();
  await dev?.stop();
  removeCopy(dir);
  if (pluginDir) rmSync(pluginDir, { recursive: true, force: true });
});

/** A signed-in page. The example's login is the `thixo-user` cookie. Page errors and failed requests are collected. */
async function as(user) {
  const context = await browser.newContext();
  await context.addCookies([{ name: "thixo-user", value: user, url: dev.url }]);
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`${user}: page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`${user}: console: ${message.text()}`);
  });
  await page.goto(dev.url);
  await list(page).waitFor();
  return page;
}

const list = (page) => page.getByRole("region", { name: "Todo list (main)" });
const detail = (page) => page.getByRole("region", { name: "Selected todo" });
const pluginBrowser = (page) => page.getByRole("region", { name: "Plugin browser" });
const row = (page, title) => list(page).locator("div", { has: page.getByRole("button", { name: title, exact: true }) }).last();

async function openTodo(page, title) {
  await list(page).getByRole("button", { name: title, exact: true }).click();
  await detail(page).waitFor();
}

function agent(args) {
  const result = thixo(["agent", ...args, "--project", dir]);
  assert.equal(result.code, 0, `thixo agent ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("as ana, the default plugins fill main and every row's child slot", async () => {
  const page = await as("ana");
  for (const title of ["Write the quarterly report", "Book flights for the offsite", "Review the pull request"]) {
    await assert.doesNotReject(list(page).getByRole("button", { name: title, exact: true }).waitFor());
  }
  const badges = list(page).getByRole("region", { name: "Done badge (main/todo-row)" });
  await badges.first().waitFor();
  assert.equal(await badges.count(), 3);
  assert.deepEqual(await badges.allInnerTexts(), ["Open", "Done", "Open"]);
  const contain = await page.locator('[data-slot="main"]').evaluate((el) => getComputedStyle(el).contain);
  assert.match(contain, /layout|content|strict/);
  await page.context().close();
});

test("ana adds a todo, ticks one, and sets a due date that survives a reload", async () => {
  const page = await as("ana");
  const title = `Buy milk ${Date.now()}`;
  const input = list(page).getByRole("textbox", { name: "Add a todo" });
  await input.fill(title);
  await input.press("Enter");
  await list(page).getByRole("button", { name: title, exact: true }).waitFor();
  assert.equal(await input.inputValue(), "");

  const box = row(page, "Review the pull request").getByRole("checkbox", { name: "Done" });
  assert.equal(await box.isChecked(), false);
  await box.click();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Review the pull request");
    return button?.parentElement?.querySelector('input[type="checkbox"]')?.checked === true;
  });
  await row(page, "Review the pull request").getByRole("region", { name: "Done badge (main/todo-row)" }).getByText("Done").waitFor();

  await openTodo(page, "Write the quarterly report");
  const slot = detail(page).getByRole("region", { name: "Due dates (todo-detail)" });
  await slot.getByRole("heading", { name: "Write the quarterly report" }).waitFor();
  const due = slot.getByRole("textbox", { name: "Due" });
  const patched = page.waitForResponse((r) => r.url().endsWith("/_thixo/data/patch") && r.status() === 204);
  await due.fill("2026-12-24");
  await patched;

  await page.reload();
  await list(page).waitFor();
  assert.equal(await row(page, "Review the pull request").getByRole("checkbox", { name: "Done" }).isChecked(), true);
  await list(page).getByRole("button", { name: title, exact: true }).waitFor();
  await openTodo(page, "Write the quarterly report");
  const kept = detail(page).getByRole("textbox", { name: "Due" });
  await page.waitForFunction(() => document.querySelector('input[type="date"]')?.value === "2026-12-24");
  assert.equal(await kept.inputValue(), "2026-12-24");
  await page.context().close();
});

test("Delete is disabled for ana and enabled for ben (P4)", async () => {
  const ana = await as("ana");
  const anaDelete = list(ana).getByRole("button", { name: "Delete" });
  await anaDelete.first().waitFor();
  for (const button of await anaDelete.all()) assert.equal(await button.isDisabled(), true);
  await ana.context().close();

  const ben = await as("ben");
  const benDelete = list(ben).getByRole("button", { name: "Delete" });
  await benDelete.first().waitFor();
  await ben.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Delete" && !b.disabled));
  for (const button of await benDelete.all()) assert.equal(await button.isDisabled(), false);
  await ben.context().close();
});

test("thixo compile and thixo new plugin work on the app", () => {
  const compiled = thixo(["compile", join(dir, "plugins/due-dates")]);
  assert.equal(compiled.code, 0, compiled.stderr);
  assert.match(compiled.stdout, /Compiled due-dates \(Due dates\)/);
  assert.match(compiled.stdout, /Annotates todo with dueOn \(date\)/);

  const made = thixo(["new", "plugin", "scratch-notes", "--slot", "todo-detail"], { cwd: dir });
  assert.equal(made.code, 0, made.stderr);
  const text = readFileSync(join(dir, "plugins/scratch-notes/plugin.thx"), "utf8");
  assert.match(text, /import \{ todoDetail \} from "@app\/slots";/);
  const again = thixo(["compile", join(dir, "plugins/scratch-notes")]);
  assert.equal(again.code, 0, again.stderr);
  rmSync(join(dir, "plugins/scratch-notes"), { recursive: true });
});

test("the agent describes the app, checks, submits and uses a new plugin as ana", () => {
  const reference = agent(["describe", "--as", "ana"]);
  assert.match(reference, /todo-detail \(export todoDetail, panel\)/);
  assert.match(reference, /### @app\/sdk/);

  assert.match(agent(["check", "--as", "ana", "--dir", pluginDir]), /"ok": true/);
  const submitted = JSON.parse(agent(["submit", "--as", "ana", "--dir", pluginDir, "--raw"]));
  assert.equal(submitted.ok, true);
  assert.equal(submitted.version, 1);
  summaryId = submitted.plugin.id ?? submitted.plugin;
  assert.match(summaryId, /^plg_/);
  const used = JSON.parse(agent(["use", "--as", "ana", `${summaryId}@1`, "--slot", "todo-detail", "--raw"]));
  assert.equal(used.ok, true);

  const broken = join(pluginDir, "..", `${pluginDir.split("/").pop()}-broken`);
  mkdirSync(broken);
  writeFileSync(join(broken, "plugin.thx"), SUMMARY_PLUGIN.replace("useQuery(getTodo", "window.fetch(getTodo"));
  const refused = thixo(["agent", "check", "--as", "ana", "--dir", broken, "--project", dir]);
  rmSync(broken, { recursive: true });
  assert.match(refused.stdout + refused.stderr, /plugin\.thx:\d+:\d+/);
});

test("ana sees her personal plugin in the detail panel; ben still sees the default", async () => {
  const ana = await as("ana");
  await openTodo(ana, "Write the quarterly report");
  await detail(ana).getByRole("region", { name: "Todo summary (todo-detail)" }).getByText("Still open.").waitFor();
  await ana.context().close();

  const ben = await as("ben");
  await openTodo(ben, "Write the quarterly report");
  await detail(ben).getByRole("region", { name: "Due dates (todo-detail)" }).waitFor();
  assert.equal(await detail(ben).getByRole("region", { name: "Todo summary (todo-detail)" }).count(), 0);
  await ben.context().close();
});

test("ana shares it in the plugin browser; ben uses it, forks it and promotes it", async () => {
  const ana = await as("ana");
  await ana.getByRole("button", { name: "Plugins" }).click();
  const anas = pluginBrowser(ana).getByRole("listitem", { name: "Todo summary" });
  await anas.getByRole("button", { name: "Share Todo summary" }).click();
  await anas.getByText("shared · by ana").waitFor();
  await ana.context().close();

  const ben = await as("ben");
  await ben.getByRole("button", { name: "Plugins" }).click();
  const shared = pluginBrowser(ben).getByRole("listitem", { name: "Todo summary" }).filter({ hasText: "by ana" });
  await shared.getByRole("button", { name: "Use Todo summary" }).click();
  await pluginBrowser(ben).getByRole("listitem", { name: "Slot todo-detail" }).getByText("Todo summary").waitFor();
  await openTodo(ben, "Write the quarterly report");
  await detail(ben).getByRole("region", { name: "Todo summary (todo-detail)" }).getByText("Still open.").waitFor();

  await shared.getByRole("button", { name: "Fork Todo summary" }).click();
  await pluginBrowser(ben).getByRole("status").getByText("Forked Todo summary").waitFor();
  const fork = pluginBrowser(ben).getByRole("listitem", { name: "Todo summary" }).filter({ hasText: "personal · by ben" });
  await fork.waitFor();

  const promoted = ben.waitForResponse((r) => r.url().includes(`/registry/plugins/${summaryId}/promote`));
  await shared.getByRole("button", { name: "Promote Todo summary" }).click();
  const reply = await promoted;
  assert.equal(reply.status(), 200);
  const { folder } = await reply.json();
  assert.equal(folder, "todo-summary");
  const written = readFileSync(join(dir, "plugins", folder, "plugin.thx"), "utf8");
  assert.match(written, new RegExp(`id: "${summaryId}"`));
  await ben.context().close();
});

test("cy, who lacks todos.write, gets a message in main instead of the list the default plugin needs it for (G1)", async () => {
  const context = await browser.newContext();
  await context.addCookies([{ name: "thixo-user", value: "cy", url: dev.url }]);
  const cy = await context.newPage();
  const refused = cy.waitForResponse((r) => r.url().includes("/_thixo/plugins/plg_todo_list/1/load"));
  await cy.goto(dev.url);
  assert.equal((await refused).status(), 403);
  const alert = cy.getByRole("main").getByRole("alert");
  await alert.waitFor();
  assert.match(await alert.innerText(), /Todo list needs the scope todos\.write/);
  assert.equal(await list(cy).count(), 0);
  await context.close();
});

test("no page errors or console errors along the way", () => {
  assert.deepEqual(problems, []);
  assert.equal(existsSync(join(dir, ".thixo/dev.json")), true);
});
