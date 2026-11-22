import assert from "node:assert/strict";
import { test } from "node:test";
import { recordDeleted } from "../src/server/index.js";
import { call } from "./helpers/client.js";
import { manifest, submitOk, world, type World } from "./helpers/registry-doubles.js";

const full = manifest({
  requiredEndpoints: ["listTodos"],
  annotations: {
    todo: [
      { name: "dueOn", type: "date" },
      { name: "link", type: "url" },
      { name: "tags", type: "string[]" },
    ],
    note: [{ name: "pinned", type: "boolean" }],
  },
  stores: { prefs: [{ name: "warnDaysBefore", type: "number" }, { name: "name", type: "string" }], items: [{ name: "label", type: "string" }] },
});

async function setup(): Promise<{ w: World; plugin: string; scope: { plugin: string; version: number } }> {
  const w = world();
  w.users.dee = { id: "dee", scopes: ["thixo.data.read", "thixo.data.write"] };
  w.users.reader = { id: "reader", scopes: ["todos.read", "thixo.data.read"] };
  const v = await submitOk(w, "ana", { manifest: full });
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: v.plugin.id });
  return { w, plugin: v.plugin.id, scope: { plugin: v.plugin.id, version: 1 } };
}

async function refused(promise: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await promise;
  } catch (error: any) {
    return { status: error.status, code: error.code, message: error.message };
  }
  throw new Error("expected a refusal");
}

test("a store is one record per user, and dates and addresses go over the wire in their own forms", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const ana = w.users.ana;
  const patched = await d.patch(ana, { ...scope, store: "prefs", fields: { warnDaysBefore: 3, name: "Ana" } });
  assert.deepEqual(patched, { id: "singleton", fields: { warnDaysBefore: 3, name: "Ana" } });
  assert.deepEqual((await d.read(ana, { ...scope, store: "prefs" })).fields, { warnDaysBefore: 3, name: "Ana" });
  assert.deepEqual((await d.read(w.users.ben, { ...scope, store: "prefs" })).fields, {}, "D2: ben sees none of ana's");

  await d.patch(ana, { ...scope, record: "todo", id: "t1", fields: { dueOn: "2026-12-01", link: { $url: "https://example.com/a" }, tags: ["x", "y"] } });
  const stored = [...w.adapters.data.layers.values()].find((l) => l.has(scope.plugin) && l.get(scope.plugin)!.dueOn)!.get(scope.plugin)!;
  assert.ok(stored.dueOn instanceof Date, "dates are converted before they reach the adapter");
  assert.equal(stored.link, "https://example.com/a");
  const back = await d.read(ana, { ...scope, record: "todo", id: "t1" });
  assert.deepEqual(back.fields, { dueOn: "2026-12-01T00:00:00.000Z", link: { $url: "https://example.com/a" }, tags: ["x", "y"] });
});

