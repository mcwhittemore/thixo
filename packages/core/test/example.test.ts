import assert from "node:assert/strict";
import { test } from "node:test";
import * as scopesModule from "../../../examples/todo/api/scopes.js";
import * as sessionModule from "../../../examples/todo/api/session.js";
import * as todosModule from "../../../examples/todo/api/todos.js";
import * as slotsModule from "../../../examples/todo/app/slots.js";
import { collectApp } from "../src/api/index.js";
import { defineConfig } from "../src/index.js";
import { createThixo } from "../src/server/index.js";
import { memoryAdapters } from "./helpers/adapters.js";
import { call, tokenFor } from "./helpers/client.js";

const modules = [scopesModule, sessionModule, todosModule, slotsModule] as Record<string, unknown>[];
const app = collectApp(modules, {});

test("collectApp finds the todo example's endpoints, record, slots and scopes by export name", () => {
  assert.deepEqual(
    app.endpoints.map((e) => e.name).sort(),
    ["createTodo", "deleteTodo", "getTodo", "listAssignees", "listTodos", "updateTodo"],
  );
  assert.deepEqual(app.records.map((r) => [r.name, r.exportName, r.read]), [["todo", "Todo", ["todos.read"]]]);
  assert.deepEqual(app.slots.map((s) => [s.exportName, s.name, s.kind]).sort(), [
    ["main", "main", "page"],
    ["todoDetail", "todo-detail", "panel"],
    ["todoRow", "todo-row", "widget"],
  ]);
  const main = app.slots.find((s) => s.exportName === "main")!;
  assert.deepEqual(main.children, ["todo-row"]);
  assert.deepEqual(main.emits, { select: { kind: "object", fields: { todoId: { kind: "string" } } } });
  assert.deepEqual(app.slots.find((s) => s.exportName === "todoRow")!.context, { todoId: { kind: "string" } });
  for (const scope of ["todos.read", "people.read", "thixo.plugins.share"]) assert.ok(scope in app.scopes, scope);
  assert.ok(app.records[0].canRead && app.records[0].group);
});

test("collectApp rejects mistakes with the export named", async () => {
  const { endpoint, defineScopes } = await import("../src/api/index.js");
  const { t } = await import("../src/schema/index.js");
  const ok = defineScopes({ a: "A" });
  const e = (path: string, scopes: string[]) => endpoint({ method: "GET", path, scopes, handler: () => 1 });
  assert.throws(() => collectApp([{ ok, e: e("/x", ["nope"]) }], {}), /endpoint e carries scope "nope"/);
  assert.throws(() => collectApp([{ ok, e: e("/x", ["a"]), f: e("/x", ["a"]) }], {}), /already taken/);
  assert.throws(() => collectApp([{ ok, e: e("/x", ["a"]) }, { e: e("/y", ["a"]) }], {}), /Two endpoints are exported as "e"/);
  const same = e("/z", ["a"]);
  assert.equal(collectApp([{ ok, same }, { same, again: same }], {}).endpoints.length, 1);
  const { record } = await import("../src/api/index.js");
  const R = record("r", { read: ["a"], fields: { id: t.string() } });
  const usesR = endpoint({ method: "GET", path: "/r", scopes: ["a"], output: R, handler: () => ({ id: "1" }) });
  assert.throws(() => collectApp([{ ok, usesR }], {}), /uses record "r", which is not exported/);
});

const adapters = memoryAdapters();
const thixo = createThixo(
  app,
  defineConfig({
    identity: {
      identify: async (request) => {
        const s = await sessionModule.readSession(request);
        return s && { id: s.userId, scopes: s.scopes, groups: s.groups };
      },
      scopesOf: sessionModule.scopesOf,
    },
    adapters,
    layout: { main: "todo-list" },
  }),
);

test("the example's stand-in login: ana, ben and cy, from the thixo-user cookie", async () => {
  assert.equal((await call(thixo, "POST", "/_thixo/token")).status, 401);
  assert.equal((await call(thixo, "POST", "/_thixo/token")).status, 401);
  for (const [who, expected] of [["ana", ["thixo.plugins.author"]], ["cy", ["thixo.data.read"]], ["ben", ["thixo.data.admin", "todos.delete", "thixo.plugins.promote"]]] as const) {
    const token = await tokenFor(thixo, `thixo-user=${who}`);
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    assert.equal(claims.sub, who);
    for (const scope of expected) assert.ok(claims.scopes.includes(scope), `${who} holds ${scope}`);
  }
  const ana = JSON.parse(atob((await tokenFor(thixo, "thixo-user=ana")).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  assert.ok(!ana.scopes.includes("todos.delete") && !ana.scopes.includes("thixo.data.admin"));
  assert.deepEqual(sessionModule.scopesOf("cy"), ["todos.read", "thixo.data.read"]);
});

test("the example's API enforces its scopes", async () => {
  const cy = await tokenFor(thixo, "thixo-user=cy");
  const ana = await tokenFor(thixo, "thixo-user=ana");
  const ben = await tokenFor(thixo, "thixo-user=ben");

  const list = await call(thixo, "GET", "/api/todos", { token: cy });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 3);

  const assignees = await call(thixo, "GET", "/api/assignees", { token: cy });
  assert.equal(assignees.status, 403);
  assert.deepEqual(assignees.body.error.missingScopes, ["people.read"]);
  assert.equal((await call(thixo, "GET", "/api/assignees", { token: ana })).body[0].name, "Ana");

  const created = await call(thixo, "POST", "/api/todos", { token: cy, body: { title: "x" } });
  assert.deepEqual(created.body.error.missingScopes, ["todos.write"]);
  const made = await call(thixo, "POST", "/api/todos", { token: ana, body: { title: "from ana" } });
  assert.equal(made.body.title, "from ana");

  const patched = await call(thixo, "PATCH", `/api/todos/${made.body.id}`, { token: ana, body: { done: true } });
  assert.deepEqual(patched.body, { id: made.body.id, title: "from ana", done: true });

  assert.deepEqual((await call(thixo, "DELETE", `/api/todos/${made.body.id}`, { token: ana })).body.error.missingScopes, ["todos.delete"]);
  assert.equal((await call(thixo, "DELETE", `/api/todos/${made.body.id}`, { token: ben })).status, 204);
  assert.equal((await call(thixo, "GET", `/api/todos/${made.body.id}`, { token: ben })).status, 404);
});
