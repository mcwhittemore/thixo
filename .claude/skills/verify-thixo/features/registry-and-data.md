# Registry, plugin route, plugin data, layouts and deploys

Thixo's server keeps every plugin version, shows a person only the plugins they may run, serves a version's compiled module, stores plugin data under strict rules, resolves each user's layout over the newest release, and publishes default plugins from the implementor's `plugins/` folder. This file covers `packages/core/src/server/registry/**`, `server/deploy.ts` and the routes `registry`, `plugins`, `data` and `layout` under `/_thixo`.

## Sub-features

- `registry-submit` builds files through the build adapter, stores source and compiled code under content-derived keys, adds a version, and returns the schema diff. It is a service call (`services.registry.submit`), not an HTTP route (P6). Build errors come back and nothing is stored. A field that changes type anywhere in its lineage is rejected (D8). Only the author adds versions.
- `registry-search` lists shared and default plugins plus the user's own, only those whose required scopes the user holds (G1), with plain summary sentences (G5): `Reads todos`, `Adds 1 field to todo: dueOn (date)`, `Keeps a private store: prefs`, `Uses: clipboard`, `Names outside addresses: ...`.
- `registry-fork` makes a personal plugin with `forkedFrom` set and the same stored source; `empty` stops it reading its parent's data (D9).
- `registry-share` turns a personal plugin shared. The author only, and only with `thixo.plugins.share`.
- `registry-promote` asks the promotion rule (default: `thixo.plugins.promote`), then opens a change writing `plugins/<slug>/...` with the plugin's id in `definePlugin`'s metadata.
- `plugin-load` returns `PluginLoad` with `authorCan` (what the author still holds, P3) and `userCan` (P4). A personal plugin loads for its author only.
- `plugin-code` serves `GET /_thixo/plugins/:id/:n.js` as `text/javascript` with `Cache-Control: no-store`, after checking the stored code still matches its key and passes the build adapter's `verify`.
- `plugin-data` serves `POST /_thixo/data/read|read-many|patch|list|remove|remove-field`: refuses undeclared fields (D6) and wrong types, wants `{ "$url": "..." }` for url fields, needs `thixo.data.read`/`write` (D11) and a record's read scopes (D12), asks `canRead` (A13), groups annotations by the record's grouping (A11), keeps stores per user (D2), reads through fork chains (D10), and refuses when the plugin's author lacks the scopes (P3). `remove-field` needs `thixo.data.admin` (D7). `recordDeleted(record, id)` from `thixo/server` drops a record's annotations.
- `layout` serves `GET /_thixo/layout`, `PUT` and `DELETE /_thixo/layout/:slot`: the newest release's defaults under the user's changes (S9).
- `deploy` (`services.deploy`) builds each folder, finds a version by source hash or stores one, and writes a release. The same input twice stores nothing; an older commit finds old versions by hash. A folder without an id fails the deploy.

## How to get to it (user POV)

- As a person using an app, open the plugin browser in the shell, which calls `GET /_thixo/registry/search`, `.../plugins/:id`, `.../fork`, `.../share` and `.../promote`, then `PUT /_thixo/layout/:slot` to use a plugin. The shell is another build step; until it merges, drive the routes directly.
- As the authoring agent or the CLI, call `thixo.services.registry.submit`, `search`, `fork`, `load`, `getSource` and `layout.set` directly.
- As the implementor, put a plugin folder under `plugins/`, name it in `layout` in `thixo.config.ts`, and deploy with `thixo.services.deploy({ plugins, layout, deployment })` (`thixo dev` and `thixo start` do this once the CLI package exists).
- As a plugin's broker, post to `/_thixo/data/*` with the bearer token and `{ plugin, version, store | record, ... }`.

## Driving it with the fetch handler

Preconditions:

