import { window, setValue, waitFor } from "./helpers/dom.js";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { compile } from "thixo-thx";
import { createRuntime } from "thixo-thx/runtime";
import { main, todoDetail } from "../../../examples/todo/app/slots.js";
import type { PluginVersionRef } from "../src/contract.js";
import { buildCompileEnv } from "../src/server/index.js";
import { Shell, Slot } from "../src/shell/index.js";
import { pluginLoad } from "./helpers/plugins.js";
import { app, fakeServer, type FakeVersion } from "./helpers/todo-server.js";

const h = React.createElement;
const doc = window.document;
const env = buildCompileEnv(app, {});
const folder = join(import.meta.dirname, "../../../examples/todo/plugins");

/** The example's default plugins, compiled by the real thx compiler. */
function compiled(name: string, id: string, userCan?: string[]): FakeVersion {
  const files: Record<string, string> = {};
  for (const file of readdirSync(join(folder, name))) files[file] = readFileSync(join(folder, name, file), "utf8");
  const result = compile(files, env);
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors)}`);
  const m = result.manifest;
  return { load: pluginLoad(id, result.meta.name, m, userCan ? { userCan } : {}), code: result.code };
}

const versions = [
  compiled("todo-list", "plg_todo_list", ["listTodos", "createTodo", "updateTodo", "listAssignees"]),
  compiled("done-badge", "plg_done_badge"),
  compiled("due-dates", "plg_due_dates"),
];
const layout: Record<string, PluginVersionRef> = {
  main: { plugin: "plg_todo_list", number: 1 },
  "main/todo-row": { plugin: "plg_done_badge", number: 1 },
  "todo-detail": { plugin: "plg_due_dates", number: 1 },
};
const server = fakeServer({ user: "ana", versions, layout });

const loadModule = (text: string) => import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);

function App() {
  const [todoId, setTodoId] = React.useState<string | null>(null);
  return h(
    Shell,
    { fetch: server.fetch, createRuntime, loadModule },
    h(Slot, { is: main, on: { select: ({ todoId }: { todoId: string }) => setTodoId(todoId) } } as never),
    todoId && h(Slot, { is: todoDetail, context: { todoId } } as never),
  );
}

const container = doc.createElement("div");
doc.body.appendChild(container);
const root = createRoot(container as unknown as Element);
after(() => root.unmount());

const $ = (selector: string) => doc.querySelector(selector) as unknown as HTMLElement | null;
const $$ = (selector: string) => [...doc.querySelectorAll(selector)] as unknown as HTMLElement[];

test("the example's .thx plugins, compiled and run by the real thx runtime, fill main, each row and the detail panel", async () => {
  root.render(h(App));
  await waitFor(() => $('[data-slot="main"][data-plugin="plg_todo_list@1"]'), "the todo list");
  const rows = await waitFor(() => {
    const r = $$('[data-slot="main/todo-row"][data-plugin]');
    return r.length >= 3 && r.every((e) => /Done|Open/.test(e.textContent ?? "")) && r;
  }, "a done badge in every row");
  assert.deepEqual(rows.slice(0, 3).map((r) => r.textContent), ["Open", "Done", "Open"]);
  assert.equal($('[data-slot="main"] [role="alert"]'), null, "no plugin stopped");

  const deletes = $$('[data-slot="main"] button').filter((b) => b.textContent === "Delete");
  assert.ok(deletes.length >= 3 && deletes.every((b) => (b as HTMLButtonElement).disabled), "Delete greyed out for ana (P4)");
  assert.equal(server.requests.some((r) => r.path === "/api/assignees"), true, "ana can list assignees");

  const title = $$('[data-slot="main"] button').find((b) => b.textContent === "Write the quarterly report")!;
  title.click();
  const detail = await waitFor(() => $('[data-slot="todo-detail"][data-plugin="plg_due_dates@1"]'), "the due dates panel");
  const date = await waitFor(() => detail.querySelector('input[type="date"]') as HTMLInputElement | null, "the due date input");
  await waitFor(() => detail.textContent?.includes("Write the quarterly report"), "the todo's title in the card");
  setValue(date, "2026-12-01");
  const patch = await waitFor(() => server.requests.find((r) => r.path === "/_thixo/data/patch"), "the annotation patch");
  const body = patch.body as { plugin: string; at: unknown; fields: { dueOn: string } };
  assert.equal(body.plugin, "plg_due_dates");
  assert.deepEqual(body.at, { record: "todo", id: "todo-1" });
  assert.match(body.fields.dueOn, /^2026-1[12]-\d\dT/);
  assert.equal($('[data-slot="todo-detail"] [role="alert"]'), null, "due dates kept running");
});

test("the runtime's css() rules land in the page under the plugin's scope class", async () => {
  const sheets = $$("style[data-thixo-plugin]");
  const text = sheets.map((s) => s.textContent ?? "").join("\n");
  assert.match(text, /\.thx-p-plg_done_badge-1 \.thx/, "done-badge's placeholder class is in the page");
  for (const rule of text.split("\n").filter(Boolean)) assert.match(rule, /^(@media[^{]*\{)?\.thx-p-[\w-]+ \.thx/, rule);
});

test("adding a todo through the compiled list goes through the broker to the API", async () => {
  const input = $('[data-slot="main"] input[placeholder="Add a todo"]')!;
  setValue(input, "Water the plants");
  await waitFor(() => (input as HTMLInputElement).value === "Water the plants", "the typed title");
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  await waitFor(() => $$('[data-slot="main"] button').some((b) => b.textContent === "Water the plants"), "the new todo");
  const created = server.requests.find((r) => r.method === "POST" && r.path === "/api/todos");
  assert.deepEqual(created?.body, { title: "Water the plants" });
});
