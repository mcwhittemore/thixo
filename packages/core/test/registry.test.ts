import assert from "node:assert/strict";
import { test } from "node:test";
import { call } from "./helpers/client.js";
import { manifest, pluginFiles, submitOk, world } from "./helpers/registry-doubles.js";

const due = manifest({
  requiredEndpoints: ["listTodos"],
  annotations: { todo: [{ name: "dueOn", type: "date" }] },
  stores: { prefs: [{ name: "warnDaysBefore", type: "number" }] },
});

async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error: any) {
    return { status: error.status, code: error.code };
  }
  return { status: 0, code: "none" };
}

test("submit stores source and code under content keys and makes a personal plugin for the author", async () => {
  const w = world();
  const reply = await submitOk(w, "ana", { manifest: due });
  assert.equal(reply.version, 1);
  assert.equal(reply.plugin.author, "ana");
  assert.equal(reply.plugin.visibility, "personal");
  assert.equal(reply.plugin.readsParentData, true);
  assert.deepEqual(reply.diff.added.map((a) => `${a.scope}/${a.field.name}`), ["store:prefs/warnDaysBefore", "annotation:todo/dueOn"]);
  const keys = [...w.adapters.code.objects.keys()];
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => /^source\/[0-9a-f]{64}$/.test(k)));
  assert.ok(keys.some((k) => /^compiled\/[0-9a-f]{64}$/.test(k)));

  const files = await w.thixo.services.registry.getSource({ user: w.users.ana, ref: { plugin: reply.plugin.id, number: 1 } });
  assert.deepEqual(files, pluginFiles({ manifest: due }));
});

test("submit returns the compiler's errors and stores nothing", async () => {
  const w = world();
  const result = await w.thixo.services.registry.submit({ user: w.users.ana, files: pluginFiles({ note: "@error" }) });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.errors[0].code, "thx/test");
  assert.equal(w.adapters.code.objects.size, 0);
  assert.deepEqual(await w.adapters.data.listPlugins(), []);
});

test("a new version diffs against the previous one, and an unchanged source is not stored twice", async () => {
  const w = world();
  const v1 = await submitOk(w, "ana", { manifest: due });
  const next = manifest({ requiredEndpoints: ["listTodos"], annotations: { todo: [{ name: "remindAt", type: "date" }] } });
  const v2 = await submitOk(w, "ana", { manifest: next }, v1.plugin.id);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.diff.added.map((a) => a.field.name), ["remindAt"]);
  assert.deepEqual(v2.diff.noLongerShown.map((a) => `${a.scope}/${a.field.name}`), ["store:prefs/warnDaysBefore", "annotation:todo/dueOn"]);
  const again = await submitOk(w, "ana", { manifest: next }, v1.plugin.id);
  assert.equal(again.version, 2);
  assert.deepEqual(again.diff.added, []);
  assert.equal((await w.adapters.data.listVersions(v1.plugin.id)).length, 2);
});

test("only the author can add a version, and a stranger's personal plugin does not exist for them", async () => {
  const w = world();
  const v1 = await submitOk(w, "ana", { manifest: due });
  const refusal = await rejection(w.thixo.services.registry.submit({ user: w.users.ben, files: pluginFiles({ manifest: due }), plugin: v1.plugin.id }));
  assert.equal(refusal.status, 404);
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: v1.plugin.id });
  const second = await rejection(w.thixo.services.registry.submit({ user: w.users.ben, files: pluginFiles({ manifest: due, note: "x" }), plugin: v1.plugin.id }));
  assert.deepEqual(second, { status: 403, code: "not_author" });
});

test("D8: a version that changes a field's type is rejected, in the plugin's history and in its parent's", async () => {
  const w = world();
  const v1 = await submitOk(w, "ana", { manifest: due });
  const retyped = manifest({ requiredEndpoints: ["listTodos"], annotations: { todo: [{ name: "dueOn", type: "string" }] } });
  const result = await w.thixo.services.registry.submit({ user: w.users.ana, files: pluginFiles({ manifest: retyped }), plugin: v1.plugin.id });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.typeChanged, [{ scope: "annotation:todo", field: "dueOn", from: "date", to: "string" }]);
    assert.equal(result.errors[0].code, "registry/field-type-changed");
  }
  assert.equal((await w.adapters.data.listVersions(v1.plugin.id)).length, 1);

  const v2 = await submitOk(w, "ana", { manifest: manifest({ requiredEndpoints: ["listTodos"] }) }, v1.plugin.id);
  const back = await w.thixo.services.registry.submit({ user: w.users.ana, files: pluginFiles({ manifest: retyped, note: "again" }), plugin: v1.plugin.id });
  assert.equal(back.ok, false, "a field dropped by version 2 is still typed by version 1");
  assert.equal(v2.version, 2);

  await w.thixo.services.registry.share({ user: w.users.ana, plugin: v1.plugin.id });
  const fork = await w.thixo.services.registry.fork({ user: w.users.ben, ref: { plugin: v1.plugin.id, number: 1 } });
  const inFork = await w.thixo.services.registry.submit({ user: w.users.ben, files: pluginFiles({ manifest: retyped }), plugin: fork.plugin.id });
  assert.equal(inFork.ok, false, "the fork reads through to its parent's fields");
});

