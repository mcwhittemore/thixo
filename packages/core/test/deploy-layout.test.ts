import assert from "node:assert/strict";
import { test } from "node:test";
import { DeployError, readPluginId, withPluginId, withoutPluginId } from "../src/server/index.js";
import { call } from "./helpers/client.js";
import { manifest, pluginFiles, submitOk, world, type World } from "./helpers/registry-doubles.js";

const detail = manifest({ requiredEndpoints: ["listTodos"], annotations: { todo: [{ name: "dueOn", type: "date" }] } });
const row = manifest({ slot: "todo-row" });
const folders = (note = "") => ({
  "due-dates": pluginFiles({ id: "plg_due", name: "Due dates", manifest: detail, note }),
  faces: pluginFiles({ id: "plg_faces", name: "Faces", manifest: row }),
});
const layout = { "main/todo-detail": "due-dates", "main/todo-row": "faces" };

async function versionCount(w: World, id: string): Promise<number> {
  return (await w.adapters.data.listVersions(id)).length;
}

test("a deploy builds each folder, makes shared implementor plugins, and writes a release", async () => {
  const w = world();
  const release = await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  assert.deepEqual(release.plugins.sort(), ["plg_due", "plg_faces"]);
  assert.deepEqual(release.layout, { "main/todo-detail": { plugin: "plg_due", number: 1 }, "main/todo-row": { plugin: "plg_faces", number: 1 } });
  assert.equal(release.deployment, "sha-1");
  const plugin = await w.adapters.data.getPlugin("plg_due");
  assert.equal(plugin?.author, "implementor");
  assert.equal(plugin?.visibility, "shared");
  assert.equal((await w.adapters.data.latestRelease())?.id, release.id);

  const [ana, cy] = [w.users.ana, w.users.cy];
  const found = await w.thixo.services.registry.search({ user: ana, q: "dates" });
  assert.equal(found[0].isDefault, true);
  assert.equal((await w.thixo.services.registry.search({ user: cy, q: "dates" })).length, 0, "default plugins are scope-filtered like any other");
  const load = await w.thixo.services.registry.load({ user: ana, ref: { plugin: "plg_due", number: 1 } });
  assert.deepEqual(load.authorCan, ["listTodos"], "the implementor holds everything");
});

test("deploying the same input twice stores nothing new", async () => {
  const w = world();
  const first = await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  const objects = w.adapters.code.objects.size;
  const again = await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  assert.equal(again.id, first.id, "no second release");
  assert.equal(w.adapters.code.objects.size, objects);
  assert.equal(await versionCount(w, "plg_due"), 1);
  const next = await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-2" });
  assert.notEqual(next.id, first.id, "a new deployment is a new release");
  assert.equal(await versionCount(w, "plg_due"), 1, "but the same versions");
  assert.deepEqual(next.layout, first.layout);
});

test("a changed folder is a new version, and rolling back finds the old one by hash", async () => {
  const w = world();
  const one = await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  const two = await w.thixo.services.deploy({ plugins: folders("v2"), layout, deployment: "sha-2" });
  assert.equal(two.layout["main/todo-detail"].number, 2);
  assert.equal(two.layout["main/todo-row"].number, 1);
  const back = await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1-again" });
  assert.equal(back.layout["main/todo-detail"].number, 1);
  assert.notEqual(back.id, one.id);
  assert.equal(await versionCount(w, "plg_due"), 2, "nothing new was stored");
  assert.equal((await w.adapters.data.latestRelease())?.id, back.id);
});

test("a folder without an id, a build error, a wrong slot or a missing folder fails the deploy and stores nothing", async () => {
  const w = world();
  const attempt = async (plugins: Record<string, Record<string, string>>, lay: Record<string, string> = layout) => {
    try {
      await w.thixo.services.deploy({ plugins, layout: lay, deployment: "x" });
    } catch (error) {
      assert.ok(error instanceof DeployError);
      return error.message;
    }
    throw new Error("expected the deploy to fail");
  };
  assert.match(await attempt({ "due-dates": pluginFiles({ manifest: detail }) }, {}), /thixo new plugin/);
  assert.match(await attempt({ "due-dates": pluginFiles({ id: "p", note: "@error", manifest: detail }) }, {}), /fake error/);
  assert.match(await attempt(folders(), { "main/todo-detail": "faces" }), /fills the slot "todo-row"/);
  assert.match(await attempt(folders(), { "main/todo-detail": "ghost" }), /no plugins\/ghost/);
  assert.match(await attempt({ a: pluginFiles({ id: "same", manifest: detail }), b: pluginFiles({ id: "same", manifest: detail, note: "b" }) }, {}), /both name the plugin/);
  assert.deepEqual(await w.adapters.data.listPlugins(), []);
  assert.equal(w.adapters.code.objects.size, 0);
  assert.equal(await w.adapters.data.latestRelease(), null);
});

