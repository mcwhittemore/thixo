import { describe, after } from "node:test";
import { sqlDataAdapter } from "../adapter.js";
import type { SqlDriver } from "../driver.js";
import type { DataAdapter } from "thixo/contract";
import { registerDataTests } from "./data-tests.js";
import { registerDriverTests } from "./driver-tests.js";
import { registerRegistryTests } from "./registry-tests.js";

/** A database for one test: empty, and not shared with any other test. */
export interface Opened {
  driver: SqlDriver;
  /** Makes every later insert into `thixo_data` of this field fail, so a test can fail a patch part-way. */
  breakField(field: string): Promise<void>;
  /** Releases the database. Optional. */
  close?(): Promise<void>;
}

export interface Fresh {
  (): Promise<{ driver: SqlDriver; data: DataAdapter; breakField(field: string): Promise<void> }>;
}

export interface SuiteOptions {
  /** A reason to skip the whole suite, such as "Docker is not installed". It prints with the skip. */
  skip?: string;
}

/** The adapter's tests, for any driver. A driver package calls this from its own test file with a function that
 * opens a fresh empty database. The same tests run against every driver, so a driver that passes them runs the
 * adapter. */
export function adapterSuite(name: string, open: () => Promise<Opened>, options: SuiteOptions = {}): void {
  const opened: Opened[] = [];
  const fresh: Fresh = async () => {
    const db = await open();
    opened.push(db);
    const data = sqlDataAdapter(db.driver);
    await data.migrate();
    return { driver: db.driver, data, breakField: db.breakField };
  };
  describe(options.skip ? `${name} (skipped: ${options.skip})` : name, { skip: options.skip ?? false }, () => {
    after(async () => {
      for (const db of opened) await db.close?.();
    });
    registerDriverTests(fresh);
    registerDataTests(fresh);
    registerRegistryTests(fresh);
  });
}