test("D6: a field the version does not declare is refused, and so is the wrong type", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const ana = w.users.ana;
  const patch = (fields: Record<string, unknown>, record = "todo") => d.patch(ana, { ...scope, record, id: "t1", fields });

  const unknown = await refused(patch({ dueOn: "2026-12-01", priority: 1 }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.code, "invalid_fields");
  assert.match(unknown.message, /does not declare "priority"/);
  assert.deepEqual([...w.adapters.data.layers.keys()], [], "nothing is written when any field is refused");

  assert.match((await refused(patch({ dueOn: "tomorrow" }))).message, /ISO date/);
  assert.match((await refused(patch({ dueOn: 5 }))).message, /ISO date/);
  assert.match((await refused(patch({ tags: [1] }))).message, /list of strings/);
  assert.match((await refused(patch({ tags: "x" }))).message, /list of strings/);
  assert.match((await refused(patch({ pinned: "yes" }, "note"))).message, /true or false/);
  assert.match((await refused(patch({ dueOn: null }))).message, /can't be cleared/);
  assert.match((await refused(patch({}))).message, /at least one field/);
  assert.match((await refused(d.patch(ana, { ...scope, store: "prefs", fields: { warnDaysBefore: "3" } }))).message, /must be a number/);
  assert.match((await refused(d.patch(ana, { ...scope, store: "prefs", fields: { warnDaysBefore: Number.NaN } }))).message, /must be a number/);
  assert.equal((await refused(d.read(ana, { ...scope, store: "nope" }))).code, "undeclared_store");
  assert.equal((await refused(d.read(ana, { ...scope, record: "assignee", id: "1" }))).code, "undeclared_record");
});

test("a url field takes only what the broker marks as an address", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const link = (value: unknown) => d.patch(w.users.ana, { ...scope, record: "todo", id: "t1", fields: { link: value } });
  assert.match((await refused(link("https://example.com"))).message, /not a plain string/);
  assert.match((await refused(link({ url: "https://example.com" }))).message, /\$url/);
  assert.match((await refused(link({ $url: "https://example.com", extra: 1 }))).message, /\$url/);
  assert.match((await refused(link({ $url: "javascript:alert(1)" }))).message, /not an address/);
  assert.match((await refused(link({ $url: "//evil.test/x" }))).message, /not an address/);
  assert.match((await refused(link({ $url: "" }))).message, /not an address/);
  for (const ok of ["https://example.com/x", "mailto:a@b.co", "/todos/3", "data:image/png;base64,AAAA"]) {
    assert.deepEqual((await link({ $url: ok })).fields.link, { $url: ok });
  }
});

test("D5: a version that stopped declaring a field neither reads nor writes it, and the data stays", async () => {
  const { w, plugin, scope } = await setup();
  const d = w.thixo.services.registry.data;
  await d.patch(w.users.ana, { ...scope, record: "todo", id: "t1", fields: { dueOn: "2026-12-01", tags: ["a"] } });
  const slim = manifest({ requiredEndpoints: ["listTodos"], annotations: { todo: [{ name: "tags", type: "string[]" }] } });
  const v2 = await submitOk(w, "ana", { manifest: slim, note: "v2" }, plugin);
  const two = { plugin, version: v2.version };
  assert.deepEqual((await d.read(w.users.ana, { ...two, record: "todo", id: "t1" })).fields, { tags: ["a"] });
  assert.match((await refused(d.patch(w.users.ana, { ...two, record: "todo", id: "t1", fields: { dueOn: "2026-12-02" } }))).message, /does not declare "dueOn"/);
  assert.equal((await d.read(w.users.ana, { ...scope, record: "todo", id: "t1" })).fields.dueOn, "2026-12-01T00:00:00.000Z");
});

test("D11: reading and writing are separate scopes", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const reader = w.users.reader;
  await d.read(reader, { ...scope, store: "prefs" });
  const write = await refused(d.patch(reader, { ...scope, store: "prefs", fields: { name: "x" } }));
  assert.deepEqual([write.status, write.code], [403, "missing_scopes"]);
  const none = await refused(d.read(w.users.cy, { ...scope, store: "prefs" }));
  assert.equal(none.status, 403);
});

test("D12: an annotation needs the scopes that read its record", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const dee = w.users.dee;
  const denied = await refused(d.read(dee, { ...scope, record: "todo", id: "t1" }));
  assert.equal(denied.status, 403);
  assert.match(denied.message, /todos\.read/);
  await d.read(dee, { ...scope, store: "prefs" });
});

test("A13: Thixo asks the record whether it exists and may be read, and the record's grouping names the annotation's group", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const ana = w.users.ana;
  assert.equal((await refused(d.read(ana, { ...scope, record: "todo", id: "secret" }))).status, 404);
  assert.equal((await refused(d.patch(ana, { ...scope, record: "todo", id: "secret", fields: { tags: ["x"] } }))).status, 404);
  await d.patch(ana, { ...scope, record: "todo", id: "a-1", fields: { tags: ["team"] } });
  await d.patch(ana, { ...scope, record: "todo", id: "b-1", fields: { tags: ["all"] } });
  await d.patch(ana, { ...scope, record: "note", id: "n1", fields: { pinned: true } });
  const keys = [...w.adapters.data.layers.keys()].sort();
  assert.deepEqual(keys, ["annotation|note|n1|ana", "annotation|todo|a-1|team-a", "annotation|todo|b-1|"]);

  assert.deepEqual((await d.read(w.users.ben, { ...scope, record: "note", id: "n1" })).fields, {}, "grouping 'user': each user's own");
  assert.deepEqual((await d.read(ana, { ...scope, record: "note", id: "n1" })).fields, { pinned: true });
  const many = await d.readMany(ana, { ...scope, record: "todo", ids: ["a-1", "secret", "b-1"] });
  assert.deepEqual(many.map((r) => r.id), ["a-1", "b-1"], "a record the user can't read is left out");
});

