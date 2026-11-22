# Registry, plugin route, plugin data, layouts and deploys

Thixo's server keeps every plugin version, shows a person only the plugins they may run, serves a version's compiled module, stores plugin data under strict rules, resolves each user's layout over the newest release, and publishes default plugins from the implementor's `plugins/` folder. This file covers `packages/core/src/server/registry/**`, `server/deploy.ts` and the routes `registry`, `plugins`, `data` and `layout` under `/_thixo`.

## Sub-features

- `registry-submit` builds files through the build adapter, stores source and compiled code under content-derived keys, adds a version, and returns the schema diff. It is a service call (`services.registry.submit`), not an HTTP route (P6). Build errors come back and nothing is stored. A field that changes type anywhere in its lineage is rejected (D8). Only the author adds versions.
- `registry-search` lists shared and default plugins plus the user's own, only those whose required scopes the user holds (G1), with plain summary sentences (G5): `Reads todos`, `Adds 1 field to todo: dueOn (date)`, `Keeps a private store: prefs`, `Reads its own data`, `Writes its own data`, `Uses: clipboard`, `Names outside addresses: ...`. The scope words are the app's from defineScopes and Thixo's for its own (`packages/core/src/scope-words.ts`), the same in `thixo compile`, `thixo build` and the plugin browser.
- `registry-fork` makes a personal plugin with `forkedFrom` set and the same stored source; `empty` stops it reading its parent's data (D9).
- `registry-share` turns a personal plugin shared. The author only, and only with `thixo.plugins.share`.
- `registry-promote` asks the promotion rule (default: `thixo.plugins.promote`), then opens a change writing `plugins/<slug>/...` with the plugin's id in `definePlugin`'s metadata.
- `plugin-load` returns `PluginLoad` with `authorCan` (what the author still holds, P3) and `userCan` (P4). A personal plugin loads for its author only.
- `plugin-code` serves `GET /_thixo/plugins/:id/:n.js` as `text/javascript` with `Cache-Control: no-store`, after checking the stored code still matches its key and passes the build adapter's `verify` (`localBuild` runs thx's `verifyOutput`). It takes a bearer token, or the ticket (`?u=&e=&k=`, five minutes, bound to user, plugin and version) that the `load` route puts in `PluginLoad.code`, so the browser can `import()` it.
- `plugin-data` serves `POST /_thixo/data/read|read-many|patch|list|remove|remove-field` with the contract's `DataBodies`: `{ plugin, version, at: { store, id } | { record, id } }`; `read` answers `{ fields }`, `read-many` `{ fields: [...] }` in the order asked, `list` `{ ids }`, `patch` and `remove` 204. It refuses undeclared fields (D6) and wrong types, wants `{ "$url": "..." }` for url fields, needs `thixo.data.read`/`write` (D11) and a record's read scopes (D12), asks `canRead` (A13), groups annotations by the record's grouping (A11), keeps stores per user (D2), reads through fork chains (D10), and refuses when the plugin's author lacks the scopes (P3). `remove-field` needs `thixo.data.admin` (D7). `recordDeleted(record, id)` from `thixo/server` drops a record's annotations.
- `layout` serves `GET /_thixo/layout`, `PUT` and `DELETE /_thixo/layout/:slot`: the newest release's defaults under the user's changes (S9).
- `deploy` (`services.deploy`) builds each folder, finds a version by source hash or stores one, and writes a release. The same input twice stores nothing; an older commit finds old versions by hash. A folder without an id fails the deploy.

## How to get to it (user POV)

- As a person using an app, open `Plugins` in the shell, which calls `GET /_thixo/registry/search`, `.../plugins/:id`, `.../fork`, `.../share` and `.../promote`, then `PUT /_thixo/layout/:slot` to use a plugin. Set a due date in the detail panel: the broker posts `/_thixo/data/patch`.
- As the authoring agent or the CLI, call `thixo.services.registry.submit`, `search`, `fork`, `load`, `getSource` and `layout.set` directly.
- As the implementor, put a plugin folder under `plugins/`, name it in `layout` in `thixo.config.ts`, and run `thixo dev` or `thixo start`, which call `thixo.services.deploy({ plugins, layout, deployment })`.
- As a plugin's broker, post to `/_thixo/data/*` with the bearer token and a `DataBodies` body.

## Driving it with drive.mjs, cli.mjs and the fetch handler

Preconditions:

