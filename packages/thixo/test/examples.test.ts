import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyOutput } from "../src/index.js";
import { readProgram } from "./fixtures/env.js";
import { all, compileOrThrow, fakeApp, text } from "./helpers/host.js";

test("orbit compiles, imports only thixo, and verifies", () => {
  const r = compileOrThrow(readProgram("orbit"), {});
  assert.equal(verifyOutput(r.code).ok, true);
  assert.deepEqual(r.imports, ["thixo"]);
  assert.deepEqual(r.links, []);
});

test("orbit moves with the frame clock and follows the pointer", async () => {
  const { code } = compileOrThrow(readProgram("orbit"), {});
  const app = await fakeApp(code);
  const at = () => all(app.render()).filter((e) => e.type === "circle").map((c) => [c.props.cx, c.props.cy] as [number, number]);

  let dots = at();
  assert.equal(dots.length, 5);
  assert.equal(app.frames.length, 1, "useFrame registered once");
  const [cx, cy] = dots[0];
  assert.ok(Math.abs(cx - 130) < 1e-9 && Math.abs(cy - 50) < 1e-9, `first dot starts right of the centre: ${cx},${cy}`);

  app.frames[0](Math.PI / 2, 0.016);
  dots = at();
  assert.ok(Math.abs(dots[0][0] - 100) < 1e-9 && Math.abs(dots[0][1] - 80) < 1e-9, "a quarter turn later it is below the centre");

  Object.assign(app.pointer, { x: 10, y: 10, inside: true, down: true });
  const tree = app.render();
  const circles = all(tree).filter((e) => e.type === "circle");
  assert.ok(Math.abs((circles[0].props.cy as number) - 40) < 1e-9, "orbits the pointer");
  assert.equal(circles[0].props.r, 6);
  assert.equal(app.frames.length, 1);
  assert.equal(app.styles.size, 1);
  assert.deepEqual(app.errors, []);
});

test("the todo list renders, loads, and calls the host's functions", async () => {
  const { code } = compileOrThrow(readProgram("todo-list"));
  const app = await fakeApp(code);
  const selected: unknown[] = [];
  const props = { onSelect: (id: unknown) => selected.push(id) };

  let tree = app.render(props);
  assert.equal(all(tree).filter((e) => e.type === "TextInput").length, 1);
  assert.equal(all(tree).filter((e) => e.type === "button").length, 0);

  await app.flush();
  tree = app.render(props);
  assert.match(text(tree), /Buy milk/);
  assert.match(text(tree), /Walk dog/);
  assert.match(text(tree), /Ana/);
  const deletes = all(tree).filter((e) => e.type === "Button");
  assert.equal(deletes.length, 2);
  assert.equal(deletes[0].props.disabled, true, "Delete is grayed out when the host says it can't be called");

  const rowButton = all(tree).find((e) => e.type === "button")!;
  (rowButton.props.onClick as (e: unknown) => void)({ target: { value: "" }, preventDefault() {} });
  assert.deepEqual(selected, ["1"]);

  const checkbox = all(tree).find((e) => e.type === "Checkbox")!;
  (checkbox.props.onChange as (v: boolean) => void)(true);
  await app.flush();
  assert.deepEqual(app.calls.find((c) => c.name === "updateTodo")?.input, { id: "1", done: true });
  assert.equal(Object.getPrototypeOf(app.calls.find((c) => c.name === "updateTodo")?.input), Object.prototype, "the host gets plain data");
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

test("delete works when the host allows it", async () => {
  const { code } = compileOrThrow(readProgram("todo-list"));
  const app = await fakeApp(code, { canCall: ["listTodos", "createTodo", "updateTodo", "deleteTodo"] });
  const props = { onSelect: () => {} };
  app.render(props);
  await app.flush();
  let tree = app.render(props);
  assert.doesNotMatch(text(tree), /Ana/);
  const del = all(tree).find((e) => e.type === "Button")!;
  assert.equal(del.props.disabled, false);
  (del.props.onClick as () => void)();
  await app.flush();
  assert.deepEqual(app.calls.find((c) => c.name === "deleteTodo")?.input, { id: "1" });
  tree = app.render(props);
  assert.doesNotMatch(text(tree), /Buy milk/);
});
