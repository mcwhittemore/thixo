# The thixo command

The `thixo` command (package `thixo-cli`) builds an app from its folders and runs it, the way `next` does: `thixo dev` builds, deploys, serves and rebuilds on change, `thixo build` and `thixo start` do the same in two steps, `thixo compile` and `thixo new plugin` work on plugins, `thixo agent` calls the authoring tools of a running dev server as a named user, and `thixo registry list` and `thixo release` show what the local registry holds.

## Sub-features

- `cli-build` bundles `api/`, `app/slots.ts` and the config for Node into `.thixo/build/server.mjs` (packages external), bundles `app/shell.tsx` into `.thixo/build/client/` with an `index.html`, compiles every folder in `plugins/`, writes `.thixo/build/manifest.json`, and exits 1 if any plugin fails.
- `cli-start` serves a build: `/_thixo/*` and `/api/*` to Thixo, files from the client build, and `index.html` with a Content-Security-Policy for every other GET. It creates `.thixo/signing-key` (mode 600) and deploys `plugins/` first.
- `cli-dev` does what start does from source, writes `.thixo/agent-key` (mode 600) and `.thixo/dev.json`, passes the key to `createThixo` as `config.agentKey`, and rebuilds on change without exiting on an error.
- `cli-compile` compiles a plugin folder or `.thx` file against the project's real compile env and prints the manifest, the summary and the output size, or `file:line:col code message` errors.
- `cli-new-plugin` scaffolds `plugins/<name>/plugin.thx` with a fresh `plg_` id.
- `cli-agent` posts `{ tool, as, input }` with `x-thixo-agent-key` to `/_thixo/authoring/tool`, with shortcuts for submit, check, search, read, fork, use and describe.
- `cli-registry` prints the plugins, versions, visibility and author, and the current release's layout.

## How to get to it (user POV)

- Run `npx thixo dev [dir]` in an app folder (one with `thixo.config.ts`). The default port is 3000; `--port` or `$PORT` change it.
- Run `npx thixo build [dir]`, then `npx thixo start [dir]`.
- Run `npx thixo compile <plugin folder or file> [--out dir] [--json] [--project dir]`.
- Run `npx thixo new plugin <name> --slot <slotExportName> [dir]`.
- Run `npx thixo agent <tool> --as <user> ...` while `thixo dev` runs.
- Run `npx thixo registry list [dir]` and `npx thixo release [dir]`.
- Run `npx thixo --help` or `npx thixo <command> --help`.

## Driving it with a terminal (shell, curl)

Preconditions:

- `npm install` and `npm run build` have been run in the repo root, so `packages/cli/dist` exists. Node is 22.13 or later.
- `thixo-thx` and `thixo-node` are built (`ls node_modules/thixo-thx/dist/index.js node_modules/thixo-node/dist/index.js`). Without them every command that compiles, serves or loads the config stops with `Could not load thixo-thx` or a missing `thixo-node` module. The first three steps below do not need them.
- A scratch copy of the app. Use `examples/todo` copied to a folder inside the repo (so `thixo` resolves), such as `cp -R examples/todo scratch-todo`, and `rm -rf scratch-todo` after.

