// What the red team found, driven the way an attacker would: `thixo dev` on a disposable copy of examples/todo, an
// outside listener on another port, plugins submitted through `thixo agent`, and headless Chromium as each user.
// Run it with `npm run e2e` after `npm run build`.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { copyExample, removeCopy, startDev, thixo } from "./support.mjs";

let dir;
let dev;
let browser;
let outside;
let outsideUrl;
const hits = [];
const folders = [];

before(async () => {
  outside = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "content-type": "image/gif", "access-control-allow-origin": "*" });
    response.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
  });
  await new Promise((ok) => outside.listen(0, "127.0.0.1", ok));
  outsideUrl = `http://127.0.0.1:${outside.address().port}`;
  dir = copyExample("todo");
  dev = await startDev(dir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await dev?.stop();
  removeCopy(dir);
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  await new Promise((ok) => (outside ? outside.close(ok) : ok()));
});

function pluginFolder(files) {
  const folder = mkdtempSync(join(tmpdir(), "thixo-plugin-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  folders.push(folder);
  return folder;
}

function agent(args) {
  const result = thixo(["agent", ...args, "--project", dir]);
  assert.equal(result.code, 0, `thixo agent ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Submits a folder as `user` and puts it in their todo-detail slot. */
function submitAndUse(user, folder) {
  const submitted = agent(["submit", "--as", user, "--dir", folder, "--raw"]);
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  const id = submitted.plugin.id ?? submitted.plugin;
  agent(["use", "--as", user, `${id}@${submitted.version}`, "--slot", "todo-detail", "--raw"]);
  return { id, version: submitted.version };
}

/** Waits for `thixo dev` to print a line. Its output arrives on the event loop, which `thixo(...)` blocks. */
async function logged(pattern) {
  for (let i = 0; i < 50 && !pattern.test(dev.output()); i++) await new Promise((ok) => setTimeout(ok, 100));
  assert.match(dev.output(), pattern);
}

async function as(user, options = {}) {
  const context = await browser.newContext(options);
  await context.addCookies([{ name: "thixo-user", value: user, url: dev.url }]);
  const page = await context.newPage();
  await page.goto(dev.url);
  await page.getByRole("region", { name: "Todo list (main)" }).waitFor();
  return page;
}

async function openTodo(page, title) {
  await page.getByRole("region", { name: "Todo list (main)" }).getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("region", { name: "Selected todo" }).waitFor();
}

test("a Url handed in from data can't make an image load from a host the app did not list, even with no CSP (L4, L7)", async () => {
  // redteam-language round 2: a url field seeded with an outside address and rendered as <img src> was a zero-click
  // GET to that host. The language now refuses it; the page's CSP is bypassed here so it can't be what stops it.
  const picture = submitAndUse(
    "ana",
    pluginFolder({
      "data.thx": `import { annotate } from "thixo/data";\nimport { t } from "thixo/schema";\nimport { Todo } from "@app/sdk";\n\nexport const pic = annotate(Todo, { link: t.url() });\n`,
      "plugin.thx": `import { definePlugin, useAnnotation } from "thixo/plugin";
import { todoDetail } from "@app/slots";
import { pic } from "./data";

export default definePlugin(todoDetail, { name: "Picture", description: "Shows a picture for a todo." }, function Picture({ context }) {
  const [fields] = useAnnotation(pic, context.todoId);
  if (!fields || !fields.link) return <p>No picture yet</p>;
  return <div><img src={fields.link} alt="the picture" /><div style={{ backgroundImage: fields.link }}>also</div></div>;
});
`,
    }),
  );

  const page = await as("ana", { bypassCSP: true });
  // Control: with the CSP bypassed, the page itself can reach the listener, so silence below means the language.
  await page.evaluate((u) => new Promise((ok) => Object.assign(new Image(), { onload: ok, onerror: ok, src: `${u}/control` })), outsideUrl);
  assert.deepEqual(hits, ["GET /control"]);
  hits.length = 0;

  // The attacker seeds the field over the plugin data route, as any signed-in user can for a plugin they run.
  const seeded = await page.evaluate(
    async ({ plugin, version, beacon }) => {
      const { token } = await (await fetch("/_thixo/token", { method: "POST" })).json();
      const todos = await (await fetch("/api/todos", { headers: { authorization: `Bearer ${token}` } })).json();
      const todo = todos.find((t) => t.title === "Write the quarterly report");
      const response = await fetch("/_thixo/data/patch", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ plugin, version, at: { record: "todo", id: todo.id }, fields: { link: { $url: beacon } } }),
      });
      return response.status;
    },
    { plugin: picture.id, version: picture.version, beacon: `${outsideUrl}/beacon?secret=1` },
  );
  assert.equal(seeded, 204, "the server takes an http address for a url field");

  await openTodo(page, "Write the quarterly report");
  const stopped = page.getByRole("alert").filter({ hasText: "can't load that address" });
  await stopped.waitFor();
  assert.match(await stopped.innerText(), /stopped: .*an outside address a plugin loads must be on one of the app's address hosts/);
  assert.equal(await page.locator(`img[src^="${outsideUrl}"]`).count(), 0, "no image with the outside address reached the page");
  await page.waitForLoadState("networkidle");
  await new Promise((ok) => setTimeout(ok, 300));
  assert.deepEqual(hits, [], "nothing arrived at the outside listener");
  await page.context().close();
});

/** The red team's round 2 plugin: a dialog titled like the shell's own sign-in. `title` and `field` vary it. */
const reminderSource = ({ title, field }) => `import { definePlugin } from "thixo/plugin";
import { openModal } from "thixo/services";
import { todoDetail } from "@app/slots";

export default definePlugin(todoDetail, { name: "Reminder", description: "A small reminder widget." }, function Reminder() {
  function show() {
    openModal(<div><label>${field}<input type="text" /></label><button>Sign in</button></div>, { title: "${title}" });
  }
  return <button onClick={show}>Remind me later</button>;
});
`;

test("the submit path refuses the red team's sign-in dialog outright, and records it (the authoring guard)", async () => {
  // redteam-social round 2, second layer: the source says "Session expired" and asks for a password in a field.
  const folder = pluginFolder({ "plugin.thx": reminderSource({ title: "Session expired", field: "Password" }) });
  const result = thixo(["agent", "submit", "--as", "ana", "--dir", folder, "--project", dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /plugin\.thx:\d+:\d+ guard\/credentials The plugin says "Session expired", which is what the app's own sign-in says\./);
  assert.match(result.stdout, /"count": 1/);
  const refusals = JSON.parse(thixo(["authoring", "refusals", dir, "--user", "ana", "--json"]).stdout);
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].source, "check");
  await logged(/authoring refused ana \(credentials, check, 1 of 3 in 24h\)/);
  // Start ana's count again, so the tests after this one are not one refusal closer to a block.
  assert.equal(thixo(["authoring", "unblock", "ana", dir]).code, 0);
});

test("a plugin's dialog always says which plugin drew it, outside the plugin's reach (S8, P8)", async () => {
  // redteam-social round 2: openModal drew shell chrome titled "Session expired" with no word of which plugin it was.
  // The submit path now refuses those words (above), so this plugin says something milder: the dialog is still
  // attributed, which is the guard that does not depend on the words.
  const reminder = agent([
    "submit",
    "--as",
    "ana",
    "--raw",
    "--dir",
    pluginFolder({ "plugin.thx": reminderSource({ title: "Heads up", field: "Note" }) }),
  ]);
  assert.equal(reminder.ok, true, JSON.stringify(reminder));
  const id = reminder.plugin.id ?? reminder.plugin;
  const ana = await as("ana");
  await ana.getByRole("button", { name: "Plugins" }).click();
  const item = ana.getByRole("region", { name: "Plugin browser" }).getByRole("listitem", { name: "Reminder" });
  await item.getByRole("button", { name: "Share Reminder" }).click();
  await item.getByText("shared · by ana").waitFor();
  await ana.context().close();

  const ben = await as("ben");
  agent(["use", "--as", "ben", `${id}@1`, "--slot", "todo-detail", "--raw"]);
  await ben.reload();
  await openTodo(ben, "Review the pull request");
  await ben.getByRole("region", { name: "Reminder (todo-detail)" }).getByRole("button", { name: "Remind me later" }).click();
  const dialog = ben.getByRole("dialog");
  await dialog.waitFor();
  const name = await dialog.evaluate((el) => el.getAttribute("aria-labelledby").split(" ").map((i) => document.getElementById(i).textContent).join(" "));
  assert.equal(name, "Heads up From the plugin “Reminder”, by ana");
  const source = dialog.getByText("From the plugin “Reminder”, by ana");
  assert.equal(await source.isVisible(), true);
  assert.equal(await source.evaluate((el) => el.closest(".thixo-slot-box") === null), true, "the line is the shell's, not inside the plugin's box");
  await ben.context().close();
});

test("a plugin can't be shared under a default plugin's name, and the registry marks the default (G5)", async () => {
  // redteam-social round 2: a shared "Due dates" with the default's description sat beside the real one.
  const spoof = agent([
    "submit",
    "--as",
    "ana",
    "--raw",
    "--dir",
    pluginFolder({
      "plugin.thx": `import { definePlugin } from "thixo/plugin";
import { todoDetail } from "@app/slots";

export default definePlugin(todoDetail, { name: "Due dates", description: "Give a todo a due date and see a warning when it is close." }, function Spoof() {
  return <p>Not the real one</p>;
});
`,
    }),
  ]);
  assert.equal(spoof.ok, true, JSON.stringify(spoof));

  const ana = await as("ana");
  await ana.getByRole("button", { name: "Plugins" }).click();
  const browserRegion = ana.getByRole("region", { name: "Plugin browser" });
  const search = browserRegion.getByRole("search", { name: "Search plugins" });
  await search.getByRole("textbox", { name: "Search plugins" }).fill("Due dates");
  await search.getByRole("button", { name: "Search" }).click();
  const mine = browserRegion.getByRole("listitem", { name: "Due dates" }).filter({ hasText: "personal · by ana" });
  await mine.waitFor();
  await mine.getByRole("button", { name: "Share Due dates" }).click();
  const refused = browserRegion.getByRole("alert").filter({ hasText: "Share failed" });
  await refused.waitFor();
  assert.match(await refused.innerText(), /already the name of a default plugin of this app/);
  await ana.context().close();

  const ben = await as("ben");
  await ben.getByRole("button", { name: "Plugins" }).click();
  const benRegion = ben.getByRole("region", { name: "Plugin browser" });
  await benRegion.getByRole("search", { name: "Search plugins" }).getByRole("textbox", { name: "Search plugins" }).fill("Due dates");
  await benRegion.getByRole("search", { name: "Search plugins" }).getByRole("button", { name: "Search" }).click();
  const found = benRegion.getByRole("listitem", { name: "Due dates" });
  await found.first().waitFor();
  assert.equal(await found.count(), 1, "ben sees only the default");
  await found.getByText("Default", { exact: true }).waitFor();
  await ben.context().close();
});

test("three refusals block a person from making plugins on every path, using plugins still works, and the implementor lifts it", async () => {
  // Start from a clean count, whatever the tests before this one did.
  assert.equal(thixo(["authoring", "unblock", "ana", dir]).code, 0);
  const refuse = (n) =>
    thixo(["agent", "refuse", "--as", "ana", "--project", dir, "--json", JSON.stringify({ category: "credentials", reason: `Attempt ${n} asks for the person's password.`, from: "user", quote: "ask for their password" })]);
  const first = refuse(1);
  assert.equal(first.code, 0, first.stderr);
  assert.match(JSON.parse(first.stdout).refusal.message, /refusal 1 of 3 within 24 hours\. 2 more and you will no longer be able to make plugins/);
  assert.match(JSON.parse(refuse(2).stdout).refusal.message, /One more and you will no longer/);
  const third = JSON.parse(refuse(3).stdout);
  assert.equal(third.refusal.blocked, true);
  await logged(/authoring blocked ana from making plugins\. Lift it with `thixo authoring unblock ana`\./);

  // Every authoring tool, through `thixo agent --as`.
  for (const command of [["describe"], ["search", "due"], ["check", "--dir", pluginFolder({ "plugin.thx": "x" })]]) {
    const refused = thixo(["agent", ...command, "--as", "ana", "--project", dir]);
    assert.equal(refused.code, 1, command.join(" "));
    assert.match(refused.stderr, /failed \(403 authoring_blocked\): You can no longer make plugins in this app: Thixo's authoring agent refused 3 of your requests within 24 hours\. You can still use and install plugins\./);
    assert.doesNotMatch(refused.stderr, /agent key/);
  }
  const blocks = thixo(["authoring", "blocks", dir]);
  assert.match(blocks.stdout, /^USER +SINCE +STATE +REFUSALS +REASON\nana .* blocked +3 /);

  // The chat says so before anyone types, and the plugin browser still installs a plugin.
  const ana = await as("ana");
  await ana.getByRole("button", { name: "Ask for a plugin" }).click();
  const chat = ana.getByRole("region", { name: "Authoring chat" });
  await chat.getByText(/You can no longer make plugins in this app/).waitFor();
  assert.equal(await chat.getByRole("textbox", { name: "Message" }).isDisabled(), true);
  assert.equal(await chat.getByRole("button", { name: "Send" }).isDisabled(), true);
  await ana.getByRole("button", { name: "Plugins" }).click();
  const browserRegion = ana.getByRole("region", { name: "Plugin browser" });
  const search = browserRegion.getByRole("search", { name: "Search plugins" });
  await search.getByRole("textbox", { name: "Search plugins" }).fill("Reminder");
  await search.getByRole("button", { name: "Search" }).click();
  const item = browserRegion.getByRole("listitem", { name: "Reminder" }).first();
  await item.waitFor();
  await item.getByRole("button", { name: /^Use Reminder/ }).click();
  await browserRegion.getByText(/In use: v\d+ in todo-detail/).first().waitFor();
  await ana.context().close();

  // The implementor lifts it, and the agent answers ana again.
  const lifted = thixo(["authoring", "unblock", "ana", dir]);
  assert.equal(lifted.code, 0);
  assert.match(lifted.stdout, /^Lifted the block on ana\./);
  assert.equal(thixo(["agent", "describe", "--as", "ana", "--project", dir]).code, 0);
  assert.match(thixo(["authoring", "blocks", dir]).stdout, /No one is blocked/);
});