- Run from the repository root after `npm install`. Node 22.13 or later.
- Nothing listens on a port. The tests use an in-memory data adapter, an in-memory code adapter and a fake build adapter that reads each plugin's manifest from a trailing `// @manifest` comment (`packages/core/test/helpers/registry-doubles.ts`). The real compiler is not exercised here.

- **Whole suite.** Run `npm test -w thixo`. It builds, then runs every test. The last lines read `# pass 72` and `# fail 0` (the count grows as tests are added; `fail` must be 0). The registry, data and deploy files are `registry.test.ts`, `plugin-data.test.ts` and `deploy-layout.test.ts`.
- **Type-check the tests.** Run `npx tsc -p packages/core/test`. No output, exit code `0`.
- **Drive a session.** Run `node --import tsx packages/core/test/drive-registry.ts`. Expected lines, in order:
  - `ana submits: version 1 of personal plugin by ana` and a `summary:` line holding `Reads todos`, `Adds 1 field to todo: dueOn (date)` and `Keeps a private store: prefs`.
  - `ana retypes dueOn: registry/field-type-changed`
  - `ana shares -> 200`, then `ben searches 'due' again: 1 found` and `cy searches 'due': 0 found (no todos.read)`.
  - `ben forks -> 201`
  - `ana patches dueOn -> 200`, then `ana patches undeclared priority -> 400 invalid_fields`
  - `ben reads t1 through his fork -> 200`
  - `plugin route: 200 text/javascript; charset=utf-8 no-store`
  - `boss promotes -> 200`
  - `deploy after the change merges:` with the promoted plugin at `"number":1`, then `deploy again: same release, versions: 1`
  - `ben's layout:` holding the same version for `main/todo-detail`.
- **Promotion finds the promoted version.** `node --import tsx --test packages/core/test/deploy-layout.test.ts` passes, including `promotion round trip: promoting version 4 and deploying finds version 4`: five versions exist before and after, and the release points at version 4.
- **Author cap.** `node --import tsx --test packages/core/test/plugin-data.test.ts` passes, including `P3: the author's own scopes cap what a plugin may do with data`: after the author loses `thixo.data.write` another user's patch is `403 author_cap`, and reads still work.
- **Proof.** Save the output: `mkdir -p artifacts/registry-and-data && node --import tsx packages/core/test/drive-registry.ts > artifacts/registry-and-data/drive.txt && npm test -w thixo > artifacts/registry-and-data/tests.txt`. Both files exist after cleanup, and `tests.txt` ends with `# fail 0`.

## Gotchas

- The tests need `packages/core/dist`. `npm test -w thixo` builds first; running `node --test` by hand on a clean tree fails with module-not-found.
- A slot path has slashes, so `PUT /_thixo/layout/:slot` takes it percent-encoded: `/_thixo/layout/main%2Ftodo-row`. The slot's last segment must equal the version's manifest slot, or the answer is `400 wrong_slot`.
- Versions are stored and hashed without the `id` in `definePlugin`'s metadata. Promotion adds the id to a copy, and a deploy takes it out before hashing. Edit a promoted folder by hand (beyond the id) and the deploy makes a new version, as it should.
- A deploy turns a promoted plugin into an implementor plugin: its author becomes `implementor` and it is shared. Its original author can no longer add versions to it.
- `url` fields reject plain strings on purpose. Send `{ "$url": "https://..." }`, and expect the same shape back. Dates are ISO strings on the wire and `Date` values in the adapter.
- A store's single record has the id `singleton` (`useStore`). `create: true` makes a new id for a list-style store (`useStoreList`).
- Setting a field to `null` is refused (clearing a value is an open question). Leave the field out of the patch.
- The plugin route needs an `Authorization` header. A browser `import()` cannot send one, so the shell must fetch the text and import it from a blob.
- `recordDeleted` reaches every Thixo created in the process. Call it from the handler that deletes the record.
- These tests use a fake build. They prove the registry's rules, not that the real compiler's manifests have the shape the fake assumes.