test("P3: the author's own scopes cap what a plugin may do with data", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const ben = w.users.ben;
  await d.patch(ben, { ...scope, record: "todo", id: "t1", fields: { tags: ["x"] } });

  w.users.ana.scopes = w.users.ana.scopes.filter((s) => s !== "thixo.data.write");
  const noWrite = await refused(d.patch(ben, { ...scope, store: "prefs", fields: { name: "x" } }));
  assert.deepEqual([noWrite.status, noWrite.code], [403, "author_cap"]);
  await d.read(ben, { ...scope, store: "prefs" });

  w.users.ana.scopes = w.users.ana.scopes.filter((s) => s !== "todos.read");
  const noRecord = await refused(d.read(ben, { ...scope, record: "todo", id: "t1" }));
  assert.equal(noRecord.code, "author_cap");
  assert.match(noRecord.message, /todos\.read/);
  await d.read(ben, { ...scope, store: "prefs" });
});

test("a personal plugin's data is for its author only", async () => {
  const w = world();
  const v = await submitOk(w, "ana", { manifest: full });
  const err = await refused(w.thixo.services.registry.data.read(w.users.ben, { plugin: v.plugin.id, version: 1, store: "prefs" }));
  assert.equal(err.status, 404);
  assert.equal((await refused(w.thixo.services.registry.data.read(w.users.ana, { plugin: v.plugin.id, version: 9, store: "prefs" }))).code, "version_not_found");
});

