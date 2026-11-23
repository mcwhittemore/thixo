# thixo-d1

The Cloudflare D1 driver for [`thixo-sql`](../thixo-sql/readme.md).

```ts
import { sqlDataAdapter } from "thixo-sql";
import { d1Driver } from "thixo-d1";

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const data = sqlDataAdapter(d1Driver(env.DB));
    await data.migrate();
    // ...
  },
};
```

## Exports

- `d1Driver(db)`: a `SqlDriver` on a D1 binding. `db` only needs `prepare(sql).bind(...).all()` and `batch(...)`, so a
  Worker's binding and Miniflare's both fit, and this package depends on no Cloudflare package.
- The types `D1DatabaseLike` and `D1StatementLike`.

## How it works

D1 has no `BEGIN` and no open transactions. Its `batch` runs a list of statements in one implicit transaction, which
commits all of it or none. So the driver's `batch` is D1's `batch`, and that is why `SqlDriver` has a list-shaped
`batch` and no callback transaction.

D1 allows 100 bound parameters in a statement. `thixo-sql` stays under 90.

`migrate()` is safe to run on every request but costs a round trip: run it at deploy, or once per isolate.

## Tests

`npm test -w thixo-d1` runs the adapter's whole suite on D1 through Miniflare, which runs D1's own code locally on
SQLite. It needs no Cloudflare account and no network. It does not prove D1's production limits (row and statement
size, latency), only its API and its batch semantics.
