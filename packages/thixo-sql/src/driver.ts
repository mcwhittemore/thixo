export type SqlParam = string | number | null;
export type SqlRow = Record<string, unknown>;

/** What a statement can be run against: the driver itself, or the handle a transaction gives. Placeholders are `?`.
 * A driver for Postgres rewrites them to `$1`, `$2`. Column names come back as written in the schema (lower case). */
export interface SqlExecutor {
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

export interface SqlDriver extends SqlExecutor {
  /** Runs `fn` so that its statements commit together or not at all. Statements outside the transaction never
   * land inside it, and a thrown error rolls back and is rethrown. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** A synchronous, single-connection database, such as `node:sqlite` or better-sqlite3. */
export interface SyncDatabase {
  run(sql: string, params: SqlParam[]): void;
  all(sql: string, params: SqlParam[]): SqlRow[];
}

/** Builds a driver on a synchronous database. A connection can only be in one transaction, so statements and
 * transactions queue behind each other: concurrent callers take turns. */
export function syncDriver(db: SyncDatabase, options: { begin?: string } = {}): SqlDriver {
  const begin = options.begin ?? "BEGIN IMMEDIATE";
  let tail: Promise<unknown> = Promise.resolve();

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.catch(() => undefined);
    return result;
  }

  const direct: SqlExecutor = {
    async run(sql, params = []) {
      db.run(sql, params);
    },
    async all<T extends SqlRow>(sql: string, params: SqlParam[] = []) {
      return db.all(sql, params) as T[];
    },
  };

  return {
    run: (sql, params) => exclusive(() => direct.run(sql, params)),
    all: <T extends SqlRow>(sql: string, params?: SqlParam[]) => exclusive(() => direct.all<T>(sql, params)),
    transaction: (fn) =>
      exclusive(async () => {
        db.run(begin, []);
        try {
          const value = await fn(direct);
          db.run("COMMIT", []);
          return value;
        } catch (error) {
          try {
            db.run("ROLLBACK", []);
          } catch {}
          throw error;
        }
      }),
  };
}
