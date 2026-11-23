import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { adapterSuite } from "thixo-sql/testing";
import { postgresDriver, toPostgres } from "../src/index.js";

test("toPostgres numbers the placeholders and leaves quoted question marks alone", () => {
  assert.equal(toPostgres("SELECT ? , ? FROM t WHERE a = 'x?y' AND b = ?"), "SELECT $1 , $2 FROM t WHERE a = 'x?y' AND b = $3");
  assert.equal(toPostgres(`SELECT "a?b", ?`), `SELECT "a?b", $1`);
});

// The tests need a Postgres. Use THIXO_TEST_POSTGRES_URL if it is set. Otherwise start a throwaway container, which
// needs Docker. With neither, the suite is skipped and says why.
const IMAGE = process.env.THIXO_TEST_POSTGRES_IMAGE ?? "postgres:17";
const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const external = process.env.THIXO_TEST_POSTGRES_URL;
const dockerUp = !external && docker("info").status === 0;

let container: string | undefined;
let admin: ReturnType<typeof postgresDriver> | undefined;
let baseUrl: string | undefined;

async function startServer(): Promise<string> {
  if (baseUrl) return baseUrl;
  if (external) return (baseUrl = external);
  const run = docker("run", "-d", "--rm", "-e", "POSTGRES_PASSWORD=thixo", "-p", "127.0.0.1::5432", IMAGE);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  container = run.stdout.trim();
  const mapped = docker("port", container, "5432/tcp").stdout.trim().split("\n")[0];
  const port = mapped.slice(mapped.lastIndexOf(":") + 1);
  const url = `postgres://postgres:thixo@127.0.0.1:${port}/postgres`;
  for (let attempt = 0; attempt < 120; attempt++) {
    const probe = postgresDriver(url);
    try {
      await probe.run("SELECT 1");
      await probe.close();
      return (baseUrl = url);
    } catch {
      await probe.close().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Postgres in Docker did not start in time");
}

after(async () => {
  await admin?.close();
  if (container) docker("rm", "-f", container);
});

let counter = 0;

adapterSuite(
  "Postgres",
  async () => {
    const url = await startServer();
    admin ??= postgresDriver(url);
    // Each test gets its own schema, so tests never see each other's tables.
    const schema = `t${process.pid}_${Date.now()}_${counter++}`;
    await admin.run(`CREATE SCHEMA ${schema}`);
    const driver = postgresDriver({ connectionString: url, options: `-c search_path=${schema}` });
    return {
      driver,
      breakField: async (field) => {
        await driver.run(
          `CREATE FUNCTION fail_on_field() RETURNS trigger AS $$ BEGIN
             IF NEW.field = '${field}' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
        );
        await driver.run(`CREATE TRIGGER fail_on_field BEFORE INSERT ON thixo_data FOR EACH ROW EXECUTE FUNCTION fail_on_field()`);
      },
      close: async () => {
        await driver.close();
        await admin?.run(`DROP SCHEMA ${schema} CASCADE`);
      },
    };
  },
  external || dockerUp ? {} : { skip: "no Postgres: Docker is not running or not installed, and THIXO_TEST_POSTGRES_URL is not set" },
);
