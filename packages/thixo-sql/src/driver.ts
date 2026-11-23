export type SqlParam = string | number | null;
export type SqlRow = Record<string, unknown>;

/** What a statement can be run against. Placeholders are `?`. A driver for Postgres rewrites them to `$1`, `$2`.
 * Column names come back as written in the schema (lower case). */
export interface SqlExecutor {
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

export interface SqlDriver extends SqlExecutor {
  /** Runs the statements in order so that they commit together or not at all, and returns each one's rows (empty
   * for a statement that returns none). A failing statement rolls the whole batch back and its error is thrown.
   * A batch is a fixed list, not a callback, because D1 has no open transactions: it only runs a list. Statements
   * from outside never land inside a batch. */
  batch(statements: SqlStatement[]): Promise<SqlRow[][]>;
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
    batch: (statements) =>
      exclusive(async () => {
        db.run(begin, []);
        try {
          const results: SqlRow[][] = [];
          for (const statement of statements) results.push(db.all(statement.sql, statement.params ?? []));
          db.run("COMMIT", []);
          return results;
        } catch (error) {
          try {
            db.run("ROLLBACK", []);
          } catch {}
          throw error;
        }
      }),
  };
}
