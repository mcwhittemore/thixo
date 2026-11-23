import type { SqlDriver, SqlParam, SqlRow, SqlStatement } from "thixo-sql";

/** The part of a Cloudflare `D1PreparedStatement` this driver uses. */
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all(): Promise<{ results?: unknown[] }>;
}

/** The part of a Cloudflare `D1Database` this driver uses. The binding on a Worker, and the one Miniflare gives,
 * both fit, so this package needs no Cloudflare types. */
export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<{ results?: unknown[] }[]>;
}

/** A `SqlDriver` on a D1 database. D1 has no open transactions, so `batch` runs the list through D1's own
 * `batch`, which commits all of it or none. */
export function d1Driver(db: D1DatabaseLike): SqlDriver {
  const prepare = (sql: string, params: SqlParam[] = []) => db.prepare(sql).bind(...params);
  const rowsOf = (result: { results?: unknown[] }) => (result.results ?? []) as SqlRow[];

  return {
    async run(sql, params) {
      await prepare(sql, params).all();
    },
    async all<T extends SqlRow>(sql: string, params?: SqlParam[]) {
      return rowsOf(await prepare(sql, params).all()) as T[];
    },
    async batch(statements: SqlStatement[]) {
      if (statements.length === 0) return [];
      const results = await db.batch(statements.map((s) => prepare(s.sql, s.params)));
      return results.map(rowsOf);
    },
  };
}
