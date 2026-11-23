import assert from "node:assert/strict";
import { test } from "node:test";
import { record } from "../src/api/index.js";
import { SchemaError, t, type Infer } from "../src/schema/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(_?: T) => {};

test("primitives carry json and validate", () => {
  assert.deepEqual(t.string().json, { kind: "string" });
  assert.equal(t.string().parse("a"), "a");
  assert.throws(() => t.string().parse(1), SchemaError);
  assert.equal(t.number().parse(2.5), 2.5);
  assert.throws(() => t.number().parse("2"), /expected a number/);
  assert.throws(() => t.number().parse(NaN), SchemaError);
  assert.equal(t.boolean().parse(false), false);
  assert.throws(() => t.boolean().parse("true"), SchemaError);
});

test("dates are converted from ISO strings", () => {
  const d = t.date().parse("2026-11-22T10:00:00.000Z");
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), "2026-11-22T10:00:00.000Z");
  assert.ok(t.date().parse("2026-11-22") instanceof Date);
  assert.throws(() => t.date().parse("tomorrow"), SchemaError);
  assert.throws(() => t.date().parse(12), SchemaError);
  assert.throws(() => t.date().parse("2026-13-45"), SchemaError);
});

test("urls", () => {
  assert.equal(t.url().parse("https://example.com/x"), "https://example.com/x");
  assert.equal(t.url().parse("/todos/1"), "/todos/1");
  assert.throws(() => t.url().parse("not a url"), SchemaError);
});

test("array, object and optional", () => {
  const schema = t.object({ title: t.string(), tags: t.array(t.string()), due: t.optional(t.date()) });
  assert.deepEqual(schema.json, {
    kind: "object",
    fields: { title: { kind: "string" }, tags: { kind: "array", of: { kind: "string" } }, due: { kind: "optional", of: { kind: "date" } } },
  });
  const ok = schema.parse({ title: "x", tags: ["a"], extra: 1 });
  assert.deepEqual(ok, { title: "x", tags: ["a"] });
  const withDue = schema.parse({ title: "x", tags: [], due: "2026-01-01T00:00:00Z" });
  assert.ok(withDue.due instanceof Date);
  assert.equal(schema.parse({ title: "x", tags: [], due: null }).due, undefined);
});

test("errors list every problem with its path", () => {
  const schema = t.object({ title: t.string(), tags: t.array(t.number()) });
  try {
    schema.parse({ tags: [1, "b"] });
    assert.fail("should throw");
  } catch (error) {
    assert.ok(error instanceof SchemaError);
    assert.deepEqual(error.issues.map((i) => i.path).sort(), ["tags[1]", "title"]);
  }
});

test("a record is a schema", () => {
  const Todo = record("todo", { read: ["todos.read"], fields: { id: t.string(), done: t.boolean(), at: t.date() } });
  assert.deepEqual(Todo.json, { kind: "record", name: "todo" });
  const list = t.array(Todo);
  assert.deepEqual(list.json, { kind: "array", of: { kind: "record", name: "todo" } });
  const parsed = list.parse([{ id: "1", done: true, at: "2026-01-01" }]);
  assert.ok(parsed[0].at instanceof Date);
  assert.throws(() => list.parse([{ id: "1" }]), SchemaError);
  const nested = t.object({ todo: Todo });
  assert.equal(nested.parse({ todo: { id: "1", done: false, at: "2026-01-01" } }).todo.id, "1");
});

test("types are inferred", () => {
  const schema = t.object({ title: t.string(), n: t.optional(t.number()), when: t.date(), tags: t.array(t.string()) });
  type Got = Infer<typeof schema>;
  expectType<Equal<Got, { title: string; when: Date; tags: string[]; n?: number | undefined }>>();
  const Todo = record("todo", { read: [], fields: { id: t.string(), done: t.optional(t.boolean()) } });
  expectType<Equal<Infer<typeof Todo>, { id: string; done?: boolean | undefined }>>();
  expectType<Equal<Infer<ReturnType<typeof t.array<typeof Todo>>>, { id: string; done?: boolean | undefined }[]>>();
});
