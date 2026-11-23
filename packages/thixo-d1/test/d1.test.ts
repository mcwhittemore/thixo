import { after } from "node:test";
import { Miniflare } from "miniflare";
import { adapterSuite } from "thixo-sql/testing";
import { d1Driver } from "../src/index.js";
import type { D1DatabaseLike } from "../src/index.js";

// One local D1 (Miniflare's, which is SQLite behind D1's API) for the whole file. Each test wipes it first.
let mf: Miniflare | undefined;
const started = () =>
  (mf ??= new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: { DB: "thixo-test" } }));
after(async () => {
  await mf?.dispose();
});

adapterSuite("Cloudflare D1 (Miniflare)", async () => {
  const db = (await started().getD1Database("DB")) as unknown as D1DatabaseLike;
  const driver = d1Driver(db);
  const tables = await driver.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'");
  for (const table of tables) await driver.run(`DROP TABLE IF EXISTS "${table.name as string}"`);
  return {
    driver,
    breakField: async (field) => {
      await driver.run(
        `CREATE TRIGGER fail_on_field BEFORE INSERT ON thixo_data WHEN NEW.field = '${field}' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
      );
    },
  };
});
