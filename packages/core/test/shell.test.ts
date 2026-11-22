import { act, window, setValue, waitFor } from "./helpers/dom.js";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { main, todoDetail } from "../../../examples/todo/app/slots.js";
import type { PluginSummary, PluginVersionRef } from "../src/contract.js";
import { AuthoringChat, PluginBrowser, Shell, Slot, useThixo } from "../src/shell/index.js";
import { createFakeRuntime, type FakeRuntime } from "./helpers/fake-runtime.js";
import { manifest, modules, pluginLoad } from "./helpers/plugins.js";
import { fakeServer, type FakeVersion } from "./helpers/todo-server.js";

const h = React.createElement;
const doc = window.document;

const versions: FakeVersion[] = [
  {
    load: pluginLoad("plg_todo_list", "Todo list", manifest({ slot: "main", requiredEndpoints: ["listTodos", "createTodo"], optionalEndpoints: ["deleteTodo"] }), {
      userCan: ["listTodos", "createTodo"],
    }),
    code: "todo-list",
  },
  { load: pluginLoad("plg_done_badge", "Done badge", manifest({ slot: "todo-row", requiredEndpoints: ["getTodo"] })), code: "done-badge" },
  { load: pluginLoad("broken", "Broken", manifest({ slot: "todo-detail" })), code: "broken" },
  {
    load: pluginLoad(
      "plg_due_dates",
      "Due dates",
      manifest({ slot: "todo-detail", requiredEndpoints: ["getTodo"], annotates: ["todo"], data: { stores: {}, annotations: { todo: [{ name: "dueOn", type: "date" }] } } }),
    ),
    code: "due-dates",
  },
  { load: pluginLoad("plg_star", "Star", manifest({ slot: "todo-row", requiredEndpoints: ["getTodo"] })), code: "done-badge" },
];

const summary = (v: FakeVersion, isDefault: boolean, lines: string[]): PluginSummary => ({
  plugin: v.load.plugin,
  latest: v.load.version,
  manifest: v.load.manifest,
  summary: lines,
  requiredScopes: ["todos.read"],
  optionalScopes: [],
  isDefault,
});

const layout: Record<string, PluginVersionRef> = {
  main: { plugin: "plg_todo_list", number: 1 },
  "main/todo-row": { plugin: "plg_done_badge", number: 1 },
  "todo-detail": { plugin: "broken", number: 1 },
};

const runtimes: FakeRuntime[] = [];
const container = doc.createElement("div");
doc.body.appendChild(container);
const root = createRoot(container as unknown as Element);
after(() => act(() => root.unmount()));

let thixoValue: ReturnType<typeof useThixo> | undefined;

function App(props: { fetch: (input: string, init?: RequestInit) => Promise<Response>; browser: boolean }) {
  const [todoId, setTodoId] = React.useState<string | null>(null);
  return h(
    Shell,
    {
      fetch: props.fetch,
      createRuntime: (host) => {
        const rt = createFakeRuntime(host);
        runtimes.push(rt);
        return rt;
      },
      loadModule: async (text) => modules[text],
    },
    h(Probe),
    h("main", null, h(Slot, { is: main, on: { select: ({ todoId }: { todoId: string }) => setTodoId(todoId) } } as never)),
    todoId && h("aside", null, h(Slot, { is: todoDetail, context: { todoId } } as never)),
    props.browser && h(PluginBrowser),
    h(AuthoringChat),
  );
}

function Probe() {
  thixoValue = useThixo();
  return null;
}

const $ = (selector: string) => doc.querySelector(selector) as unknown as HTMLElement | null;
const $$ = (selector: string) => [...doc.querySelectorAll(selector)] as unknown as HTMLElement[];
const byLabel = (label: string) => $(`[aria-label="${label}"]`);
const click = (el: Element | null) => act(async () => void (el as HTMLElement).click());

const server = fakeServer({
  user: "ana",
  versions,
  layout,
  summaries: [
    summary(versions[0], true, ["Reads todos", "Creates and changes todos"]),
    summary(versions[1], true, ["Reads todos"]),
    { ...summary(versions[3], false, ["Reads todos", "Adds a due date to todos"]), plugin: { ...versions[3].load.plugin, author: "ben", visibility: "personal" } },
  ],
  chat: [
    JSON.stringify({ type: "conversation", id: "c1" }),
    JSON.stringify({ type: "text", text: "Looking at the registry. " }),
    JSON.stringify({ type: "tool", id: "t1", name: "search_registry", input: { q: "due" } }),
    JSON.stringify({ type: "tool_result", id: "t1", name: "search_registry", ok: true, output: JSON.stringify({ results: [{}, {}] }) }),
    JSON.stringify({ type: "tool", id: "t2", name: "use", input: { plugin: "plg_star", version: 1, slot: "row" } }),
    JSON.stringify({ type: "tool_result", id: "t2", name: "use", ok: false, output: JSON.stringify({ error: { code: "unknown_slot", message: 'There is no slot "row". The slot paths are: main, main/todo-row, todo-detail.' } }) }),
    JSON.stringify({ type: "tool", id: "t3", name: "use", input: { plugin: "plg_star", version: 1, slot: "main/todo-row" } }),
    JSON.stringify({ type: "tool_result", id: "t3", name: "use", ok: true, output: JSON.stringify({ ok: true, slot: "main/todo-row", plugin: "plg_star", version: 1, confirmed: true }) }),
    JSON.stringify({ type: "text", text: "Done: I put Star in each row." }),
    JSON.stringify({ type: "done", conversation: "c1" }),
  ],
});

