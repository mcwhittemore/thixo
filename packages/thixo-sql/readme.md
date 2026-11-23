# thixo-sql

The SQL data adapter. The provider packages use it for their SQL database: D1 on Cloudflare, Postgres on Vercel,
RDS or Aurora on AWS. `thixo-node` uses it on `node:sqlite`.

It implements the data adapter in [portability](../../docs/07-portability.md#data), and the whole of `DataAdapter`
in the [contract](../core/src/contract.ts): the registry, releases, layouts, remembered users and plugin data.

```ts
import { sqlDataAdapter } from "thixo-sql";

const data = sqlDataAdapter(driver);
await data.migrate();
```

## Exports

- `sqlDataAdapter(driver)`: the `DataAdapter`, on any `SqlDriver`.
- `syncDriver(db)`: a `SqlDriver` on a synchronous single-connection database, such as `node:sqlite`.
- `SCHEMA_VERSION`: the version of the tables this package creates (currently `1`).
- The types `SqlDriver`, `SqlExecutor`, `SqlParam`, `SqlRow` and `SyncDatabase`.

## The driver

The adapter talks to the database through `SqlDriver`, which a provider package writes in a few lines:

```ts
interface SqlDriver {
  run(sql: string, params?: SqlParam[]): Promise<void>;
  all(sql: string, params?: SqlParam[]): Promise<SqlRow[]>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
```

- Placeholders are `?`. A Postgres driver rewrites them to `$1`, `$2`. Parameters are strings, numbers and `null`.
- Rows come back with the column names as the schema spells them: lower case, snake case.
- `transaction` commits what `fn` ran through `tx` together or not at all. Statements from outside never land
  inside it.
- `syncDriver(db)` builds a driver on a synchronous single-connection database such as `node:sqlite` or
  better-sqlite3. A connection can be in one transaction, so it queues statements and transactions behind each
  other.

The SQL stays inside what SQLite, D1 and Postgres share: `TEXT` and `INTEGER` columns, composite primary keys,
`CREATE ... IF NOT EXISTS`, `INSERT ... ON CONFLICT DO UPDATE`, and no more than 90 bound parameters in a statement
(D1 allows 100), so a long `readMany` goes out in several queries.

## How it stores plugin data

All plugin data lives in one fixed table, `thixo_data`: one row per target, plugin (layer) and field. A plugin never
adds a table or a column.

| Column | What |
| --- | --- |
| `kind` | `store` or `annotation` |
| `scope` | The store's name, or the record's name |
| `bucket` | Who it belongs to. A store record: its owner (D2). An annotation: its group, as `g:<group>`, or empty for everyone (A11) |
| `id` | The record's id |
| `plugin` | The layer: the plugin that wrote the row (D10) |
| `field` | The field's name |
| `value` | The value as JSON |

The primary key is all six of `kind`, `scope`, `bucket`, `id`, `plugin` and `field`. Two forks that use the same
field name write different rows, so they don't collide. Two users' store records never share a row, and
`removeField` and `removeAnnotations` are single `DELETE`s.

- **Reading through a fork chain** is one query. It takes the rows for the target across every layer in the chain,
  and the adapter keeps the nearest layer's value for each field ([D10](../../docs/02-requirements.md#plugin-data)).
  `readMany` does the same for many targets in one query per 20 or so, and answers in the order asked.
- **A patch** writes rows in one layer, inside one transaction (D6). A field the patch sets to `undefined` is
  skipped, since JSON has no such value. `null` is a value.
- **Values** are JSON. A `Date` is written as `{"$date": "<iso>"}` and comes back as a `Date`. An invalid date is
  refused, and nothing in that patch is written.
- **Versions** are numbered in the insert itself, `MAX(number) + 1` for the plugin, inside a transaction. If two
  writers on different connections still collide on the key, the loser retries.
- **The latest release** is the one put last. Each release gets a sequence number when it is put.

The registry tables are `thixo_plugins`, `thixo_versions`, `thixo_releases`, `thixo_layouts` and `thixo_users`.
The authoring guard keeps `thixo_refusals` (one row per refusal) and `thixo_authoring_blocks` (one row per user,
kept when the block is lifted). `thixo_schema` holds the version of the schema.

## Migrations

The adapter owns its tables. `migrate()` creates them and is safe to run twice. When a Thixo release changes them,
the release ships the migration in this package, keyed on the version in `thixo_schema`, and the implementor runs
it on upgrade.

## What a row is keyed by

A store record is keyed by its owner, so a store is private to each user (D2) without the adapter having to filter.
An annotation is keyed by record, id and group (A11): the group is part of the key, so the same todo can carry a
different annotation for each team, and one for everyone. A group named `""` is not the same as no group.

## Still open

- How deep a fork chain can get before reads need flattening. A read is one query whatever the depth, but it sends
  one parameter per layer.