- **Run the suite.** Run `npm test -w thixo-cli`. Exit code `0` and the output ends with `# fail 0` (37 tests). It builds a fixture app with esbuild, loads the bundle with the real core server and drives `build`, `start`, `dev`, `compile`, `agent`, `registry` and `release` over real HTTP. `thixo-thx` and `thixo-node` are replaced there by fakes in `test/support/helpers.ts`, so this does not prove the compiler or `serve()` are wired.
- **Help and errors.** Run `node packages/cli/bin/thixo.js --help`, then `node packages/cli/bin/thixo.js bogus; echo $?`. The first lists dev, build, start, compile, new plugin, agent, registry list and release. The second prints `thixo: Unknown command "bogus".` and exits `1`.
- **Scaffold a plugin.** Run `npx thixo new plugin greeter --slot main scratch-todo`. It prints `Created plugins/greeter/plugin.thx`. `grep -c 'id: "plg_' scratch-todo/plugins/greeter/plugin.thx` prints `1`. Run it again: `thixo: plugins/greeter already exists.` and exit code `1`.
- **Build.** Run `npx thixo build scratch-todo`. Exit code `0`. `.thixo/build/server.mjs`, `.thixo/build/client/index.html`, `.thixo/build/client/app.js` and `.thixo/build/manifest.json` exist, the manifest has `"ok": true`, and each plugin prints `ok  <folder>` with its summary. Put `window` in a plugin: the build prints `plugins/<name>/plugin.thx:<line>:<col> thx/<code> <message>` and exits `1`, and `thixo start` then refuses with `The last build failed`.
- **Start.** Run `npx thixo start scratch-todo --port 4100` in a second terminal or in the background, and wait for `thixo start  ready on http://127.0.0.1:4100`. `curl -s localhost:4100/_thixo/app` returns the app info. `curl -s -o /dev/null -w '%{http_code}' localhost:4100/api/listTodos`'s path is `/api/todos`: `curl -s -o /dev/null -w '%{http_code}' localhost:4100/api/todos` prints `401`. `curl -si localhost:4100/some/route` returns `200`, an HTML body with `<div id="root">`, and a `content-security-policy` header that starts `default-src 'self'; script-src 'self'; connect-src 'self'`. `stat -f %Lp scratch-todo/.thixo/signing-key` prints `600`. Stop it by its process id, never by name.
- **Dev.** Run `npx thixo dev scratch-todo --port 4101` and wait for `thixo dev  ready on`. `stat -f %Lp scratch-todo/.thixo/agent-key` prints `600` and `scratch-todo/.thixo/dev.json` holds the URL. Edit `scratch-todo/plugins/todo-list/plugin.thx` to add `window`: the terminal prints the located error and `curl -s localhost:4101/_thixo/app` still answers. Fix it: a `deployed  release` line prints again with no restart. Edit an `api/` file: `server    rebuilt` prints. Edit `app/shell.tsx`: `client    rebuilt (reload the page)` prints.
- **Agent.** With dev running, `npx thixo agent describe --as ana --project scratch-todo` prints the SDK, slots and language reference. `npx thixo agent search --as ana "due" --project scratch-todo --raw` prints the JSON body. Without the dev server it prints `Could not reach the dev server` and exits `1`. The route itself is the authoring agent's, so until it is merged these return a 404 with a note that the route is off.
- **Compile.** `npx thixo compile scratch-todo/plugins/todo-list` prints `Compiled`, a `Summary` of plain sentences, the `Manifest` as JSON and `Output  <n> bytes`. `--json` prints one object with `ok`, `manifest`, `summary` and `size`. `--out out-dir` writes `plugin.js` and `manifest.json`. A folder outside any app (`mkdir /tmp/x && npx thixo compile /tmp/x`) exits `1` with `No project found ... @app/sdk and @app/slots`.
- **Registry.** After dev or start has deployed, `npx thixo registry list scratch-todo` prints one row per plugin with ID, NAME, VISIBILITY, AUTHOR, VERSIONS and SLOT, and `npx thixo release scratch-todo` prints the release id, the deployment and one `slot  plugin@n` row per slot.
- **Proof.** Save the test output, the terminal transcripts, the response headers from `curl -si` and the `ls -l` of `.thixo/` to `artifacts/cli/`. Cleanup removes `scratch-todo` and stops the processes you started, never `artifacts/`.

## Gotchas

- Not run end to end when this file was written: `thixo-thx` and `thixo-node` were not merged, so no run of the real compiler, the real `serve()` or `local()` adapters exists. Running `thixo build examples/todo` stopped at `Cannot find module .../thixo-node/dist/index.js`. The registry, plugins and authoring routes and `services.deploy` were still stubs in core. The steps for Build, Start, Dev, Agent, Compile and Registry are written from the spec and the fake-backed tests: run them once those packages are in, and fix this file where they differ.
- The fixture tests put the project's `thixo/shell` import behind a tsconfig `paths` entry to a stand-in, because the real shell is another package. They never run the browser bundle.
- `thixo dev` passes the agent key as `config.agentKey` on `ThixoConfig`, and the deployment id as `deployment` on the object given to `services.deploy`. The `DeployInput` type does not have that field yet. Both need the receiving package to read them.
- The deployment id is the git sha when the app is inside a git work tree, so two deploys of different plugin source on the same commit share an id. Versions are found by source hash, so nothing is stored twice.
- The bundle is re-imported on each `api/` change, so in-memory app state (such as the todo example's `db.ts`) resets. Files outside `api/`, `app/`, `plugins/` and the config are not watched.
- `--json` means two things: on `compile`, `registry list` and `release` it asks for JSON output, and on `agent` it is the tool's input, so `agent` uses `--raw` for the raw response.
- Do not run two `thixo dev` servers on one project: they share `.thixo/data.sqlite`, and `agent-key` is rewritten on every start, so a running agent sees `401` until it reads the new key (the CLI reads the file on every call).
- `dev` and `start` pick `127.0.0.1`. A port in use stops with `Port <n> is already in use`.
