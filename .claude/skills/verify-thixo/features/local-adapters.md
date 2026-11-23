# Local adapters

The local adapters are what a developer gets when Thixo runs on their machine with no cloud account: plugin data in a SQLite file, plugin code as files, an in-process build, a Node HTTP server that streams, and an authoring chat that runs the local `claude` command instead of calling an API.

## Sub-features

- `local-state` gives `local()` adapters rooted at `<projectDir>/.thixo`: `data.sqlite` and `code/`. The data adapter migrates itself on first use.
- `code-files` stores and reads plugin source and compiled code as files under `.thixo/code/`, refuses a key that escapes it, and writes a promotion's files into the project.
- `local-build` compiles with `thixo-thx` and checks the output a second time, turning a failed check into build errors.
- `serve-stream` serves a web `Request`/`Response` handler from a Node HTTP server, streaming bodies both ways, with optional static files.
- `claude-code-model` runs `claude -p` once per authoring turn and turns its reply into a tool call or a final answer.
- `local-driver` keeps data in another `thixo-sql` driver when `local({ driver })` is given (see `sql-drivers.md`). `data.sqlite` is then not made.
- `sql-data` holds the registry, releases, layouts, plugin data through fork chains, store records private to their owner, and annotations by group (`thixo-sql`, under every adapter set).

## How to get to it (user POV)

- Start an app with `npx thixo dev examples/todo`. The CLI builds `local()` from `THIXO_PROJECT_DIR` (default: the current directory) and serves it with `serve()`.
- Open the app in a browser and open the authoring chat. With no API key set, the chat uses the local `claude` command through `anthropic()` from `thixo-anthropic/node`; `claudeCode()` is the same adapter, still exported from `thixo-node`.
- Look in `<project>/.thixo/`. `data.sqlite` appears after the first request that touches data, and `code/` after the first plugin is submitted.
- Promote a plugin. Its files appear under `<project>/plugins/<name>/` in the working tree.

## Driving it with verify-thixo

Preconditions:

- `npm install` and `npm run build` have been run in the repo root. Node is 22.13 or later.
- A scratch directory exists, such as `mktemp -d`. Use it as `THIXO_PROJECT_DIR` so nothing lands in the repo.
- For the chat step, `claude` is on `PATH` and signed in. Check with `claude -p --output-format json --tools "" "say ok"`.

- **Through `thixo dev`.** `node .claude/skills/verify-thixo/bin/launch.mjs --run local` starts the todo app on `local()` in a temp copy. In the copy, `.thixo/` holds `data.sqlite` (with its `-wal` and `-shm` files), `code/`, `signing-key`, `agent-key`, `dev.json` and `build/`; after the agent's submit (see `authoring.md`) `code/` gains `source/…` and `compiled/…` keys; a promote writes `plugins/<folder>/plugin.thx` in the copy. A due date set in the browser survives a reload (`todo-app.md`). `node .claude/skills/verify-thixo/bin/cleanup.mjs --run local` removes the copy.
- **Run the suites.** Run `npm test --workspace thixo-sql --workspace thixo-node`. Exit code `0`, and the output ends with `# fail 0`. The data suite covers chain reads, layer isolation between two forks, patch atomicity, store privacy, annotation groups, `removeField`, `removeAnnotations`, 25 concurrent `addVersion` calls, layout changes and releases. The node suite covers the file adapter, `serve()` and the `claude` parsing.
- **State lands under `.thixo`.** Run a script that calls `local()`, patches one store record, puts one key through `code.put("source/ab/abc.json", ...)`, then calls `close()`. With `THIXO_PROJECT_DIR=$scratch` set, `find $scratch -type f` lists `.thixo/data.sqlite` and `.thixo/code/source/ab/abc.json`, and nothing else.
- **A stream arrives in pieces.** In the same script, `serve()` a handler that writes `{"n":1}`, `{"n":2}` and `{"n":3}` lines 200 ms apart, then `fetch` it and print each chunk with its elapsed time. The output shows three lines at about 10, 210 and 410 ms, not all at once. This is the check that newline-delimited JSON streams work.
- **Keys can't escape.** Call `code.put("../x", ...)` and `code.openChange({ title: "t", files: { "../evil.txt": "x" } })`. Both reject, and no file appears outside `.thixo/code/` or the project.
- **Real model turn.** Call `claudeCode().run(...)` with one tool `add_todo` and the message `Add a todo called buy milk.`. The first event is `{"type":"tool","name":"add_todo","input":{"title":"buy milk"}}` and the second is `{"type":"done"}`. A turn takes one to a few seconds.
- **Missing command.** Call `claudeCode({ command: "no-such-claude" }).run(...)`. The first event is a `text` event that begins `The \`no-such-claude\` command was not found`.
- **Proof.** Save the test output, the `find` listing, the timed chunk lines and the event lines to `artifacts/verify/local/`. Cleanup removes `$scratch` and never this folder.

## Gotchas

- `node:sqlite` is read through `createRequire` with its experimental warning filtered out. Any other warning must still print. A bare `import "node:sqlite"` in a new file brings the warning back.
- One connection serves all statements, and transactions queue. A second process on the same `data.sqlite` waits up to five seconds for a lock and then fails with `database is locked`. Do not run two `thixo dev` servers on one project.
- The `claude` adapter runs with no tools and no MCP servers, in a fresh temp directory, but it still uses the signed-in account and costs usage. Set `THIXO_SKIP_REAL_CLAUDE=1` to skip the real-call test in `npm test`.
- `claudeCode()` asks for one JSON object per reply. A reply that names a tool the turn did not offer comes back as text, not as a call.
- `serve()` is async, because the port is only known once it listens. `serve(handler, { port: 0 })` picks a free port and reports it in `url`.
- Static files are served before the handler for GET and HEAD only, and a miss falls through to the handler, so an API route under the same prefix still works.
- `openChange` only writes into the working tree. Nothing is committed.
- `localBuild` also implements the build adapter's `verify` with thx's `verifyOutput`, so the plugin route checks stored code again before serving it.