test("there is no HTTP route that takes plugin source (P6)", async () => {
  const w = world();
  const token = await w.token("ana");
  for (const path of ["/_thixo/registry/submit", "/_thixo/registry/plugins", "/_thixo/plugins"]) {
    const res = await call(w.thixo, "POST", path, { token, body: { files: pluginFiles() } });
    assert.equal(res.status, 404, path);
  }
  assert.equal(w.adapters.build.builds, 0);
});

test("search shows shared and default plugins and the user's own, and only those whose scopes the user holds (G1)", async () => {
  const w = world();
  const mine = await submitOk(w, "ana", { name: "Due dates", description: "Give a todo a due date", manifest: due });
  const shared = await submitOk(w, "ana", { name: "Priority flags", description: "Flag urgent todos", manifest: manifest({ requiredEndpoints: ["listTodos"] }) });
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: shared.plugin.id });
  const people = await submitOk(w, "ana", { name: "Assignee faces", description: "Show who a todo is for", manifest: manifest({ slot: "todo-row", requiredEndpoints: ["listAssignees"] }) });
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: people.plugin.id });
  const search = (user: string, q?: string, slot?: string) => w.thixo.services.registry.search({ user: w.users[user], q, slot });
  const names = async (user: string, q?: string, slot?: string) => (await search(user, q, slot)).map((s) => s.plugin.name).sort();

  assert.deepEqual(await names("ana"), ["Assignee faces", "Due dates", "Priority flags"]);
  assert.deepEqual(await names("ben"), ["Priority flags"], "ben has no people.read, and Due dates is ana's alone");
  assert.deepEqual(await names("cy"), ["Assignee faces"], "cy holds people.read only");
  assert.deepEqual(await names("ana", "flag urgent"), ["Priority flags"]);
  assert.deepEqual(await names("ana", "nothing like it"), []);
  assert.deepEqual(await names("ana", "", "todo-row"), ["Assignee faces"]);
  assert.deepEqual(await names("ana", "", "main/todo-detail"), ["Due dates", "Priority flags"]);
  assert.equal(mine.plugin.visibility, "personal");
});

test("required scopes are endpoints, annotated records, the slot's context fields and data (S13, D11, D12)", async () => {
  const w = world();
  const bare = await submitOk(w, "ana", { manifest: manifest({ slot: "todo-row" }) });
  const [summary] = await w.thixo.services.registry.search({ user: w.users.ana });
  assert.deepEqual(summary.requiredScopes, [], "a widget with no context scopes needs none");
  assert.equal(bare.version, 1);

  const full = await submitOk(w, "ana", { name: "Everything", manifest: manifest({ requiredEndpoints: ["createTodo"], optionalEndpoints: ["listAssignees"], annotations: { note: [{ name: "pinned", type: "boolean" }] } }) });
  const found = (await w.thixo.services.registry.search({ user: w.users.ana, q: "everything" }))[0];
  assert.deepEqual(found.requiredScopes, ["thixo.data.read", "thixo.data.write", "todos.read", "todos.write"]);
  assert.deepEqual(found.optionalScopes, ["people.read"]);
  assert.equal(full.plugin.name, "Everything");
});

test("the summary is plain sentences from the manifest and the scopes' descriptions (G5)", async () => {
  const w = world();
  const reply = await submitOk(w, "ana", {
    manifest: manifest({
      requiredEndpoints: ["listTodos", "createTodo"],
      optionalEndpoints: ["listAssignees"],
      annotations: { todo: [{ name: "dueOn", type: "date" }] },
      stores: { prefs: [{ name: "warn", type: "number" }] },
      shellServices: ["copyToClipboard"],
      addresses: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png", "https://example.org/x"],
    }),
  });
  assert.deepEqual(reply.summary, [
    "Reads todos",
    "Creates and changes todos",
    "Adds 1 field to todo: dueOn (date)",
    "Keeps a private store: prefs",
    "If you can, sees who a todo is assigned to",
    "Uses: clipboard",
    "Names outside addresses: cdn.example.com, example.org",
  ]);
});

