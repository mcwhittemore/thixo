# SQL drivers

Thixo's data adapter, `thixo-sql`, runs on a small driver interface, and there are now three drivers: `sqliteDriver` (in `thixo-node`), `postgresDriver` (`thixo-postgres`) and `d1Driver` (`thixo-d1`). One suite of tests, `thixo-sql/testing`, runs the adapter on each, and an app run by `thixo dev` can keep its data in Postgres with `local({ driver })`.

## Sub-features

- `adapter-suite` runs the same 29 or so tests (driver contract, plugin data, registry, releases, layouts, users) against any driver, from `thixo-sql/testing`.
- `postgres-driver` runs the suite on a real Postgres in a throwaway Docker container, and skips with a reason when there is no Docker.
- `d1-driver` runs the suite on D1 through Miniflare.
- `app-on-postgres` runs the todo example with its data in Postgres and reads a plugin's data back after a restart.

## How to get to it (user POV)

- An implementor gives `local({ driver: postgresDriver(url) })` in `thixo.config.ts`, or `sqlDataAdapter(d1Driver(env.DB))` in a Worker.
- Run `thixo dev` and use the app. The tables `thixo_*` appear in the database.

## Driving it with verify-thixo

Preconditions:

- `npm install` and `npm run build` have run in the repo root. Docker is running, and the image `postgres:17` is local or can be pulled.
- A scratch Postgres: `docker run -d --rm --name thixo-pg -e POSTGRES_PASSWORD=thixo -e POSTGRES_DB=todo -p 127.0.0.1:54555:5432 postgres:17`. Wait about five seconds.

- **The suites.** Run `npm test -w thixo-sql -w thixo-postgres -w thixo-d1 -w thixo-node`. Each package ends with `# fail 0`. Postgres reports `# skipped 0` with Docker up; `thixo-postgres` run without Docker prints `Postgres (skipped: no Postgres: Docker is not running ...)`. thixo-d1 and thixo-postgres each report 28 or 29 passing tests, the same names as thixo-sql's.
- **The todo app on Postgres.** Run `node .claude/skills/verify-thixo/bin/launch.mjs --run pg --postgres postgres://postgres:thixo@127.0.0.1:54555/todo`, then `node .claude/skills/verify-thixo/bin/doctor.mjs --run pg` (prints `healthy`), then `node .claude/skills/verify-thixo/bin/drive.mjs --run pg --as ana --script .claude/skills/verify-thixo/journeys/todo-basics.mjs --name todo-app`. It prints the same `ok` lines as `todo-app.md`, ending `ok the due date reads 2026-12-24 after reload`. The copy's `.thixo/` has `code/` and no `data.sqlite`.
- **The rows are in Postgres.** Run `docker exec thixo-pg psql -U postgres todo -c "select kind, scope, bucket, id, plugin, field, value from thixo_data"`. One row: `annotation | todo | g:design | todo-1 | plg_due_dates | dueOn | {"$date":"2026-12-24T00:00:00.000Z"}`. `\dt` lists `thixo_data`, `thixo_layouts`, `thixo_plugins`, `thixo_releases`, `thixo_schema`, `thixo_users` and `thixo_versions`.
- **Restart, data still there.** Run `node .claude/skills/verify-thixo/bin/launch.mjs --run pg --restart` (it stops the server and starts it again in the same copy), then `node .claude/skills/verify-thixo/bin/drive.mjs --run pg --as ana --script .claude/skills/verify-thixo/journeys/due-date-kept.mjs --name after-restart`. It prints `ok the due date reads 2026-12-24 after the restart`. `select count(*) from thixo_releases` is still 1: the restart did not deploy a second release, because the same default plugins hash to the same versions.
- **Proof.** Keep the suite output, `artifacts/verify/pg/todo-app/`, `artifacts/verify/pg/after-restart/`, the `psql` output and `dev.log`. Run `node .claude/skills/verify-thixo/bin/cleanup.mjs --run pg` and `docker rm -f thixo-pg`.

## Gotchas

- The todo example's todos are in memory (`api/db.ts`), so a restart brings back the three seeded todos and loses added ones. Only plugin data, the registry, releases and layouts live in the database.
- `launch.mjs --postgres` rewrites `adapters: local()` in the copy's config, so it works only for an app whose config says exactly that. It never changes the source app.
- The Postgres suite makes a schema per test and drops it. With `THIXO_TEST_POSTGRES_URL` it needs a role that can create schemas.
- D1 is tested on Miniflare, which runs D1's API on local SQLite. Real D1 is not reached from here.
- `SqlDriver` has `batch(list)` and no callback transaction, because D1 cannot do one. New adapter code that needs to read and then decide inside one write must use a single statement (`INSERT ... SELECT`, `RETURNING`), not a transaction.
