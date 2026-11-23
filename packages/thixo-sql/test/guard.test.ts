import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sqlDataAdapter, syncDriver } from "../src/index.js";

// The round-trip and block tests run for every driver in thixo-sql/testing (guard-tests.ts). This one needs a file
// that outlives the connection, so it is SQLite's own.

const require = createRequire(import.meta.url);

function fileDriver(file: string) {
  const original = process.emitWarning;
  process.emitWarning = () => {};
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  process.emitWarning = original;
  const db = new DatabaseSync(file);
  const driver = syncDriver({
    run: (sql, params) => void db.prepare(sql).run(...params),
    all: (sql, params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
  });
  return { db, driver };
}

const refusal = {
  id: "ref_1",
  user: "ana",
  conversation: "c1",
  category: "credentials" as const,
  reason: "It asks for a password.",
  trigger: "make a login box",
  from: "user" as const,
  source: "agent" as const,
  at: "2026-11-22T10:00:00.000Z",
};

test("refusals and blocks survive closing and reopening the database, and migrating twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thixo-sql-guard-"));
  const file = join(dir, "data.sqlite");
  try {
    const first = fileDriver(file);
    const data = sqlDataAdapter(first.driver);
    await data.migrate();
    await data.addRefusal(refusal);
    await data.putAuthoringBlock({ user: "ana", at: "2026-11-22T10:00:00.000Z", reason: "three", refusals: ["ref_1"] });
    first.db.close();

    const second = fileDriver(file);
    const again = sqlDataAdapter(second.driver);
    await again.migrate();
    assert.deepEqual((await again.listRefusals()).map((r) => r.id), ["ref_1"]);
    assert.deepEqual((await again.getAuthoringBlock("ana"))?.refusals, ["ref_1"]);
    second.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
