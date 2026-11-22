# The app's API, token and SDK

An implementor writes endpoints, records, scopes and slots in plain TypeScript. Thixo turns them into a server that issues short-lived tokens, refuses a call that lacks any scope the endpoint carries, validates input, serves a generated SDK, and hands the plugin compiler typed declarations of the app. This file covers that foundation: `thixo/schema`, `thixo/api`, `thixo/slots`, `thixo/server` (`createThixo`, `collectApp`) and the todo example's `api/`, `app/slots.ts` and `thixo.config.ts`.

## Sub-features

- `app-collect` finds every endpoint, record, slot and scope by its export name, adds Thixo's own scopes, and throws on a mistake (unknown scope, duplicate route, record not exported).
- `app-token` trades the app's session for a 15-minute HS256 token with `sub`, `scopes` and `groups`, and refuses a missing, tampered, wrong-key or expired one.
- `app-scopes` enforces every scope an endpoint carries: 401 without a token, 403 naming each missing scope, 400 for bad input, 404 for no route.
- `app-input` fills input from path parameters, query string and JSON body, converts dates, drops undeclared fields, and writes dates out as ISO strings.
- `app-sdk` serves `GET /_thixo/sdk.js`: an ES module with one async function per endpoint, taking `(input, { token, baseUrl?, fetch? })`.
- `app-info` serves `GET /_thixo/app`: scopes, endpoints, records and slots, including the `todo-row` child of `main`.
- `app-types` generates the `.d.ts` of `@app/sdk`, `@app/sdk/optional` and `@app/slots`, and ships `thixo/plugin`, `thixo/ui`, `thixo/data`, `thixo/schema` and `thixo/services` for plugins to be type-checked against.
- `app-example` is the todo example as real code: users `ana`, `ben` and `cy` chosen by the `thixo-user` cookie.

## How to get to it (user POV)

- As an implementor, write `api/*.ts` and `app/slots.ts`, then start the app with `npm run dev -w thixo-example-todo` (needs the CLI package, which another build step provides).
- As the shell, call `POST /_thixo/token` with the session cookie, then `GET /_thixo/app`, `GET /_thixo/sdk.js` and `/api/...` with `Authorization: Bearer <token>`.
- As the plugin compiler, read `CompileEnv` from `buildCompileEnv(app, config)` in `thixo/server`.
- As a developer of this repo, call `createThixo(app, config).fetch(new Request(...))` directly. No port is needed.

## Driving it with the fetch handler

Preconditions:

- Run from the repository root, after `npm install`.
- `npm run build -w thixo` has succeeded. The example imports `thixo/api` from `packages/core/dist`.
- Nothing listens on a port and nothing is written to disk: state is in memory and the data adapter is a stand-in that only remembers users.

- **Whole suite.** Run `npm test -w thixo`. It builds, then runs the tests. The final lines read `# pass 33` and `# fail 0` (the count grows as tests are added; `fail` must be 0).
- **Type-check the tests, including inferred types.** Run `npx tsc -p packages/core/test`. No output and exit code `0`.
- **Drive the todo example.** Run `node --import tsx packages/core/test/drive-todo.ts`. Expected lines, in order:
  - `no cookie: POST /_thixo/token -> 401`
  - `cy lists: GET /api/todos -> 200` with three seeded todos
  - `cy creates: POST /api/todos -> 403` with `"missingScopes":["todos.write"]`
  - `cy assignees: GET /api/assignees -> 403` with `"missingScopes":["people.read"]`
  - `ana creates: POST /api/todos -> 200`
  - `ana deletes: DELETE /api/todos/<id> -> 403` with `"missingScopes":["todos.delete"]`
  - `ben deletes: DELETE /api/todos/<id> -> 204`, then `ben reads it again: ... -> 404`
  - `sdk functions: createTodo, deleteTodo, getTodo, listAssignees, listTodos, updateTodo`
  - `sdk deleteTodo as ana threw: 403 Missing scope: todos.delete`
- **Tokens.** `node --import tsx --test packages/core/test/tokens.test.ts` passes: issue, verify, 15-minute expiry, wrong key, tampered claims, `alg: none`.
- **Types a plugin sees.** `node --import tsx --test packages/core/test/compile-env.test.ts` passes. It type-checks the two example plugins (`due-dates`, `todo-list`, written with hooks from `thixo/plugin`) and a `ChildSlot` plugin against the generated declarations under `noLib`, and checks that wrong payloads, missing endpoint input, wrong field types and `import "react"` are errors.
- **Proof.** Save the output: `node --import tsx packages/core/test/drive-todo.ts > artifacts/app-api/drive-todo.txt` and `npm test -w thixo > artifacts/app-api/tests.txt`. Both files exist after cleanup, and `tests.txt` ends with `# fail 0`.

## Gotchas

- The tests import the todo example, which imports `thixo/api` from `packages/core/dist`. A stale or missing build fails with a module-not-found or a stale-behaviour error. `npm test -w thixo` builds first; running `node --test` by hand does not.
- `examples/todo/thixo.config.ts` imports `thixo-node`, which another package provides. It cannot be loaded until that package is merged, so these tests build the config inline and never import it. Do not report that as a failure of this feature.
- `thixo dev` and the shell are not part of this feature. Starting the example on a port, the sign-in cookie in a browser and a rendered `<Slot>` belong to the CLI and shell features.
- The token route issues a token for whatever scopes the identity adapter returns. A `403` after a scope change in `api/session.ts` can be a token minted before the change: fetch a new one.
- An `Authorization: Bearer` token is the only credential on `/api`. Sending only the `thixo-user` cookie to `/api/todos` is a `401` on purpose.
- Without `signingKey` in the config, `createThixo` makes a random key per process, so a token from one process is a `401` in another. Set `signingKey` in the config to share one.
- Deleting a todo does not yet tell Thixo to drop its annotations (A13's deletion signal). That route belongs to the plugin-data feature.
