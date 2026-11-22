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

- Run `npx thixo dev [dir]` in an app folder (one with `thixo.config.ts`). The default port is 3000; `--port` or `$PORT` change it, and `--port 0` picks a free one.
- Run `npx thixo build [dir]`, then `npx thixo start [dir]`.
- Run `npx thixo compile <plugin folder or file> [--out dir] [--json] [--project dir]`.
- Run `npx thixo new plugin <name> --slot <slot> [dir]`. The slot is its name (`todo-detail`) or its export name in `app/slots.ts` (`todoDetail`).
- Run `npx thixo agent <tool> --as <user> ...` while `thixo dev` runs.
- Run `npx thixo registry list [dir]` and `npx thixo release [dir]`.
- Run `npx thixo --help` or `npx thixo <command> --help`.

## Driving it with cli.mjs and a terminal

Preconditions:

- `npm install` and `npm run build` have run in the repo root, so `packages/cli/dist` and every package's `dist` exist. Node is 22.13 or later.
- An instance is up: `node .claude/skills/verify-thixo/bin/launch.mjs --run cli` printed its state and `doctor.mjs --run cli` printed `healthy`. That launch is itself `thixo dev <copy> --port 0`; its `dev.log` is the dev step's transcript.
- `C` below stands for `node .claude/skills/verify-thixo/bin/cli.mjs --run cli --save <label> --`, which runs `thixo` in the run's copy of the app.

- **Help and errors.** Run `node packages/cli/bin/thixo.js --help`, then `node packages/cli/bin/thixo.js bogus; echo $?`. The first lists dev, build, start, compile, new plugin, agent, registry list and release. The second prints `thixo: Unknown command "bogus".` and exits `1`.
- **Dev.** `artifacts/verify/cli/dev.log` shows `server    rebuilt`, `client    rebuilt (reload the page)`, `deployed  release rel_… (3 plugins; main -> plg_todo_list@1, main/todo-row -> plg_done_badge@1, todo-detail -> plg_due_dates@1)` and `thixo dev  ready on http://127.0.0.1:<port>`. In the copy (the `dir` launch printed), `.thixo/agent-key` and `.thixo/signing-key` are mode `600` (`stat -f %Lp`), and `.thixo/dev.json` holds the url and pid.
- **Redeploy on change.** Copy `.claude/skills/verify-thixo/journeys/todo-summary` into the copy's `plugins/`, with `id: "plg_verify_summary", ` added before `name:` in its `definePlugin` literal. `dev.log` gains a `deployed  release` line with `4 plugins`, with no restart. Remove the folder again: another `deployed  release` line.
- **Compile.** Run `C compile plugins/due-dates`. Exit `0`; stdout has `Compiled due-dates (Due dates)`, a `Summary` with `Annotates todo with dueOn (date).`, the `Manifest` JSON and `Output  2.9 KB`. Add `--json` for one object with `ok`, `manifest`, `summary` and `size`.
- **New plugin.** Run `C new plugin my-notes --slot todo-detail`. It prints `Created plugins/my-notes/plugin.thx`; the file imports `{ todoDetail }` from `@app/slots` and has `id: "plg_…"`. `C compile plugins/my-notes` exits `0`. Run the new-plugin command again: `thixo: plugins/my-notes already exists.`, exit `1`. Delete `plugins/my-notes` from the copy after.
- **Agent.** Run `C agent describe --as ana`: the reference starts `# Writing a plugin for this app` and lists `todo-detail (export todoDetail, panel)`. The agent path end to end (check, submit, use) is in `authoring.md`.
- **Registry.** Run `C registry list`: one row per plugin with ID, NAME, VISIBILITY, AUTHOR, VERSIONS and SLOT: the three defaults by `implementor`, plus every folder dev deployed during the run (a removed folder stays in the registry; only the release drops it). Run `C release`: the release id, the deployment and one `slot  plugin@n` row per slot.
- **Build and start.** In the copy, run `node <repo>/packages/cli/bin/thixo.js build .`: exit `0`, `ok  done-badge`, `ok  due-dates`, `ok  todo-list` with their summaries, and `.thixo/build/server.mjs`, `.thixo/build/client/index.html`, `.thixo/build/client/app.js`, `.thixo/build/manifest.json`. Then `thixo start . --port 0` in the background (it shares the copy's `.thixo/data.sqlite` with the running dev server, which is fine for this short check) prints `thixo start  ready on …`; `curl -si <url>/some/route` returns `200`, `<div id="root">` and a `content-security-policy` that starts `default-src 'self'; script-src 'self'`; `curl -so /dev/null -w '%{http_code}' <url>/api/todos` prints `401`. Stop start by its pid.
- **Suite.** Run `npm test -w thixo-cli`: `# fail 0` (37 tests, against a fixture app with a fake compiler and `serve()` stand-in; the steps above use the real ones).
- **Proof.** Keep `artifacts/verify/cli/cli/*.txt` and `dev.log`, then `node .claude/skills/verify-thixo/bin/cleanup.mjs --run cli`.

## Gotchas

- `thixo dev` and `thixo start` need an app whose `node_modules` resolves `thixo`, `thixo-node` and React. Inside the repo the workspace does that; `launch.mjs` links the repo's `node_modules` into its temp copy.
- The deployment id is the git sha when the app is inside a git work tree, else the first 12 hex characters of the build hash. Versions are found by source hash, so nothing is stored twice.
- The bundle is re-imported on each `api/` change, so in-memory app state (the todo example's `db.ts`) resets. Files outside `api/`, `app/`, `plugins/` and the config are not watched, and there is no live reload: reload the page after `client rebuilt`.
- `--json` means two things: on `compile`, `registry list` and `release` it asks for JSON output, and on `agent` it is the tool's input, so `agent` uses `--raw` for the raw response.
- Do not run two `thixo dev` servers on one project: they share `.thixo/data.sqlite`, and `agent-key` is rewritten on every start.
- `dev` and `start` listen on `127.0.0.1`. A port in use stops with `Port <n> is already in use`.
- The page's CSP is `script-src 'self'`. Plugin code is imported by address (`/_thixo/plugins/<id>/<n>.js?u=…&e=…&k=…`, a five-minute ticket from the load reply), not from a `blob:`.
