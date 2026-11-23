import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fresh } from "./suite.js";

export function registerDriverTests(freshAdapter: Fresh): void {
  test("run and all bind text, numbers and null, and name columns in lower case", async () => {
    const { driver } = await freshAdapter();
    await driver.run("CREATE TABLE t (a TEXT, b INTEGER, c TEXT)");
    await driver.run("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", ["it's ? here", 7, null]);
    const rows = await driver.all("SELECT a, b, c FROM t WHERE a = ? AND b = ?", ["it's ? here", 7]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].a, "it's ? here");
    assert.equal(Number(rows[0].b), 7);
    assert.equal(rows[0].c, null);
  });

  test("a batch commits together, returns each statement's rows, and a failure rolls all of it back", async () => {
    const { driver } = await freshAdapter();
    await driver.run("CREATE TABLE t (n INTEGER PRIMARY KEY)");
    const results = await driver.batch([
      { sql: "INSERT INTO t VALUES (?)", params: [1] },
      { sql: "INSERT INTO t VALUES (?)", params: [2] },
      { sql: "SELECT n FROM t ORDER BY n" },
    ]);
    assert.equal(results.length, 3);
    assert.deepEqual(results[2].map((r) => Number(r.n)), [1, 2]);
    await assert.rejects(
      driver.batch([
        { sql: "INSERT INTO t VALUES (?)", params: [3] },
        { sql: "INSERT INTO t VALUES (?)", params: [1] },
      ]),
    );
    assert.deepEqual((await driver.all("SELECT n FROM t ORDER BY n")).map((r) => Number(r.n)), [1, 2]);
  });

  test("a batch of nothing is fine", async () => {
    const { driver } = await freshAdapter();
    assert.deepEqual(await driver.batch([]), []);
  });

  test("a failed batch does not poison the driver", async () => {
    const { driver } = await freshAdapter();
    await driver.run("CREATE TABLE t (n INTEGER PRIMARY KEY)");
    await assert.rejects(driver.batch([{ sql: "INSERT INTO nope VALUES (1)" }]));
    await driver.run("INSERT INTO t VALUES (1)");
    assert.equal((await driver.all("SELECT n FROM t")).length, 1);
  });

  test("concurrent batches all land and none interleave", async () => {
    const { driver } = await freshAdapter();
    await driver.run("CREATE TABLE t (batch INTEGER, n INTEGER)");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        driver.batch([
          { sql: "INSERT INTO t VALUES (?, ?)", params: [i, 1] },
          { sql: "INSERT INTO t VALUES (?, ?)", params: [i, 2] },
        ]),
      ),
    );
    const rows = await driver.all("SELECT batch, n FROM t");
    assert.equal(rows.length, 40);
    const per = new Map<number, number>();
    for (const row of rows) per.set(Number(row.batch), (per.get(Number(row.batch)) ?? 0) + 1);
    assert.ok([...per.values()].every((count) => count === 2));
  });
}
