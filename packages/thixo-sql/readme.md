# thixo-sql

The SQL data adapter. There is no code yet. This is the design for it. The provider packages use it for their SQL
database: D1 on Cloudflare, Postgres on Vercel, RDS or Aurora on AWS.

It implements the data adapter in [portability](../../docs/07-portability.md#data).

## How it stores plugin data

All plugin data lives in a few fixed tables, one row per record, plugin in the chain and field. A plugin never adds a table
or a column.

- **Reading through a fork chain** is one query. It takes the rows for the record across every layer in the chain
  and keeps the nearest layer's value for each field ([D10](../../docs/02-requirements.md#plugin-data)).
- **A patch** writes rows in one layer, inside one transaction.

## Migrations

The adapter owns its tables. When a Thixo release changes them, the release ships the migration in this package,
and the implementor runs it on upgrade.

## Still open

- How deep a fork chain can get before reads need flattening.
- What a row is keyed by, with stores private to each user (D2) and annotations seen by a grouping (A11).
