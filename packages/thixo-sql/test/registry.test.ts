import assert from "node:assert/strict";
import { test } from "node:test";
import type { Plugin, PluginVersion } from "thixo/contract";
import { freshAdapter, manifest } from "./helpers.js";

const plugin = (id: string, extra: Partial<Plugin> = {}): Plugin => ({
  id,
  name: id,
  description: `the ${id} plugin`,
  author: "ann",
  visibility: "personal",
  readsParentData: true,
  ...extra,
});

const version = (pluginId: string, hash = "h"): Omit<PluginVersion, "number"> => ({
  plugin: pluginId,
  source: `src/${hash}`,
  sourceHash: hash,
  compiled: `out/${hash}`,
  manifest,
  createdBy: "ann",
  createdAt: "2026-01-01T00:00:00.000Z",
});

test("plugins round-trip, with forks, and putPlugin updates", async () => {
  const { data } = await freshAdapter();
  assert.equal(await data.getPlugin("nope"), null);
  await data.putPlugin(plugin("a"));
  await data.putPlugin(plugin("b", { forkedFrom: { plugin: "a", number: 2 }, readsParentData: false, visibility: "shared", author: "bob" }));
  assert.deepEqual(await data.getPlugin("a"), plugin("a"));
  assert.deepEqual((await data.getPlugin("b"))?.forkedFrom, { plugin: "a", number: 2 });
  assert.equal((await data.getPlugin("b"))?.readsParentData, false);
  await data.putPlugin(plugin("a", { name: "renamed", visibility: "shared" }));
  assert.equal((await data.getPlugin("a"))?.name, "renamed");
  assert.equal((await data.listPlugins()).length, 2);
  assert.deepEqual((await data.listPlugins({ visibility: "shared" })).map((p) => p.id), ["b", "a"]);
  assert.deepEqual((await data.listPlugins({ author: "bob" })).map((p) => p.id), ["b"]);
  assert.deepEqual((await data.listPlugins({ author: "bob", visibility: "personal" })), []);
});

test("versions count up from 1 per plugin and round-trip", async () => {
  const { data } = await freshAdapter();
  const v1 = await data.addVersion(version("a", "h1"));
  const v2 = await data.addVersion(version("a", "h2"));
  const other = await data.addVersion(version("b", "h1"));
  assert.equal(v1.number, 1);
  assert.equal(v2.number, 2);
  assert.equal(other.number, 1);
  assert.deepEqual(await data.getVersion({ plugin: "a", number: 2 }), v2);
  assert.equal(await data.getVersion({ plugin: "a", number: 3 }), null);
  assert.deepEqual((await data.listVersions("a")).map((v) => v.number), [1, 2]);
  assert.deepEqual(await data.listVersions("none"), []);
  assert.equal((await data.findVersionByHash("a", "h2"))?.number, 2);
  assert.equal(await data.findVersionByHash("a", "zzz"), null);
  assert.equal(v1.manifest.slot, "main");
});

test("concurrent addVersion calls get distinct, gapless numbers", async () => {
  const { data } = await freshAdapter();
  const added = await Promise.all(Array.from({ length: 25 }, (_, i) => data.addVersion(version("a", `h${i}`))));
  assert.deepEqual(added.map((v) => v.number).sort((x, y) => x - y), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal((await data.listVersions("a")).length, 25);
  for (const v of added) assert.equal((await data.getVersion({ plugin: "a", number: v.number }))?.sourceHash, v.sourceHash);
});

test("releases: the latest is the one put last", async () => {
  const { data } = await freshAdapter();
  assert.equal(await data.latestRelease(), null);
  const r1 = { id: "r1", deployment: "abc", plugins: ["a"], layout: { main: { plugin: "a", number: 1 } }, createdAt: "2026-01-01T00:00:00.000Z" };
  const r2 = { id: "r2", deployment: "def", plugins: ["a", "b"], layout: { main: { plugin: "b", number: 3 } }, createdAt: "2026-01-01T00:00:00.000Z" };
  await data.putRelease(r1);
  assert.deepEqual(await data.latestRelease(), r1);
  await data.putRelease(r2);
  assert.deepEqual(await data.latestRelease(), r2);
  await data.putRelease(r1);
  assert.deepEqual(await data.latestRelease(), r1);
});

test("layout changes are per user and per slot, and null resets a slot", async () => {
  const { data } = await freshAdapter();
  assert.deepEqual(await data.getLayoutChanges("ann"), {});
  await data.setLayoutSlot("ann", "main", { plugin: "a", number: 1 });
  await data.setLayoutSlot("ann", "main/row", { plugin: "b", number: 2 });
  await data.setLayoutSlot("bob", "main", { plugin: "c", number: 1 });
  assert.deepEqual(await data.getLayoutChanges("ann"), { main: { plugin: "a", number: 1 }, "main/row": { plugin: "b", number: 2 } });
  await data.setLayoutSlot("ann", "main", { plugin: "a", number: 4 });
  assert.deepEqual((await data.getLayoutChanges("ann")).main, { plugin: "a", number: 4 });
  await data.setLayoutSlot("ann", "main", null);
  assert.deepEqual(await data.getLayoutChanges("ann"), { "main/row": { plugin: "b", number: 2 } });
  assert.deepEqual(await data.getLayoutChanges("bob"), { main: { plugin: "c", number: 1 } });
  await data.setLayoutSlot("ann", "never-set", null);
});

test("remembered users come back, and the last write wins", async () => {
  const { data } = await freshAdapter();
  assert.equal(await data.recallUser("ann"), null);
  await data.rememberUser({ id: "ann", scopes: ["a", "b"], groups: ["team"] });
  assert.deepEqual(await data.recallUser("ann"), { id: "ann", scopes: ["a", "b"], groups: ["team"] });
  await data.rememberUser({ id: "ann", scopes: [] });
  assert.deepEqual(await data.recallUser("ann"), { id: "ann", scopes: [] });
});
