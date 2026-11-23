import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sqlDataAdapter } from "thixo-sql";
import { adapterSuite } from "thixo-sql/testing";
import { sqliteDriver } from "../src/sqlite-driver.js";

const scratch = () => mkdtempSync(join(tmpdir(), "thixo-node-"));

test("sqliteDriver runs the data adapter and keeps data across reopening", async () => {
  const file = join(scratch(), "nested", "data.sqlite");
  const first = sqliteDriver(file);
  const data = sqlDataAdapter(first);
  await data.migrate();
  await data.patch({ kind: "store", store: "prefs", id: "p", owner: "ann" }, "plug", { theme: "dark", when: new Date("2026-01-02T00:00:00Z") });
  first.close();
  const second = sqliteDriver(file);
  const again = sqlDataAdapter(second);
  await again.migrate();
  const read = await again.read({ kind: "store", store: "prefs", id: "p", owner: "ann" }, ["plug"]);
  assert.equal(read.theme, "dark");
  assert.equal((read.when as Date).toISOString(), "2026-01-02T00:00:00.000Z");
  second.close();
});

test("concurrent addVersion calls on the real driver number cleanly", async () => {
  const driver = sqliteDriver(":memory:");
  const data = sqlDataAdapter(driver);
  await data.migrate();
  const base = { plugin: "a", source: "s", compiled: "c", manifest: {} as never, createdBy: "ann", createdAt: "2026-01-01T00:00:00Z" };
  const added = await Promise.all(Array.from({ length: 30 }, (_, i) => data.addVersion({ ...base, sourceHash: `h${i}` })));
  assert.deepEqual(added.map((v) => v.number).sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i + 1));
  driver.close();
});

test("loading the driver prints no experimental warning, and other warnings still print", () => {
  const script = `
    process.emitWarning("something else", "CustomWarning");
    const { sqliteDriver } = await import(${JSON.stringify(new URL("../src/sqlite-driver.ts", import.meta.url).href)});
    sqliteDriver(":memory:").close();
  `;
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: new URL("..", import.meta.url).pathname });
  assert.equal(out, "");
});

adapterSuite("sqliteDriver on node:sqlite", async () => {
  const driver = sqliteDriver(":memory:");
  return {
    driver,
    breakField: async (field) => {
      await driver.run(`CREATE TRIGGER fail_on_field BEFORE INSERT ON thixo_data WHEN NEW.field = '${field}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    },
    close: async () => driver.close(),
  };
});