test("withPluginId and withoutPluginId change only the id, and undo each other", () => {
  const forms = [
    'export default definePlugin(todoDetail, {\n  name: "A, {b}",\n  description: "x",\n}, C);\n',
    'export default definePlugin(todoDetail, { name: "A", description: "x" }, C);\n',
    'export default definePlugin(\n  slotFor("a,b"),\n  {\n    // the name\n    name: "A",\n    description: `x, ${1}`,\n  },\n  function C() {},\n);\n',
    'export default definePlugin(s, {}, C);\n',
  ];
  for (const text of forms) {
    const files = { "plugin.thx": text, "data.thx": "export const x = 1;\n" };
    const withId = withPluginId(files, "plg_1");
    assert.equal(readPluginId(withId), "plg_1");
    assert.equal(withId["data.thx"], files["data.thx"]);
    assert.deepEqual(withoutPluginId(withId), files, text);
    assert.equal(readPluginId(files), null);
    assert.deepEqual(withoutPluginId(files), files);
    assert.equal(readPluginId(withPluginId(withId, "plg_2")), "plg_2", "replaces an id");
    assert.deepEqual(withoutPluginId(withPluginId(withId, "plg_2")), files);
  }
  const last = { "plugin.thx": 'definePlugin(s, { name: "A", id: "z" }, C)' };
  assert.deepEqual(withoutPluginId(last), { "plugin.thx": 'definePlugin(s, { name: "A" }, C)' });
  assert.throws(() => withPluginId({ "plugin.thx": "export default 1" }, "x"), /No definePlugin/);
});

test("promotion round trip: promoting version 4 and deploying finds version 4 (docs/06, step 4)", async () => {
  const w = world();
  const first = await submitOk(w, "ana", { name: "Due dates", description: "Dates", manifest: detail, note: "1" });
  const id = first.plugin.id;
  for (const note of ["2", "3", "4", "5"]) await submitOk(w, "ana", { name: "Due dates", description: "Dates", manifest: detail, note }, id);
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: id });
  assert.equal(await versionCount(w, id), 5);

  const denied = await w.thixo.services.registry.promote({ user: w.users.ana, plugin: id, version: 4 }).catch((e) => e);
  assert.equal(denied.status, 403, "ana lacks thixo.plugins.promote");
  const promoted = await w.thixo.services.registry.promote({ user: w.users.boss, plugin: id, version: 4 });
  assert.equal(promoted.version, 4);
  assert.equal(promoted.folder, "due-dates");
  const [change] = w.adapters.code.changes;
  assert.match(change.title, /version 4/);
  assert.deepEqual(Object.keys(change.files), ["plugins/due-dates/plugin.thx"]);

  const folder = { "plugin.thx": change.files["plugins/due-dates/plugin.thx"] };
  assert.equal(readPluginId(folder), id);
  const stored = await w.thixo.services.registry.getSource({ user: w.users.ana, ref: { plugin: id, number: 4 } });
  assert.deepEqual(withoutPluginId(folder), stored, "only the id was added");
  assert.equal(folder["plugin.thx"].replace(`id: "${id}", `, ""), stored["plugin.thx"]);

  const release = await w.thixo.services.deploy({ plugins: { "due-dates": folder }, layout: { "main/todo-detail": "due-dates" }, deployment: "merge-1" });
  assert.deepEqual(release.layout["main/todo-detail"], { plugin: id, number: 4 });
  assert.equal(await versionCount(w, id), 5, "no new version was made");
  const plugin = await w.adapters.data.getPlugin(id);
  assert.deepEqual([plugin?.author, plugin?.visibility], ["implementor", "shared"]);
  assert.equal((await w.thixo.services.registry.search({ user: w.users.ana, q: "due" }))[0].isDefault, true);

  const removed = await w.thixo.services.deploy({ plugins: {}, layout: {}, deployment: "merge-2" });
  assert.deepEqual(removed.plugins, []);
  assert.equal((await w.thixo.services.registry.search({ user: w.users.ana, q: "due" }))[0].isDefault, false);
  assert.equal(await versionCount(w, id), 5, "its versions stay (U2)");
});

test("promotion: the promotion adapter decides when one is configured, and a personal plugin must be shared first", async () => {
  const w = world();
  const v = await submitOk(w, "ana", { manifest: detail });
  const fail = (e: any) => e;
  assert.equal((await w.thixo.services.registry.promote({ user: w.users.boss, plugin: v.plugin.id }).catch(fail)).status, 404, "boss can't see it");
  await w.thixo.services.registry.share({ user: w.users.ana, plugin: v.plugin.id });
  const ok = await w.thixo.services.registry.promote({ user: w.users.boss, plugin: v.plugin.id });
  assert.equal(ok.version, 1, "the latest by default");
});

