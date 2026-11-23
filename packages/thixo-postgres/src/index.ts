import pg from "pg";
import type { SqlDriver, SqlParam, SqlRow, SqlStatement } from "thixo-sql";

export interface PostgresDriver extends SqlDriver {
  /** Ends the pool. */
  close(): Promise<void>;
}

/** Rewrites `?` placeholders to `$1`, `$2`, leaving a `?` inside a quoted string or identifier alone. */
export function toPostgres(sql: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (const char of sql) {
    if (quote) {
      if (char === quote) quote = null;
      out += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      out += char;
    } else if (char === "?") {
      out += `$${++n}`;
    } else {
      out += char;
    }
  }
  return out;
}

/** A `SqlDriver` on a Postgres database. Pass a connection string, `pg` pool options, or a `pg.Pool` you own (then
 * `close()` ends it too). A batch takes one connection from the pool for its `BEGIN` ... `COMMIT`. */
export function postgresDriver(options: string | pg.PoolConfig | pg.Pool): PostgresDriver {
  const pool =
    options instanceof pg.Pool ? options : new pg.Pool(typeof options === "string" ? { connectionString: options } : options);

  async function query(db: pg.Pool | pg.PoolClient, sql: string, params: SqlParam[]): Promise<SqlRow[]> {
    const result = await db.query(toPostgres(sql), params);
    return result.rows as SqlRow[];
  }

  return {
    async run(sql, params = []) {
      await query(pool, sql, params);
    },
    async all<T extends SqlRow>(sql: string, params: SqlParam[] = []) {
      return (await query(pool, sql, params)) as T[];
    },
    async batch(statements: SqlStatement[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const results: SqlRow[][] = [];
        for (const statement of statements) results.push(await query(client, statement.sql, statement.params ?? []));
        await client.query("COMMIT");
        return results;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