test("D9, D10: a fork reads through to its parent, writes in its own layer, and an empty fork reads nothing", async () => {
  const { w, plugin, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const ben = w.users.ben;
  await d.patch(ben, { ...scope, store: "prefs", fields: { name: "parent", warnDaysBefore: 2 } });
  await d.patch(ben, { ...scope, record: "todo", id: "t1", fields: { tags: ["p"] } });

  const fork = await w.thixo.services.registry.fork({ user: ben, ref: { plugin, number: 1 } });
  const f = { plugin: fork.plugin.id, version: 1 };
  assert.deepEqual((await d.read(ben, { ...f, store: "prefs" })).fields, { warnDaysBefore: 2, name: "parent" }, "reads step up");
  assert.deepEqual((await d.read(ben, { ...f, record: "todo", id: "t1" })).fields, { tags: ["p"] });
  await d.patch(ben, { ...f, store: "prefs", fields: { name: "fork" } });
  assert.deepEqual((await d.read(ben, { ...f, store: "prefs" })).fields, { warnDaysBefore: 2, name: "fork" }, "the fork's layer shadows");
  assert.deepEqual((await d.read(ben, { ...scope, store: "prefs" })).fields, { warnDaysBefore: 2, name: "parent" }, "writes stay in the fork");

  const empty = await w.thixo.services.registry.fork({ user: ben, ref: { plugin, number: 1 }, empty: true });
  const e = { plugin: empty.plugin.id, version: 1 };
  assert.deepEqual((await d.read(ben, { ...e, store: "prefs" })).fields, {});
  assert.deepEqual((await d.read(ben, { ...e, record: "todo", id: "t1" })).fields, {});
});

test("D13: a user creates, lists and deletes their own store records", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  const ana = w.users.ana;
  const a = await d.patch(ana, { ...scope, store: "items", create: true, fields: { label: "one" } });
  const b = await d.patch(ana, { ...scope, store: "items", create: true, fields: { label: "two" } });
  assert.notEqual(a.id, b.id);
  await d.patch(w.users.ben, { ...scope, store: "items", create: true, fields: { label: "ben's" } });
  assert.deepEqual((await d.list(ana, { ...scope, store: "items" })).map((r) => r.fields.label).sort(), ["one", "two"]);
  await d.remove(ana, { ...scope, store: "items", id: a.id });
  assert.deepEqual((await d.list(ana, { ...scope, store: "items" })).map((r) => r.fields.label), ["two"]);
  assert.equal((await d.list(w.users.ben, { ...scope, store: "items" })).length, 1);
  assert.match((await refused(d.patch(ana, { ...scope, store: "items", id: "x", create: true, fields: { label: "y" } }))).message, /not both/);
  assert.match((await refused(d.patch(ana, { ...scope, record: "todo", create: true, fields: { tags: [] } }))).message, /can't be created/);
});

test("D7: deleting a field's data is its own act and needs thixo.data.admin", async () => {
  const { w, plugin, scope } = await setup();
  const d = w.thixo.services.registry.data;
  await d.patch(w.users.ana, { ...scope, store: "prefs", fields: { name: "keep", warnDaysBefore: 1 } });
  const refusal = await refused(d.removeField(w.users.ana, { plugin, store: "prefs", field: "name" }));
  assert.deepEqual([refusal.status, refusal.code], [403, "missing_scopes"]);
  assert.equal((await refused(d.removeField(w.users.boss, { plugin, store: "prefs", field: "nothing" }))).code, "unknown_field");
  await d.removeField(w.users.boss, { plugin, store: "prefs", field: "name" });
  assert.deepEqual((await d.read(w.users.ana, { ...scope, store: "prefs" })).fields, { warnDaysBefore: 1 });
});

test("A13: recordDeleted drops a record's annotations", async () => {
  const { w, scope } = await setup();
  const d = w.thixo.services.registry.data;
  await d.patch(w.users.ana, { ...scope, record: "todo", id: "t7", fields: { tags: ["x"] } });
  await d.patch(w.users.ana, { ...scope, record: "todo", id: "t8", fields: { tags: ["y"] } });
  await recordDeleted("todo", "t7");
  assert.deepEqual((await d.read(w.users.ana, { ...scope, record: "todo", id: "t7" })).fields, {});
  assert.deepEqual((await d.read(w.users.ana, { ...scope, record: "todo", id: "t8" })).fields, { tags: ["y"] });
  await recordDeleted("Todo", "t8");
  assert.deepEqual((await d.read(w.users.ana, { ...scope, record: "todo", id: "t8" })).fields, {}, "the export name works too");
});

test("the data routes carry the same rules", async () => {
  const { w, scope } = await setup();
  const token = await w.token("ana");
  const post = (path: string, body: unknown, t = token) => call(w.thixo, "POST", `/_thixo/data/${path}`, { token: t, body });
  assert.equal((await post("patch", { ...scope, store: "prefs", fields: { name: "hi" } })).body.fields.name, "hi");
  assert.deepEqual((await post("read", { ...scope, store: "prefs" })).body, { id: "singleton", fields: { name: "hi" } });
  const bad = await post("patch", { ...scope, store: "prefs", fields: { nope: 1 } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "invalid_fields");
  assert.equal(bad.body.error.issues[0].path, "nope");
  const created = await post("patch", { ...scope, store: "items", create: true, fields: { label: "a" } });
  assert.equal((await post("list", { ...scope, store: "items" })).body.records.length, 1);
  assert.equal((await post("remove", { ...scope, store: "items", id: created.body.id })).status, 204);
  assert.equal((await post("read-many", { ...scope, record: "todo", ids: ["t1"] })).body.records[0].id, "t1");
  assert.equal((await post("read", { ...scope })).status, 400);
  assert.equal((await post("read", { ...scope, store: "prefs", record: "todo" })).status, 400);
  assert.equal((await call(w.thixo, "POST", "/_thixo/data/read", { body: scope })).status, 401);
  const noAdmin = await post("remove-field", { plugin: scope.plugin, store: "prefs", field: "name" });
  assert.equal(noAdmin.body.error.code, "missing_scopes");
  assert.equal((await post("remove-field", { plugin: scope.plugin, store: "prefs", field: "name" }, await w.token("boss"))).status, 204);
});