test("fork: a new personal plugin that points at its parent version and reuses its stored code (G4, D9)", async () => {
  const w = world();
  const parent = await submitOk(w, "ana", { manifest: due });
  const before = w.adapters.code.objects.size;
  const refusal = await rejection(w.thixo.services.registry.fork({ user: w.users.ben, ref: { plugin: parent.plugin.id, number: 1 } }));
  assert.equal(refusal.status, 404, "ben can't see ana's personal plugin");
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: parent.plugin.id });
  const cy = await rejection(w.thixo.services.registry.fork({ user: w.users.cy, ref: { plugin: parent.plugin.id, number: 1 } }));
  assert.deepEqual(cy, { status: 403, code: "missing_scopes" });

  const fork = await w.thixo.services.registry.fork({ user: w.users.ben, ref: { plugin: parent.plugin.id, number: 1 } });
  assert.equal(fork.plugin.author, "ben");
  assert.equal(fork.plugin.visibility, "personal");
  assert.deepEqual(fork.plugin.forkedFrom, { plugin: parent.plugin.id, number: 1 });
  assert.equal(fork.plugin.readsParentData, true);
  assert.equal(fork.version, 1);
  assert.equal(w.adapters.code.objects.size, before, "no source or code is stored again");
  const [pv, fv] = [await w.adapters.data.getVersion({ plugin: parent.plugin.id, number: 1 }), await w.adapters.data.getVersion({ plugin: fork.plugin.id, number: 1 })];
  assert.equal(fv?.source, pv?.source);
  assert.equal(fv?.compiled, pv?.compiled);
  assert.equal(fv?.createdBy, "ben");
  assert.deepEqual(await w.thixo.services.registry.chainOf(fork.plugin.id), [fork.plugin.id, parent.plugin.id]);

  const empty = await w.thixo.services.registry.fork({ user: w.users.ben, ref: { plugin: parent.plugin.id, number: 1 }, empty: true });
  assert.equal(empty.plugin.readsParentData, false);
  assert.deepEqual(await w.thixo.services.registry.chainOf(empty.plugin.id), [empty.plugin.id]);
});

test("share: the author only, and only with thixo.plugins.share", async () => {
  const w = world();
  const v = await submitOk(w, "ben", { manifest: due });
  assert.deepEqual(await rejection(w.thixo.services.registry.share({ user: w.users.ben, plugin: v.plugin.id })), { status: 403, code: "missing_scopes" });
  const a = await submitOk(w, "ana", { manifest: due, note: "ana's" });
  assert.equal((await rejection(w.thixo.services.registry.share({ user: w.users.boss, plugin: a.plugin.id }))).status, 404);
  const shared = await w.thixo.services.registry.share({ user: w.users.ana, plugin: a.plugin.id });
  assert.equal(shared.visibility, "shared");
  assert.deepEqual(await rejection(w.thixo.services.registry.share({ user: w.users.ben, plugin: a.plugin.id })), { status: 403, code: "not_author" });
});

test("load: the author cap, user permissions, and who may load what (P3, P4)", async () => {
  const w = world();
  const v = await submitOk(w, "ana", { manifest: manifest({ requiredEndpoints: ["listTodos"], optionalEndpoints: ["createTodo", "listAssignees"] }) });
  const ref = { plugin: v.plugin.id, number: 1 };
  const own = await w.thixo.services.registry.load({ user: w.users.ana, ref });
  assert.deepEqual(own.authorCan, ["listTodos", "createTodo", "listAssignees"]);
  assert.deepEqual(own.userCan, own.authorCan);
  assert.deepEqual(own.authorData, { read: true, write: true });
  assert.equal(own.code, `/_thixo/plugins/${v.plugin.id}/1.js`);

  assert.equal((await rejection(w.thixo.services.registry.load({ user: w.users.ben, ref }))).status, 404, "a personal plugin loads for its author only");
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: v.plugin.id });
  const ben = await w.thixo.services.registry.load({ user: w.users.ben, ref });
  assert.deepEqual(ben.authorCan, ["listTodos", "createTodo", "listAssignees"]);
  assert.deepEqual(ben.userCan, ["listTodos"], "ben can call only what he holds");
  assert.deepEqual(await rejection(w.thixo.services.registry.load({ user: w.users.cy, ref })), { status: 403, code: "missing_scopes" });

  w.users.ana.scopes = ["todos.read", "thixo.plugins.share"];
  const capped = await w.thixo.services.registry.load({ user: w.users.ben, ref });
  assert.deepEqual(capped.authorCan, ["listTodos"], "ana's lost scopes cap what her plugin may do for ben");
  assert.deepEqual(capped.userCan, ["listTodos"]);
  assert.deepEqual(capped.authorData, { read: false, write: false });
});

