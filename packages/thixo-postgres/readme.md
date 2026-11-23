# thixo-postgres

The Postgres driver for [`thixo-sql`](../thixo-sql/readme.md). Use it for the data of an app on Vercel, RDS, Aurora, or
any Postgres. It is built on `pg`.

```ts
import { sqlDataAdapter } from "thixo-sql";
import { postgresDriver } from "thixo-postgres";

const driver = postgresDriver(process.env.DATABASE_URL!);
const data = sqlDataAdapter(driver);
await data.migrate();
```

For a local app, give the driver to `local()` in `thixo-node`, which keeps code and the build local and the data in
Postgres:

```ts
adapters: local({ driver: postgresDriver(process.env.DATABASE_URL!) }),
```

## Exports

- `postgresDriver(options)`: a `SqlDriver`. `options` is a connection string, `pg` pool options, or a `pg.Pool`. The
  result has `close()`, which ends the pool.
- `toPostgres(sql)`: rewrites `?` to `$1`, `$2`, and leaves a `?` inside a quoted string alone.

## How it works

- Each statement goes through the pool. A `batch` takes one connection for `BEGIN`, its statements and `COMMIT`, and
  rolls back on an error.
- The tables are made in the connection's current schema (`search_path`). To keep an app in its own schema, set
  `options: "-c search_path=myapp"` in the pool options.
- Two writers that number the same plugin version at once collide on the primary key, and the loser retries, as it does
  on any database.

## Tests

`npm test -w thixo-postgres` runs the adapter's whole suite on a real Postgres. It starts `postgres:17` in a throwaway
Docker container, and removes it after. With `THIXO_TEST_POSTGRES_URL` set it uses that server instead (each test makes
and drops its own schema). With neither Docker nor the variable, the suite is skipped and says why.
`THIXO_TEST_POSTGRES_IMAGE` picks another image.
