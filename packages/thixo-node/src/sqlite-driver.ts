import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { syncDriver } from "thixo-sql";
import type { SqlDriver, SqlParam } from "thixo-sql";

const require = createRequire(import.meta.url);

/** Loads `node:sqlite` without Node's experimental warning, which would print on every run of the dev server. Only
 * that one warning is dropped. */
function loadSqlite(): typeof import("node:sqlite") {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    if (/sqlite/i.test(text)) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return require("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}

export interface SqliteDriver extends SqlDriver {
  close(): void;
}

/** A `SqlDriver` on `node:sqlite`. `file` is a path (its folder is made) or `:memory:`. */
export function sqliteDriver(file: string): SqliteDriver {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  const driver = syncDriver({
    run: (sql, params: SqlParam[]) => void db.prepare(sql).run(...params),
    all: (sql, params: SqlParam[]) => db.prepare(sql).all(...params) as Record<string, unknown>[],
  });
  return Object.assign(driver, { close: () => db.close() });
}