- `npm run build` has run. For the browser steps, `node .claude/skills/verify-thixo/bin/launch.mjs --run registry` printed its state and `doctor.mjs --run registry` printed `healthy`.

- **Data through the browser.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run registry --as ana --script .claude/skills/verify-thixo/journeys/todo-basics.mjs --name data`. `data/requests.json` has `POST /_thixo/data/read` with `"at":{"record":"todo","id":"todo-1"}` and `"at":{"store":"prefs","id":"default"}` (200), and `POST /_thixo/data/patch` (204); after the reload the date reads `2026-12-24`, so it came back from `.thixo/data.sqlite`.
- **Layout, search, share, fork, promote, deploy through the browser and the CLI.** Follow the agent path in `authoring.md` on this run. `node .claude/skills/verify-thixo/bin/cli.mjs --run registry -- registry list` then shows the shared plugin, ben's personal fork, and (after the promote and the redeploy it triggers) the promoted one with author `implementor`.
- **Whole suite.** Run `npm test -w thixo`. `# fail 0` (113 tests). The registry, data and deploy files are `registry.test.ts`, `plugin-data.test.ts` and `deploy-layout.test.ts`; they use in-memory adapters and a fake build that reads each manifest from a `// @manifest` comment (`packages/core/test/helpers/registry-doubles.ts`).
- **Type-check the tests.** Run `npx tsc -p packages/core/test`. No output, exit code `0`.
- **Drive a session against the fetch handler.** Run `node --import tsx packages/core/test/drive-registry.ts`. Expected lines, in order: `ana submits: version 1 of personal plugin by ana`, a `summary:` line with `Reads todos`, `Adds 1 field to todo: dueOn (date)` and `Keeps a private store: prefs`; `ana retypes dueOn: registry/field-type-changed`; `ben searches 'due' -> 200`; `ana shares -> 200`; `ben searches 'due' again: 1 found`; `cy searches 'due': 0 found (no todos.read)`; `ben forks -> 201`; `ana patches dueOn -> 204`; `ana patches undeclared priority -> 400 invalid_fields`; `ben reads t1 through his fork -> 200`; `plugin route: 200 text/javascript; charset=utf-8 no-store`; `boss promotes -> 200`; `deploy after the change merges:` with `"number":1`; `deploy again: same release, versions: 1`; `ben's layout:` with the same version at `main/todo-detail`.
- **Proof.** Keep `artifacts/verify/registry/` and save `node --import tsx packages/core/test/drive-registry.ts > artifacts/verify/registry/drive.txt`. Run `cleanup.mjs --run registry`; both stay.

## Gotchas

- The tests need `packages/core/dist`. `npm test -w thixo` builds first; running `node --test` by hand on a clean tree fails with module-not-found.
- A slot path has slashes, so `PUT /_thixo/layout/:slot` takes it percent-encoded: `/_thixo/layout/main%2Ftodo-row`. The slot's last segment must equal the version's manifest slot, or the answer is `400 wrong_slot`.
- Versions are stored and hashed without the `id` in `definePlugin`'s metadata. Promotion adds the id to a copy, and a deploy takes it out before hashing. Edit a promoted folder by hand (beyond the id) and the deploy makes a new version, as it should.
- A deploy turns a promoted plugin into an implementor plugin: its author becomes `implementor` and it is shared. Its original author can no longer add versions to it.
- `url` fields reject plain strings on purpose. Send `{ "$url": "https://..." }`, and expect the same shape back. Dates are ISO strings on the wire and `Date` values in the adapter.
- Every data body names its record id in `at`. The shell's `useStore` uses `default`; `useStoreList` makes ids with `crypto.randomUUID`.
- Setting a field to `null` is refused (clearing a value is an open question). Leave the field out of the patch.
- The plugin route takes a bearer token or the ticket in the `load` reply's `code`. A ticket is for one user, plugin and version, and expires after five minutes (`401 ticket_invalid`).
- `recordDeleted` reaches every Thixo created in the process. Call it from the handler that deletes the record.
- The package tests use a fake build. The browser and CLI steps above use the real compiler, whose manifests key annotations by the record's name (`todo`) and name the slot (`todo-detail`), as the fake assumes.
- The todo example calls `recordDeleted("todo", id)` from `deleteTodo`, so a deleted todo's annotations go with it.
- `thixo registry list` shows each plugin's versions (`1,2`) and the slot path it fills (`main/todo-row`), not what changed between versions. The data diff of a version (`diff.added`, `noLongerShown`) is only in the reply to the `submit` that made it.
