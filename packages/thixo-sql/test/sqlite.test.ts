import { createRequire } from "node:module";
import { syncDriver } from "../src/index.js";
import { adapterSuite } from "../src/testing/index.js";

const require = createRequire(import.meta.url);

adapterSuite("SQLite (node:sqlite)", async () => {
  const original = process.emitWarning;
  process.emitWarning = () => {};
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  process.emitWarning = original;
  const db = new DatabaseSync(":memory:");
  const driver = syncDriver({
    run: (sql, params) => void db.prepare(sql).run(...params),
    all: (sql, params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
  });
  return {
    driver,
    breakField: async (field) => {
      db.exec(`CREATE TRIGGER fail_on_field BEFORE INSERT ON thixo_data WHEN NEW.field = '${field}' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    },
    close: async () => db.close(),
  };
});
