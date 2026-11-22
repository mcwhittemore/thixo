import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { verifyOutput } from "../src/index.js";
import { readPlugin, todoEnv } from "./fixtures/env.js";
import { all, compileOrThrow, fakeApp, text } from "./helpers/host.js";

test("todo-list compiles to the manifest the example's readme gives", () => {
  const r = compileOrThrow(readPlugin("todo-list"));
  assert.equal(verifyOutput(r.code).ok, true);
  assert.deepEqual(r.meta, { name: "Todo list", description: "Every todo in one list. Add, tick off and delete." });
  assert.equal(r.manifest.slot, "main");
  assert.deepEqual(r.manifest.requiredEndpoints, ["createTodo", "listTodos", "updateTodo"]);
  assert.deepEqual(r.manifest.optionalEndpoints, ["deleteTodo", "listAssignees"]);
  assert.deepEqual(r.manifest.annotates, []);
  assert.deepEqual(r.manifest.data, { stores: {}, annotations: {} });
  assert.deepEqual(r.manifest.shellServices, []);
  assert.deepEqual(r.manifest.addresses, []);
  assert.deepEqual(r.manifest.libraries, []);
  const env = todoEnv();
  const scopes = (names: string[]) => [...new Set(names.flatMap((n) => env.endpoints[n].scopes))].sort();
  assert.deepEqual(scopes(r.manifest.requiredEndpoints), ["todos.read", "todos.write"]);
  assert.deepEqual(scopes(r.manifest.optionalEndpoints).filter((s) => !scopes(r.manifest.requiredEndpoints).includes(s)), ["people.read", "todos.delete"]);
});

test("due-dates compiles to the manifest the example's readme gives", () => {
  const r = compileOrThrow(readPlugin("due-dates"));
  assert.equal(verifyOutput(r.code).ok, true);
  assert.equal(r.manifest.slot, "todo-detail");
  assert.deepEqual(r.manifest.requiredEndpoints, ["getTodo"]);
  assert.deepEqual(r.manifest.optionalEndpoints, []);
  assert.deepEqual(r.manifest.annotates, ["todo"]);
  assert.deepEqual(r.manifest.data, {
    stores: { prefs: [{ name: "warnDaysBefore", type: "number" }] },
    annotations: { todo: [{ name: "dueOn", type: "date" }] },
  });
  const canonical = '{"annotations":{"todo":[{"name":"dueOn","type":"date"}]},"stores":{"prefs":[{"name":"warnDaysBefore","type":"number"}]}}';
  assert.equal(r.manifest.schemaHash, createHash("sha256").update(canonical).digest("hex"));
  const env = todoEnv();
  const required = new Set([...r.manifest.requiredEndpoints.flatMap((n) => env.endpoints[n].scopes), ...r.manifest.annotates.flatMap((rec) => Object.values(env.records).find((x) => x.name === rec)!.read)]);
  assert.deepEqual([...required], ["todos.read"]);
});

