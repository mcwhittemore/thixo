import { join, resolve } from "node:path";
import type { Adapters, DataAdapter } from "thixo/contract";
import { sqlDataAdapter } from "thixo-sql";
import type { SqlDriver } from "thixo-sql";
import { fileCodeAdapter } from "./file-code-adapter.js";
import type { AssetFetch } from "./guarded-fetch.js";
import { localBuild } from "./local-build.js";
import { sqliteDriver } from "./sqlite-driver.js";

export interface LocalOptions {
  /** The implementor's project. Default: `THIXO_PROJECT_DIR`, or the current directory. */
  projectDir?: string;
  /** Keeps data in this database instead of `<stateDir>/data.sqlite`, such as `postgresDriver(url)` from
   * `thixo-postgres`. Code, the build and the state folder stay local. `close()` closes the driver if it has a
   * `close`. */
  driver?: SqlDriver & { close?(): void | Promise<void> };
  /** Copy at build: what fetches an outside file a plugin loads. Default `guardedFetch()`. */
  fetchAsset?: AssetFetch;
}

export interface LocalAdapters extends Adapters {
  /** `<projectDir>/.thixo`, where `code/` lives, and `data.sqlite` unless a `driver` was given. */
  stateDir: string;
  close(): void | Promise<void>;
}

/** Adapters for a developer's machine, rooted at `<projectDir>/.thixo`. The data adapter migrates itself before
 * its first use, so nothing needs to call `migrate()` first (calling it is fine). */
export function local(options: LocalOptions = {}): LocalAdapters {
  const projectDir = resolve(options.projectDir ?? process.env.THIXO_PROJECT_DIR ?? process.cwd());
  const stateDir = join(projectDir, ".thixo");
  const driver = options.driver ?? sqliteDriver(join(stateDir, "data.sqlite"));
  const raw = sqlDataAdapter(driver);
  let ready: Promise<void> | undefined;
  const migrate = () => (ready ??= raw.migrate().catch((error) => ((ready = undefined), Promise.reject(error))));

  const data = new Proxy(raw, {
    get(target, property) {
      if (property === "migrate") return migrate;
      const member = Reflect.get(target, property) as unknown;
      if (typeof member !== "function") return member;
      return async (...args: unknown[]) => {
        await migrate();
        return (member as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as DataAdapter;

  return {
    code: fileCodeAdapter({ dir: join(stateDir, "code"), projectDir }),
    data,
    build: localBuild(undefined, { fetchAsset: options.fetchAsset }),
    stateDir,
    close: () => (driver as { close?(): void | Promise<void> }).close?.(),
  };
}
