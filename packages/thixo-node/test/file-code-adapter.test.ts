import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileCodeAdapter } from "../src/file-code-adapter.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "thixo-code-"));
  const dir = join(root, "state", "code");
  const projectDir = join(root, "project");
  mkdirSync(projectDir, { recursive: true });
  return { root, dir, projectDir, adapter: fileCodeAdapter({ dir, projectDir }) };
}

const bytes = (text: string) => new TextEncoder().encode(text);

test("put and get round-trip bytes under content-derived paths", async () => {
  const { adapter, dir } = setup();
  await adapter.put("source/ab/abcdef.json", bytes('{"a":1}'));
  await adapter.put("compiled/ab/abcdef.js", new Uint8Array([0, 255, 10]));
  assert.equal(new TextDecoder().decode((await adapter.get("source/ab/abcdef.json"))!), '{"a":1}');
  assert.deepEqual([...(await adapter.get("compiled/ab/abcdef.js"))!], [0, 255, 10]);
  assert.equal(readFileSync(join(dir, "source/ab/abcdef.json"), "utf8"), '{"a":1}');
});

test("get returns null for a missing key or a folder", async () => {
  const { adapter } = setup();
  assert.equal(await adapter.get("nope"), null);
  await adapter.put("a/b", bytes("x"));
  assert.equal(await adapter.get("a"), null);
  assert.equal(await adapter.get("a/b/c"), null);
});

test("put replaces bytes under a key and leaves no temp files", async () => {
  const { adapter, dir } = setup();
  await adapter.put("k", bytes("one"));
  await adapter.put("k", bytes("two"));
  assert.equal(new TextDecoder().decode((await adapter.get("k"))!), "two");
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(dir), ["k"]);
});

test("keys that escape the folder are refused", async () => {
  const { adapter, root } = setup();
  for (const key of ["../x", "a/../../x", "/etc/passwd", "", ".", "a/..", "x\0y", "..\\x".replace("\\", "/")]) {
    await assert.rejects(adapter.put(key, bytes("no")), undefined, `put ${JSON.stringify(key)}`);
    await assert.rejects(adapter.get(key), undefined, `get ${JSON.stringify(key)}`);
  }
  assert.equal(existsSync(join(root, "x")), false);
  assert.equal(existsSync(join(root, "state", "x")), false);
});

test("a link inside the folder can't lead out of it", async () => {
  const { adapter, dir, root } = setup();
  const outside = join(root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret"), "s");
  mkdirSync(dir, { recursive: true });
  symlinkSync(outside, join(dir, "link"));
  await assert.rejects(adapter.put("link/new", bytes("x")), /link/);
  await assert.rejects(adapter.get("link/secret"), /link/);
  assert.equal(existsSync(join(outside, "new")), false);
});

test("openChange writes files under the project, removes others, and says where", async () => {
  const { adapter, projectDir } = setup();
  writeFileSync(join(projectDir, "old.txt"), "old");
  mkdirSync(join(projectDir, "plugins", "gone"), { recursive: true });
  writeFileSync(join(projectDir, "plugins", "gone", "plugin.thx"), "x");
  const result = await adapter.openChange({
    title: "Promote todo-due",
    files: { "plugins/todo-due/plugin.thx": "export default 1;\n", "plugins/todo-due/data.thx": "d" },
    remove: ["old.txt", "plugins/gone", "never-existed"],
  });
  assert.equal(result.where, projectDir);
  assert.equal(readFileSync(join(projectDir, "plugins/todo-due/plugin.thx"), "utf8"), "export default 1;\n");
  assert.equal(existsSync(join(projectDir, "old.txt")), false);
  assert.equal(existsSync(join(projectDir, "plugins/gone")), false);
});

test("openChange refuses a path that escapes the project and writes nothing", async () => {
  const { adapter, projectDir, root } = setup();
  await assert.rejects(adapter.openChange({ title: "bad", files: { "ok.txt": "fine", "../evil.txt": "no" } }), /outside/);
  await assert.rejects(adapter.openChange({ title: "bad", files: { "/abs.txt": "no" } }), /absolute/);
  await assert.rejects(adapter.openChange({ title: "bad", files: { "ok.txt": "fine" }, remove: ["../project"] }), /outside/);
  await assert.rejects(adapter.openChange({ title: "bad", files: {}, remove: ["."] }), undefined);
  assert.equal(existsSync(join(projectDir, "ok.txt")), false);
  assert.equal(existsSync(join(root, "evil.txt")), false);
  assert.equal(existsSync(projectDir), true);
});
