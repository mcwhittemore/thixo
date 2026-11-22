import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { local } from "../src/local.js";

test("local roots everything under <projectDir>/.thixo and migrates on first use", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "thixo-local-"));
  const adapters = local({ projectDir });
  assert.equal(adapters.stateDir, join(projectDir, ".thixo"));
  assert.equal(await adapters.data.getPlugin("none"), null);
  await adapters.data.patch({ kind: "store", store: "s", id: "1", owner: "ann" }, "p", { a: 1 });
  assert.deepEqual(await adapters.data.read({ kind: "store", store: "s", id: "1", owner: "ann" }, ["p"]), { a: 1 });
  await adapters.data.migrate();
  await adapters.code.put("k/1", new Uint8Array([1]));
  assert.deepEqual([...(await adapters.code.get("k/1"))!], [1]);
  assert.equal(typeof adapters.build.build, "function");
  assert.ok(existsSync(join(projectDir, ".thixo", "data.sqlite")));
  assert.ok(existsSync(join(projectDir, ".thixo", "code", "k", "1")));
  adapters.close();
});

test("projectDir defaults to THIXO_PROJECT_DIR, then the current directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "thixo-env-"));
  const before = process.env.THIXO_PROJECT_DIR;
  process.env.THIXO_PROJECT_DIR = dir;
  try {
    const adapters = local();
    assert.equal(adapters.stateDir, join(dir, ".thixo"));
    adapters.close();
    delete process.env.THIXO_PROJECT_DIR;
    const here = local({ projectDir: dir });
    here.close();
  } finally {
    if (before === undefined) delete process.env.THIXO_PROJECT_DIR;
    else process.env.THIXO_PROJECT_DIR = before;
  }
});