test("the plugin route serves the stored module as text/javascript, uncached, and refuses code that fails the check", async () => {
  const w = world();
  const v = await submitOk(w, "ana", { manifest: due });
  const token = await w.token("ana");
  const path = `/_thixo/plugins/${v.plugin.id}/1.js`;
  const res = await w.thixo.fetch(new Request(`http://x${path}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /^text\/javascript/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /^export default function \(rt\)/);

  const anon = await w.thixo.fetch(new Request(`http://x${path}`));
  assert.equal(anon.status, 401);
  const other = await call(w.thixo, "GET", path, { token: await w.token("ben") });
  assert.equal(other.status, 404, "personal: its author only");

  const version = await w.adapters.data.getVersion({ plugin: v.plugin.id, number: 1 });
  const code = new TextDecoder().decode(w.adapters.code.objects.get(version!.compiled));
  w.adapters.build.brokenOutput.add(code);
  const refused = await call(w.thixo, "GET", path, { token });
  assert.equal(refused.status, 500);

  w.adapters.build.brokenOutput.clear();
  w.adapters.code.objects.set(version!.compiled, new TextEncoder().encode("export default function (rt) { window.steal() }"));
  const tampered = await call(w.thixo, "GET", path, { token });
  assert.equal(tampered.status, 500, "code that no longer matches its content key is never served");
});

test("load over HTTP", async () => {
  const w = world();
  const v = await submitOk(w, "ana", { manifest: due });
  const res = await call(w.thixo, "GET", `/_thixo/plugins/${v.plugin.id}/1/load`, { token: await w.token("ana") });
  assert.equal(res.status, 200);
  assert.equal(res.body.version, 1);
  assert.equal(res.body.plugin.id, v.plugin.id);
});

test("registry routes: search, get, fork, share, promote", async () => {
  const w = world();
  const v = await submitOk(w, "ana", { manifest: due });
  const ana = await w.token("ana");
  const ben = await w.token("ben");
  assert.equal((await call(w.thixo, "GET", "/_thixo/registry/search?q=due", { token: ana })).body.length, 1);
  assert.equal((await call(w.thixo, "GET", "/_thixo/registry/search?q=due", { token: ben })).body.length, 0);
  assert.equal((await call(w.thixo, "GET", "/_thixo/registry/search")).status, 401);
  const got = await call(w.thixo, "GET", `/_thixo/registry/plugins/${v.plugin.id}`, { token: ana });
  assert.equal(got.body.versions.length, 1);
  assert.deepEqual(got.body.summary.slice(0, 1), ["Reads todos"]);
  assert.equal((await call(w.thixo, "POST", `/_thixo/registry/plugins/${v.plugin.id}/fork`, { token: ben, body: { version: 1 } })).status, 404);
  assert.equal((await call(w.thixo, "POST", `/_thixo/registry/plugins/${v.plugin.id}/share`, { token: ana })).body.visibility, "shared");
  const fork = await call(w.thixo, "POST", `/_thixo/registry/plugins/${v.plugin.id}/fork`, { token: ben, body: { version: 1, empty: true } });
  assert.equal(fork.status, 201);
  assert.equal(fork.body.plugin.readsParentData, false);
  assert.equal((await call(w.thixo, "POST", `/_thixo/registry/plugins/${v.plugin.id}/fork`, { token: ben, body: {} })).status, 400);
  const denied = await call(w.thixo, "POST", `/_thixo/registry/plugins/${v.plugin.id}/promote`, { token: ben, body: {} });
  assert.equal(denied.status, 403);
  const promoted = await call(w.thixo, "POST", `/_thixo/registry/plugins/${v.plugin.id}/promote`, { token: await w.token("boss"), body: {} });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.folder, "due-dates");
});