test("the todo list renders, loads, and calls the SDK", async () => {
  const { code } = compileOrThrow(readPlugin("todo-list"));
  const app = await fakeApp(code);
  const selected: unknown[] = [];
  const props = { context: {}, emit: { select: (p: unknown) => selected.push(p) } };

  let tree = app.render(props);
  assert.equal(all(tree).filter((e) => e.type === "TextInput").length, 1);
  assert.equal(all(tree).filter((e) => e.type === "button").length, 0);

  await app.flush();
  tree = app.render(props);
  assert.match(text(tree), /Buy milk/);
  assert.match(text(tree), /Walk dog/);
  assert.match(text(tree), /Ana/, "assignee shown to a user who can call listAssignees");
  const deletes = all(tree).filter((e) => e.type === "Button");
  assert.equal(deletes.length, 2);
  assert.equal(deletes[0].props.disabled, true, "Delete is grayed out without todos.delete (P4)");

  const rowButton = all(tree).find((e) => e.type === "button")!;
  assert.equal(typeof rowButton.props.onClick, "function");
  (rowButton.props.onClick as (e: unknown) => void)({ target: { value: "" }, preventDefault() {} });
  assert.deepEqual(selected, [{ todoId: "1" }]);
  assert.equal(Object.getPrototypeOf(selected[0]), Object.prototype, "the host gets plain data");

  const checkbox = all(tree).find((e) => e.type === "Checkbox")!;
  (checkbox.props.onChange as (v: boolean) => void)(true);
  await app.flush();
  assert.deepEqual(app.calls.find((c) => c.name === "updateTodo")?.input, { id: "1", done: true });
  assert.equal(app.todos[0].done, true);
  assert.equal(app.calls.filter((c) => c.name === "listTodos").length, 2, "refresh after the update");

  let input = all(app.render(props)).find((e) => e.type === "TextInput")!;
  (input.props.onChange as (v: string) => void)("Call mum");
  input = all(app.render(props)).find((e) => e.type === "TextInput")!;
  assert.equal(input.props.value, "Call mum");
  await (input.props.onSubmit as () => Promise<void>)();
  await app.flush();
  assert.deepEqual(app.calls.find((c) => c.name === "createTodo")?.input, { title: "Call mum" });
  tree = app.render(props);
  assert.equal(all(tree).find((e) => e.type === "TextInput")!.props.value, "");
  assert.match(text(tree), /Call mum/);
  assert.deepEqual(app.errors, []);
});

test("delete works for a user who can, and is refused by the host for one who can't", async () => {
  const { code } = compileOrThrow(readPlugin("todo-list"));
  const app = await fakeApp(code, { canCall: ["listTodos", "createTodo", "updateTodo", "deleteTodo"] });
  const props = { context: {}, emit: { select: () => {} } };
  app.render(props);
  await app.flush();
  let tree = app.render(props);
  assert.doesNotMatch(text(tree), /Ana/, "no assignees without people.read");
  const del = all(tree).find((e) => e.type === "Button")!;
  assert.equal(del.props.disabled, false);
  (del.props.onClick as () => void)();
  await app.flush();
  assert.deepEqual(app.calls.find((c) => c.name === "deleteTodo")?.input, { id: "1" });
  tree = app.render(props);
  assert.doesNotMatch(text(tree), /Buy milk/);
});

test("due dates reads and patches plugin data", async () => {
  const { code } = compileOrThrow(readPlugin("due-dates"));
  const tomorrow = new Date(Date.now() + 86_400_000);
  const app = await fakeApp(code, { annotations: { "1": { dueOn: tomorrow } } });
  const props = { context: { todoId: "1" }, emit: {} };
  app.render(props);
  await app.flush();
  const tree = app.render(props);
  assert.match(text(tree), /Buy milk/);
  assert.match(text(tree), /Due soon/);
  const dateInput = all(tree).find((e) => e.type === "DateInput")!;
  assert.ok(dateInput.props.value instanceof Date);
  assert.equal((dateInput.props.value as Date).getTime(), tomorrow.getTime());
  const number = all(tree).find((e) => e.type === "NumberInput")!;
  assert.equal(number.props.value, 2);
  (number.props.onChange as (v: number) => void)(0);
  assert.deepEqual(app.calls.find((c) => c.name === "patchStore")?.input, { warnDaysBefore: 0 });
  const after = app.render(props);
  assert.doesNotMatch(text(after), /Due soon/, "warn 0 days before: tomorrow is not close");
  const later = new Date(Date.now() + 10 * 86_400_000);
  (all(after).find((e) => e.type === "DateInput")!.props.onChange as (d: Date) => void)(later);
  assert.deepEqual(app.calls.find((c) => c.name === "patchAnnotation")?.input, { id: "1", patch: { dueOn: later } });
  assert.deepEqual(app.errors, []);
});