test("the shell signs in, loads the layout, and fills the main slot and each row's child slot", async () => {
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: false })));
  const box = await waitFor(() => $('[data-slot="main"][data-plugin]'), "the main slot to fill");
  assert.equal(box.getAttribute("aria-label"), "Todo list (main)");
  const style = box.getAttribute("style") ?? "";
  for (const rule of ["contain: layout paint style", "overflow: auto", "isolation: isolate", "position: relative", "width: 100%", "height: 100%"]) {
    assert.ok(style.includes(rule), `${rule} in ${style}`);
  }
  assert.match(box.className, /thx-p-plg_todo_list-1/);

  const badges = await waitFor(() => {
    const rows = $$('[data-slot="main/todo-row"][data-plugin]');
    return rows.length >= 3 && rows.every((r) => /Done|Open/.test(r.textContent ?? "")) && rows;
  }, "a done badge in every row");
  assert.ok(badges.some((b) => b.textContent === "Done") && badges.some((b) => b.textContent === "Open"));

  const token = server.requests.find((r) => r.path === "/_thixo/token");
  assert.ok(token, "asked for a token");
  assert.ok(server.requests.filter((r) => r.path.startsWith("/api/")).every((r) => r.authorization?.startsWith("Bearer ")));
  assert.equal(thixoValue?.user?.id, "ana");
  assert.equal(typeof thixoValue?.api.listTodos, "function");
  assert.ok((await thixoValue!.api.listTodos()).length >= 3);

  const deleteButtons = $$('[data-slot="main"] button').filter((b) => b.textContent === "Delete");
  assert.ok(deleteButtons.length >= 3 && deleteButtons.every((b) => (b as HTMLButtonElement).disabled), "Delete is greyed out for ana (P4)");
  assert.equal(server.requests.filter((r) => r.path.startsWith("/api/todos/") && r.method === "DELETE").length, 0);
});

test("a plugin's css() rules are injected under its scope class, without the outside address", async () => {
  const sheets = await waitFor(() => $$("style[data-thixo-plugin]").filter((s) => s.dataset.thixoPlugin === "thx-p-plg_done_badge-1"), "the badge's stylesheet");
  assert.ok(sheets.length >= 1);
  for (const sheet of sheets) {
    for (const line of (sheet.textContent ?? "").split("\n").filter(Boolean)) assert.ok(line.startsWith(".thx-p-plg_done_badge-1 .thx-c-"), line);
    assert.ok(!(sheet.textContent ?? "").includes("evil.test"));
  }
});

test("adding a todo through the plugin calls the API through the broker", async () => {
  const before = $$('[data-slot="main/todo-row"][data-plugin]').length;
  const input = $('[data-slot="main"] input[placeholder="Add a todo"]')!;
  await act(async () => setValue(input, "Buy milk"));
  await act(async () => void input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event));
  await waitFor(() => [...$$('[data-slot="main"] button')].some((b) => b.textContent === "Buy milk"), "the new todo in the list");
  const created = server.requests.find((r) => r.method === "POST" && r.path === "/api/todos");
  assert.deepEqual(created?.body, { title: "Buy milk" });
  await waitFor(() => $$('[data-slot="main/todo-row"][data-plugin]').length === before + 1, "a row slot for the new todo");
});

test("an event from the plugin opens the detail slot, and a plugin that throws is replaced by a message", async () => {
  const first = $$('[data-slot="main"] button').find((b) => b.textContent === "Write the quarterly report")!;
  await click(first);
  const message = await waitFor(() => $('[data-slot="todo-detail"] [role="alert"]'), "the broken plugin's message");
  assert.equal(message.textContent, "Broken stopped: kaboom");
  assert.ok($('[data-slot="main"][data-plugin]'), "the rest of the app keeps running");
  assert.ok($$('[data-slot="main/todo-row"][data-plugin]').length >= 3);
});

