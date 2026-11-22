import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryDriver } from "./helpers.js";

test("a transaction commits together or rolls back, and rethrows", async () => {
  const driver = memoryDriver();
  await driver.run("CREATE TABLE t (n INTEGER)");
  await driver.transaction(async (tx) => {
    await tx.run("INSERT INTO t VALUES (?)", [1]);
    await tx.run("INSERT INTO t VALUES (?)", [2]);
  });
  await assert.rejects(
    driver.transaction(async (tx) => {
      await tx.run("INSERT INTO t VALUES (?)", [3]);
      throw new Error("nope");
    }),
    /nope/,
  );
  assert.deepEqual((await driver.all("SELECT n FROM t ORDER BY n")).map((r) => r.n), [1, 2]);
});

test("statements from outside never land inside an open transaction", async () => {
  const driver = memoryDriver();
  await driver.run("CREATE TABLE t (n INTEGER)");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tx = driver.transaction(async (tx) => {
    await tx.run("INSERT INTO t VALUES (1)");
    await gate;
    throw new Error("rollback");
  });
  const outside = driver.run("INSERT INTO t VALUES (2)");
  release();
  await assert.rejects(tx, /rollback/);
  await outside;
  assert.deepEqual((await driver.all("SELECT n FROM t")).map((r) => r.n), [2]);
});

test("concurrent transactions take turns", async () => {
  const driver = memoryDriver();
  await driver.run("CREATE TABLE t (n INTEGER)");
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      driver.transaction(async (tx) => {
        await tx.run("INSERT INTO t VALUES (?)", [i]);
        await new Promise((r) => setTimeout(r, 1));
      }),
    ),
  );
  assert.equal((await driver.all("SELECT n FROM t")).length, 20);
});
