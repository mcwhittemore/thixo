import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { sqlDataAdapter, syncDriver } from "../src/index.js";
import type { SqlDriver } from "../src/index.js";

const require = createRequire(import.meta.url);

export function memoryDriver(file = ":memory:"): SqlDriver & { db: DatabaseSync } {
  const original = process.emitWarning;
  process.emitWarning = () => {};
  const { DatabaseSync: Database } = require("node:sqlite") as typeof import("node:sqlite");
  process.emitWarning = original;
  const db = new Database(file);
  const driver = syncDriver({
    run: (sql, params) => void db.prepare(sql).run(...params),
    all: (sql, params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
  });
  return Object.assign(driver, { db });
}

export async function freshAdapter() {
  const driver = memoryDriver();
  const data = sqlDataAdapter(driver);
  await data.migrate();
  return { driver, data };
}

export const manifest = {
  slot: "main",
  requiredEndpoints: [],
  optionalEndpoints: [],
  annotates: [],
  data: { stores: {}, annotations: {} },
  schemaHash: "h",
  shellServices: [],
  addresses: [],
} as never;