test("the plugin browser shows each slot's version, the summary before use, and disables what the user can't do", async () => {
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: true })));
  const browser = await waitFor(() => byLabel("Plugin browser"), "the plugin browser");
  await waitFor(() => byLabel("Due dates"), "search results");
  assert.equal(byLabel("Slot main")?.querySelector("[data-testid]")?.textContent, "Todo list v1");
  assert.equal(byLabel("Slot main/todo-row")?.querySelector("[data-testid]")?.textContent, "Done badge v1");
  assert.ok(byLabel("Slot todo-detail"));
  const due = byLabel("Due dates")!;
  assert.deepEqual([...due.querySelectorAll("li")].map((li) => li.textContent), ["Reads todos", "Adds a due date to todos"]);
  assert.match(byLabel("Scopes of Due dates")!.textContent ?? "", /Needs: todos.read/);
  const promote = byLabel("Promote Due dates") as HTMLButtonElement;
  assert.equal(promote.disabled, true);
  assert.equal(promote.title, "Promoting needs thixo.plugins.promote");
  assert.equal((byLabel("Share Due dates") as HTMLButtonElement).title, "Only its author can share it");
  assert.equal((byLabel("Use Todo list") as HTMLButtonElement).title, "Already in use in main");
  assert.equal((byLabel("Reset main to default") as HTMLButtonElement).disabled, true);
  assert.ok(browser);

  await click(byLabel("Use Due dates"));
  await waitFor(() => $('[data-slot="todo-detail"][data-plugin="plg_due_dates@1"]'), "due dates in the detail slot");
  assert.deepEqual(server.changes["todo-detail"], { plugin: "plg_due_dates", number: 1 });
  await waitFor(() => byLabel("Slot todo-detail")?.textContent?.includes("Due dates v1"), "the layout list to update");
  await waitFor(() => ($('[data-slot="todo-detail"] input[type="date"]') as HTMLInputElement | null), "the due date input");
  const reset = byLabel("Reset todo-detail to default") as HTMLButtonElement;
  assert.equal(reset.disabled, false);
  await click(reset);
  await waitFor(() => $('[data-slot="todo-detail"] [role="alert"]'), "the default back in the slot");
  assert.equal(server.changes["todo-detail"], undefined);
});

test("the plugin browser says which version each slot is on, when a newer one exists, and moves the slot to it", async () => {
  const badgeV2: FakeVersion = { load: { ...versions[1].load, version: 2, code: "/_thixo/plugins/plg_done_badge/2.js" }, code: "done-badge" };
  const newer = fakeServer({
    user: "ana",
    versions: [...versions, badgeV2],
    layout,
    summaries: [{ ...summary(badgeV2, true, ["Reads todos"]), defaultVersion: 1 }],
  });
  await act(async () => root.render(h("div")));
  await act(async () => root.render(h(App, { fetch: newer.fetch, browser: true })));
  const row = await waitFor(() => (byLabel("Slot main/todo-row")?.textContent?.includes("v2 is newer") ? byLabel("Slot main/todo-row") : null), "the newer version beside the slot");
  assert.equal(row.querySelector("[data-testid]")?.textContent, "Done badge v1");
  assert.equal(byLabel("Done badge in use")?.textContent, "In use: v1 in main/todo-row (v2 is newer: Use moves to it)");
  assert.equal(byLabel("Slot main")?.textContent?.includes("is newer"), false, "a slot on the newest version says nothing");
  await click(byLabel("Move main/todo-row to v2"));
  assert.deepEqual(newer.changes["main/todo-row"], { plugin: "plg_done_badge", number: 2 });
  await waitFor(() => $$('[data-slot="main/todo-row"][data-plugin="plg_done_badge@2"]').length >= 3, "every row on v2");
  await waitFor(() => byLabel("Plugin browser")?.querySelector('[role="status"]')?.textContent?.startsWith("Moved main/todo-row to Done badge v2"), "the status");
  assert.equal(byLabel("Slot main/todo-row")?.textContent?.includes("is newer"), false);
  await act(async () => root.render(h("div")));
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: true })));
});

test("with the browser open, an empty slot shows where it is", async () => {
  const saved = layout["main/todo-row"];
  Reflect.deleteProperty(layout, "main/todo-row");
  await act(async () => root.render(h("div")));
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: true })));
  await waitFor(() => $$('[aria-label="Empty slot main/todo-row"]').length >= 3, "empty child slots");
  layout["main/todo-row"] = saved;
});