test("layouts: an unchanged slot follows the new default and a changed one stays (S9)", async () => {
  const w = world();
  const mine = await submitOk(w, "ben", { name: "Ben faces", manifest: row });
  const ben = w.users.ben;
  const L = w.thixo.services.registry.layout;
  assert.deepEqual(await L.get(ben), { defaults: {}, changes: {}, resolved: {} });

  await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  const faces1 = { plugin: "plg_faces", number: 1 };
  assert.deepEqual((await L.get(ben)).resolved, { "main/todo-detail": { plugin: "plg_due", number: 1 }, "main/todo-row": faces1 });

  const set = await L.set(ben, { slot: "main/todo-row", plugin: mine.plugin.id, number: 1 });
  assert.deepEqual(set.changes, { "main/todo-row": { plugin: mine.plugin.id, number: 1 } });

  await w.thixo.services.deploy({ plugins: { ...folders("v2"), faces: pluginFiles({ id: "plg_faces", name: "Faces", manifest: row, note: "v2" }) }, layout, deployment: "sha-2" });
  const after = await L.get(ben);
  assert.deepEqual(after.resolved["main/todo-detail"], { plugin: "plg_due", number: 2 }, "never changed: follows the new default");
  assert.deepEqual(after.resolved["main/todo-row"], { plugin: mine.plugin.id, number: 1 }, "changed: stays");
  assert.deepEqual(after.defaults["main/todo-row"], { plugin: "plg_faces", number: 2 });
  assert.deepEqual((await L.get(w.users.ana)).resolved["main/todo-row"], { plugin: "plg_faces", number: 2 }, "other users have their own changes");

  const reset = await L.reset(ben, "main/todo-row");
  assert.deepEqual(reset.resolved["main/todo-row"], { plugin: "plg_faces", number: 2 });
  assert.deepEqual(reset.changes, {});
});

test("layout set refuses a plugin the user can't see, can't use, or that fills another slot", async () => {
  const w = world();
  await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  const anas = await submitOk(w, "ana", { name: "Anas", manifest: detail });
  const L = w.thixo.services.registry.layout;
  const err = async (p: Promise<unknown>) => p.then(() => null, (e) => ({ status: e.status, code: e.code }));
  assert.deepEqual(await err(L.set(w.users.ben, { slot: "main/todo-detail", plugin: anas.plugin.id, number: 1 })), { status: 404, code: "plugin_not_found" });
  assert.deepEqual(await err(L.set(w.users.cy, { slot: "main/todo-detail", plugin: "plg_due", number: 1 })), { status: 403, code: "missing_scopes" });
  assert.deepEqual(await err(L.set(w.users.ana, { slot: "main/todo-row", plugin: "plg_due", number: 1 })), { status: 400, code: "wrong_slot" });
  assert.deepEqual(await err(L.set(w.users.ana, { slot: "main/todo-detail", plugin: "plg_due", number: 7 })), { status: 404, code: "version_not_found" });
  assert.equal(await err(L.set(w.users.ana, { slot: "main/todo-detail", plugin: anas.plugin.id, number: 1 })), null);
});

test("layout routes", async () => {
  const w = world();
  await w.thixo.services.deploy({ plugins: folders(), layout, deployment: "sha-1" });
  const mine = await submitOk(w, "ben", { name: "Ben faces", manifest: row });
  const token = await w.token("ben");
  assert.equal((await call(w.thixo, "GET", "/_thixo/layout")).status, 401);
  assert.equal((await call(w.thixo, "GET", "/_thixo/layout", { token })).body.resolved["main/todo-row"].plugin, "plg_faces");
  const put = await call(w.thixo, "PUT", `/_thixo/layout/${encodeURIComponent("main/todo-row")}`, { token, body: { plugin: mine.plugin.id, number: 1 } });
  assert.equal(put.status, 200);
  assert.equal(put.body.resolved["main/todo-row"].plugin, mine.plugin.id);
  assert.equal((await call(w.thixo, "PUT", `/_thixo/layout/${encodeURIComponent("main/todo-row")}`, { token, body: { plugin: mine.plugin.id } })).status, 400);
  const del = await call(w.thixo, "DELETE", `/_thixo/layout/${encodeURIComponent("main/todo-row")}`, { token });
  assert.equal(del.body.resolved["main/todo-row"].plugin, "plg_faces");
});
