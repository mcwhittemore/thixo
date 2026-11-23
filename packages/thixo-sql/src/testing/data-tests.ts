import assert from "node:assert/strict";
import { test } from "node:test";
import type { DataTarget } from "thixo/contract";
import type { Fresh } from "./suite.js";

export function registerDataTests(freshAdapter: Fresh): void {

  const todo = (id: string, group: string | null = null): DataTarget => ({ kind: "annotation", record: "todo", id, group });
  const prefs = (owner: string, id = "p"): DataTarget => ({ kind: "store", store: "prefs", id, owner });

  test("reads through a fork chain, keeping the nearest layer's value per field (D10)", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "parent", { dueOn: "2026-01-01", note: "from parent" });
    await data.patch(todo("1"), "fork", { note: "from fork" });
    assert.deepEqual(await data.read(todo("1"), ["fork", "parent"]), { dueOn: "2026-01-01", note: "from fork" });
    assert.deepEqual(await data.read(todo("1"), ["parent"]), { dueOn: "2026-01-01", note: "from parent" });
    assert.deepEqual(await data.read(todo("1"), ["fork"]), { note: "from fork" });
    assert.deepEqual(await data.read(todo("1"), []), {});
  });

  test("chain order decides, not insertion order", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "fork", { v: 2 });
    await data.patch(todo("1"), "parent", { v: 1 });
    assert.deepEqual(await data.read(todo("1"), ["fork", "parent"]), { v: 2 });
    assert.deepEqual(await data.read(todo("1"), ["parent", "fork"]), { v: 1 });
  });

  test("two forks using the same field name do not collide", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "root", { priority: "root" });
    await data.patch(todo("1"), "forkA", { priority: "high" });
    await data.patch(todo("1"), "forkB", { priority: "low" });
    assert.equal((await data.read(todo("1"), ["forkA", "root"])).priority, "high");
    assert.equal((await data.read(todo("1"), ["forkB", "root"])).priority, "low");
    assert.equal((await data.read(todo("1"), ["root"])).priority, "root");
  });

  test("a patch writes only the fields it names", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "p", { a: 1, b: 2 });
    await data.patch(todo("1"), "p", { b: 3, c: 4 });
    assert.deepEqual(await data.read(todo("1"), ["p"]), { a: 1, b: 3, c: 4 });
  });

  test("values round-trip as JSON, dates included", async () => {
    const { data } = await freshAdapter();
    const when = new Date("2026-03-04T05:06:07.000Z");
    await data.patch(todo("1"), "p", {
      when,
      tags: ["a", "b"],
      nums: [1, 2.5],
      flag: false,
      nothing: null,
      text: "line\n\"quoted\"",
      zero: 0,
      empty: "",
    });
    const read = await data.read(todo("1"), ["p"]);
    assert.ok(read.when instanceof Date);
    assert.equal((read.when as Date).toISOString(), when.toISOString());
    assert.deepEqual(read.tags, ["a", "b"]);
    assert.deepEqual(read.nums, [1, 2.5]);
    assert.equal(read.flag, false);
    assert.equal(read.nothing, null);
    assert.equal(read.text, 'line\n"quoted"');
    assert.equal(read.zero, 0);
    assert.equal(read.empty, "");
  });

  test("an invalid date is refused and nothing is written", async () => {
    const { data } = await freshAdapter();
    await assert.rejects(data.patch(todo("1"), "p", { ok: 1, bad: new Date("nope") }), /invalid date/);
    assert.deepEqual(await data.read(todo("1"), ["p"]), {});
  });

  test("a patch is atomic: a failure part-way leaves no rows", async () => {
    const { data, breakField } = await freshAdapter();
    await data.patch(todo("1"), "p", { a: "old" });
    await breakField("b");
    await assert.rejects(data.patch(todo("1"), "p", { a: "new", b: "x", c: "y" }), /boom/);
    assert.deepEqual(await data.read(todo("1"), ["p"]), { a: "old" });
  });

  test("store records are private to their owner (D2)", async () => {
    const { data } = await freshAdapter();
    await data.patch(prefs("ann"), "p", { theme: "dark" });
    await data.patch(prefs("bob"), "p", { theme: "light" });
    assert.deepEqual(await data.read(prefs("ann"), ["p"]), { theme: "dark" });
    assert.deepEqual(await data.read(prefs("bob"), ["p"]), { theme: "light" });
    assert.deepEqual(await data.read(prefs("cy"), ["p"]), {});
    await data.patch(prefs("ann", "q"), "p", { theme: "x" });
    assert.deepEqual(await data.listStore("prefs", "ann", ["p"]), ["p", "q"]);
    assert.deepEqual(await data.listStore("prefs", "bob", ["p"]), ["p"]);
    assert.deepEqual(await data.listStore("prefs", "cy", ["p"]), []);
    assert.deepEqual(await data.listStore("other", "ann", ["p"]), []);
  });

  test("a store and an annotation with the same name and id stay apart", async () => {
    const { data } = await freshAdapter();
    await data.patch({ kind: "store", store: "x", id: "1", owner: "" }, "p", { v: "store" });
    await data.patch({ kind: "annotation", record: "x", id: "1", group: null }, "p", { v: "annotation" });
    assert.equal((await data.read({ kind: "store", store: "x", id: "1", owner: "" }, ["p"])).v, "store");
    assert.equal((await data.read({ kind: "annotation", record: "x", id: "1", group: null }, ["p"])).v, "annotation");
  });

  test("listStore sees records written in any layer of the chain", async () => {
    const { data } = await freshAdapter();
    await data.patch(prefs("ann", "a"), "parent", { v: 1 });
    await data.patch(prefs("ann", "b"), "fork", { v: 1 });
    assert.deepEqual(await data.listStore("prefs", "ann", ["fork", "parent"]), ["a", "b"]);
    assert.deepEqual(await data.listStore("prefs", "ann", ["fork"]), ["b"]);
  });

  test("removeStoreRecord deletes the owner's record in every layer of the chain, and nobody else's", async () => {
    const { data } = await freshAdapter();
    await data.patch(prefs("ann", "a"), "parent", { v: 1 });
    await data.patch(prefs("ann", "a"), "fork", { v: 2 });
    await data.patch(prefs("bob", "a"), "fork", { v: 3 });
    await data.removeStoreRecord("prefs", "a", "ann", ["fork", "parent"]);
    assert.deepEqual(await data.read(prefs("ann", "a"), ["fork", "parent"]), {});
    assert.deepEqual(await data.listStore("prefs", "ann", ["fork", "parent"]), []);
    assert.deepEqual(await data.read(prefs("bob", "a"), ["fork"]), { v: 3 });
  });

  test("annotations are keyed by record, id and group (A11)", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1", null), "p", { note: "everyone" });
    await data.patch(todo("1", "team-a"), "p", { note: "team a" });
    await data.patch(todo("1", "team-b"), "p", { note: "team b" });
    await data.patch(todo("1", ""), "p", { note: "empty group" });
    await data.patch(todo("2", "team-a"), "p", { note: "other id" });
    await data.patch({ kind: "annotation", record: "project", id: "1", group: "team-a" }, "p", { note: "other record" });
    assert.equal((await data.read(todo("1", null), ["p"])).note, "everyone");
    assert.equal((await data.read(todo("1", "team-a"), ["p"])).note, "team a");
    assert.equal((await data.read(todo("1", "team-b"), ["p"])).note, "team b");
    assert.equal((await data.read(todo("1", ""), ["p"])).note, "empty group");
    assert.equal((await data.read(todo("2", "team-a"), ["p"])).note, "other id");
    assert.deepEqual(await data.read(todo("1", "team-c"), ["p"]), {});
  });

  test("readMany answers in order, repeats included, and reads many at once", async () => {
    const { data } = await freshAdapter();
    for (let i = 0; i < 300; i++) await data.patch(todo(String(i)), "p", { n: i });
    await data.patch(todo("5"), "fork", { n: "fork" });
    const ids = Array.from({ length: 300 }, (_, i) => String(i));
    const results = await data.readMany([...ids.map((id) => todo(id)), todo("missing"), todo("5")], ["fork", "p"]);
    assert.equal(results.length, 302);
    assert.equal(results[0].n, 0);
    assert.equal(results[5].n, "fork");
    assert.equal(results[299].n, 299);
    assert.deepEqual(results[300], {});
    assert.equal(results[301].n, "fork");
    assert.deepEqual(await data.readMany([], ["p"]), []);
  });

  test("removeField deletes one field from one plugin's layer only (D7)", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "p", { dueOn: "x", keep: "y" });
    await data.patch(todo("2", "team"), "p", { dueOn: "z" });
    await data.patch(todo("1"), "fork", { dueOn: "fork" });
    await data.patch(prefs("ann"), "p", { dueOn: "store" });
    await data.removeField("p", { record: "todo" }, "dueOn");
    assert.deepEqual(await data.read(todo("1"), ["p"]), { keep: "y" });
    assert.deepEqual(await data.read(todo("2", "team"), ["p"]), {});
    assert.deepEqual(await data.read(todo("1"), ["fork", "p"]), { dueOn: "fork", keep: "y" });
    assert.deepEqual(await data.read(prefs("ann"), ["p"]), { dueOn: "store" });
    await data.removeField("p", { store: "prefs" }, "dueOn");
    assert.deepEqual(await data.read(prefs("ann"), ["p"]), {});
  });

  test("removeAnnotations deletes a record's annotations in every plugin and group (A13)", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "p", { a: 1 });
    await data.patch(todo("1", "team"), "q", { a: 2 });
    await data.patch(todo("2"), "p", { a: 3 });
    await data.patch(prefs("ann", "1"), "p", { a: 4 });
    await data.removeAnnotations("todo", "1");
    assert.deepEqual(await data.read(todo("1"), ["p", "q"]), {});
    assert.deepEqual(await data.read(todo("1", "team"), ["p", "q"]), {});
    assert.deepEqual(await data.read(todo("2"), ["p"]), { a: 3 });
    assert.deepEqual(await data.read(prefs("ann", "1"), ["p"]), { a: 4 });
  });

  test("migrate is safe to run twice and keeps data", async () => {
    const { data } = await freshAdapter();
    await data.patch(todo("1"), "p", { a: 1 });
    await data.migrate();
    await data.migrate();
    assert.deepEqual(await data.read(todo("1"), ["p"]), { a: 1 });
  });

  test("fields and ids with odd characters are safe", async () => {
    const { data } = await freshAdapter();
    const target = todo("it's; DROP TABLE thixo_data;--");
    await data.patch(target, "p'q", { "we'ird \"field\"": "va'lue" });
    assert.deepEqual(await data.read(target, ["p'q"]), { "we'ird \"field\"": "va'lue" });
  });
}