test("the authoring chat streams the agent's events, shows each tool's outcome, and the page shows what use put in the layout without a reload", async () => {
  await act(async () => root.render(h("div")));
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: false })));
  await waitFor(() => $$('[data-slot="main/todo-row"][data-plugin="plg_done_badge@1"]').length >= 3, "the done badges");
  const layoutsBefore = server.requests.filter((r) => r.path === "/_thixo/layout").length;
  // What the agent's use writes on the server; the page learns of it only by loading the layout again.
  server.changes["main/todo-row"] = { plugin: "plg_star", number: 1 };
  const message = byLabel("Message")!;
  await act(async () => setValue(message, "Give todos a due date"));
  // Enter in the box sends, as in any chat (verify-chat); Shift+Enter would start a new line.
  await act(async () => void message.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event));
  const log = await waitFor(() => (byLabel("Chat messages")?.textContent?.includes("Done") ? byLabel("Chat messages") : null), "the chat to finish");
  const lines = [...log.children].map((c) => [c.getAttribute("data-kind"), c.textContent]);
  assert.deepEqual(lines, [
    ["user", "Give todos a due date"],
    ["agent", "Looking at the registry. "],
    ["tool", "search_registry found 2 plugins"],
    ["tool", 'use failed: There is no slot "row". The slot paths are: main, main/todo-row, todo-detail.'],
    ["tool", "use put plg_star@1 in main/todo-row (confirmed in your layout)"],
    ["agent", "Done: I put Star in each row."],
    ["done", "Done"],
  ]);
  assert.equal(log.querySelector('[data-ok="false"]')?.textContent?.startsWith("use failed"), true, "a failed tool line is marked");
  assert.deepEqual(server.requests.find((r) => r.path === "/_thixo/authoring/chat")?.body, { message: "Give todos a due date" });
  await waitFor(() => server.requests.filter((r) => r.path === "/_thixo/layout").length > layoutsBefore, "the layout to load again");
  await waitFor(() => $$('[data-slot="main/todo-row"][data-plugin="plg_star@1"]').length >= 3, "every row to show the plugin use put there");
  assert.equal($$('[data-slot="main/todo-row"][data-plugin="plg_done_badge@1"]').length, 0, "the old plugin is gone without a reload");

  // The next message carries the conversation id the last turn ended with.
  await act(async () => setValue(message, "Make it red"));
  await act(async () => void message.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event));
  await waitFor(() => server.requests.filter((r) => r.path === "/_thixo/authoring/chat").length === 2, "the second message");
  assert.deepEqual(server.requests.filter((r) => r.path === "/_thixo/authoring/chat")[1].body, { message: "Make it red", conversation: "c1" });
  await waitFor(() => !byLabel("Authoring chat")?.querySelector('[aria-busy="true"]'), "the second turn to end");
  Reflect.deleteProperty(server.changes, "main/todo-row");
});

test("when its slot unmounts the plugin stops: later SDK calls from it reject without a request (P7)", async () => {
  await act(async () => root.render(h("div")));
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: false })));
  await waitFor(() => $$('[data-slot="main/todo-row"][data-plugin]').length >= 3, "the rows again");
  const rt = runtimes[runtimes.length - 1];
  const getTodo = rt.host.modules["@app/sdk"].getTodo as (input: unknown) => Promise<{ title: string }>;
  const [todo] = await thixoValue!.api.listTodos();
  assert.equal((await getTodo({ id: todo.id })).title, todo.title, "the badge's broker works while it is on screen");
  await act(async () => root.render(h("div")));
  const toast = rt.host.modules["thixo/services"].toast as (message: string) => void;
  await waitFor(() => {
    try {
      toast("x");
    } catch (error) {
      return /the plugin has stopped/.test(String(error));
    }
  }, "the unmount to stop the plugin");
  const count = server.requests.length;
  await assert.rejects(getTodo({ id: todo.id }), /getTodo refused: the plugin has stopped/);
  assert.equal(server.requests.length, count);
});

test("a plugin the runtime stops outside a render (out of budget) is replaced by a message, and the rest keeps running", async () => {
  await act(async () => root.render(h("div")));
  const first = runtimes.length;
  await act(async () => root.render(h(App, { fetch: server.fetch, browser: false })));
  await waitFor(() => $$('[data-slot="main/todo-row"][data-plugin]').length >= 3, "the rows");
  const badge = runtimes[runtimes.length - 1];
  badge.host.onError?.(new Error("ran out of budget"));
  const message = await waitFor(() => $('[data-slot="main/todo-row"] [role="alert"]'), "the row slot's message");
  assert.equal(message.textContent, "Done badge stopped: ran out of budget");
  assert.ok($$('[data-slot="main/todo-row"][data-plugin]').length >= 2, "the other rows keep running");
  runtimes[first].host.onError?.(new Error("ran out of budget"));
  const main = await waitFor(() => $('[data-slot="main"] > [role="alert"]'), "the main slot's message");
  assert.equal(main.textContent, "Todo list stopped: ran out of budget");
  await act(async () => root.render(h("div")));
});
