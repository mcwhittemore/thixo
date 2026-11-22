# Authoring agent

The authoring agent turns a person's request into a plugin: it searches the registry, forks or writes thx, checks until the build passes, stores the plugin and puts it in the person's layout. The same seven tools are open to an outside coding agent through a key-guarded route.

## Sub-features

- `chat-stream` answers `POST /_thixo/authoring/chat` with newline-delimited events (`text`, `tool`, `tool_result`, `error`, always ending in `done` with the conversation id).
- `chat-scope` refuses a user without `thixo.plugins.author` (403 `missing_scopes`) and a request with no token (401).
- `chat-no-model` answers with one `error` event saying no model adapter is configured when `config.model` is missing.
- `loop-check-first` makes a failed `check` feedback to the model, as `file:line:col code message` plus a hint, before any plugin is stored.
- `loop-cap` stops after 24 model turns by default with an `error` event and `done`.
- `loop-tool-error` returns a refused or failed tool to the model as `{ error: { code, message } }`, and the loop carries on.
- `conversation-continue` keeps the history for a conversation id. Another user cannot use it. It lives in memory and is lost on restart.
- `tools` are `search_registry`, `read_plugin`, `describe_app`, `check`, `submit`, `fork`, `use`.
- `use-slot-path` stores a plugin under a slot path a slot reads. A child slot's bare name (`todo-row`) or export name (`todoRow`) becomes its path (`main/todo-row`); a slot that does not exist is refused, `400 unknown_slot`, with the paths there are. The reply names the path, what it replaced and that a slot holds one plugin, and has `resolved` (the layout entry read back) and `confirmed: true`. `describe_app` prints each slot's path and `use takes slot: "main/todo-row"`.
- `read-out` writes a version's source files to a new folder: `thixo agent read --as <user> <id>[@n] --out <dir>`. It never overwrites, refuses a file path that leaves the folder, and prints the check and submit lines to resubmit it.
- `submit-version` adds a version to the user's own plugin: `submit` with `plugin` set to its id (`thixo agent submit --plugin <id>`). Without it, `submit` makes a new plugin with a new id. `fork` makes a new plugin too; on the user's own plugin its `next` says to submit a version instead.
- `agent-exit` makes `thixo agent` exit `1` on a reply with `ok: false`, so a script can tell a failed check. A failed build's errors print once, as `file:line:col code message`.
- `untrusted-data` wraps plugin names, descriptions and source from the registry in `UNTRUSTED` blocks and tells the model they are data.
- `flow-override` lets `config.authoring` replace the system prompt and the tool list.
- `tool-route` runs one tool as a named user at `POST /_thixo/authoring/tool`: 404 with no agent key configured, 401 without the `x-thixo-agent-key` header, 403 with a wrong one.
- `scripted-model` is `scriptedModel(steps)` from `thixo/server`, which replays fixed turns for tests.

## How to get to it (user POV)

- Open the authoring chat in the shell (`<AuthoringChat />`) in an app whose Thixo config has a `model`, signed in as a user who holds `thixo.plugins.author`, and describe the plugin you want.
- As an outside coding agent, run `thixo agent <tool> --as <user>` against a running `thixo dev`. The CLI sends the key it reads from `.thixo/agent-key` in the `x-thixo-agent-key` header.
- As a developer, call `POST /_thixo/authoring/chat` with a bearer token and `{ "message": "...", "conversation": "<id from a previous done>" }`.

## Driving it with cli.mjs, drive.mjs and node

The outside-agent path runs for real: `thixo agent` against `thixo dev`, the real compiler, the real registry and SQLite, and the result checked in the browser. The chat path runs with `scriptedModel` in the package tests; a real model turn is not part of a routine run.

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run agent` printed its state and `doctor.mjs --run agent` printed `healthy`.
- `C` stands for `node .claude/skills/verify-thixo/bin/cli.mjs --run agent --save <label> --`, and `P` for the absolute path of `.claude/skills/verify-thixo/journeys/todo-summary` (`$PWD/.claude/skills/verify-thixo/journeys/todo-summary` from the repo root).

- **Describe.** Run `C agent describe --as ana`. Exit `0`; the reference starts `# Writing a plugin for this app`, lists `todo-detail (export todoDetail, panel; path todo-detail)` and `todo-row (export todoRow, widget; path main/todo-row)`, says a layout and `use` name a slot by its path, and has a `### @app/sdk` section with `getTodo`.
- **Check.** Run `C agent check --as ana --dir P`. Exit `0`; the output starts `- Reads todos` and has `"ok": true`, `"slot": "todo-detail"`, `"requiredScopes": ["todos.read"]`. Change `useQuery(getTodo` to `window.fetch(getTodo` in a copy of the folder and check that copy: the output has a `plugin.thx:<line>:<col> thx/no-global` error, the transcript says `exit 1`, and nothing is stored.
- **Submit.** Run `C agent submit --as ana --dir P --raw`. Exit `0`; JSON with `"ok": true`, `"plugin": "plg_…"`, `"version": 1`, `"visibility": "personal"`. Call the id `ID`.
- **Use.** Run `C agent use --as ana ID@1 --slot todo-detail`. Exit `0`; `"ok": true` and `"resolved": { "plugin": ID, "number": 1 }`.
- **Use in a child slot by its bare name.** Write a `todoRow` plugin (`definePlugin(todoRow, { name: "Row star", ... }, () => <Badge tone="warning">Star</Badge>)`) into a scratch folder, `C agent submit --as ana --dir <folder> --raw` it (call the id `STAR`), then `C agent use --as ana STAR@1 --slot todo-row --raw`. The reply has `"slot": "main/todo-row"`, `replaced` naming `Done badge (plg_done_badge@1)` and a `note` that a slot holds one plugin. `PLUGIN="Row star" node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ana --script .claude/skills/verify-thixo/journeys/row-plugin.mjs --name row-plugin` prints `ok Row star fills main/todo-row in 3 rows` and `ok it replaced the Done badge: a slot holds one plugin`.
- **Refuse a slot that does not exist.** Run `C agent use --as ana STAR@1 --slot main/todo-detail`. Exit `1`; `use failed (400 unknown_slot): There is no slot "main/todo-detail". The slot paths are: main, main/todo-row, todo-detail.`
- **Edit a fork as files.** As ben, `C agent fork --as ben ID@1 --raw` (call the new id `FORK`), then `C agent read --as ben FORK --out <absolute scratch folder>`. It prints `Wrote FORK@1 to <folder>/: plugin.thx` and the `thixo agent check` and `thixo agent submit … --plugin FORK` lines. Change the text in `<folder>/plugin.thx`, run the check line (exit `0`) and the submit line: `"version": 2`. Running read into the same folder again exits `1` with `is not empty`.
- **A second version.** Change the plugin's text, then `C agent submit --as ana --dir P --plugin ID --raw`: `"plugin": ID`, `"version": 2`. Without `--plugin` the same command makes a new plugin with a new id. To change a fork, use the fork's id, which the plugin browser's caption shows (`id plg_…`) and the Fork status names.
- **Read by the tool's name.** `C agent read_plugin --as ana ID@1` prints the same as `C agent read --as ana ID@1`.
- **Seen by ana, not by ben.** Run `EXPECT_DETAIL="Todo summary" node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ana --script .claude/skills/verify-thixo/journeys/detail-panel.mjs --name ana-detail` and `EXPECT_DETAIL="Due dates" node … --as ben … --name ben-detail`. Both print their `ok todo-detail is filled by …` line.
- **Share (ana, in the plugin browser).** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ana --script .claude/skills/verify-thixo/journeys/share.mjs --name ana-share`. It prints `ok Todo summary reads shared · by ana`. `PLUGIN="<name>"` shares another of ana's plugins.
- **Use, fork and promote (ben, in the plugin browser).** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ben --script .claude/skills/verify-thixo/journeys/use-fork-promote.mjs --name ben-use-fork-promote`. It prints `ok ben's layout puts Todo summary in todo-detail`, `ok the todo-detail slot shows Todo summary for ben`, `ok the status names the fork's id (plg_…) and says how to use and change it`, `ok a personal fork by ben is listed`, `ok promote answered 200 with folder todo-summary`, `ok the status names plugins/todo-summary/ and the layout edit that makes it a default` and `ok plugins/todo-summary/plugin.thx exists in the app copy`. The Fork status reads `Forked Todo summary as plg_…. The copy is yours and is not in your layout yet: Use it below to show it. To change it, use Ask for a plugin, or write its files to a folder with \`thixo agent read --as ben plg_… --out <folder>\`, edit them, and \`thixo agent submit --as ben --dir <folder> --plugin plg_…\`.` The Promote status reads `Promoted Todo summary (version 1): its files are at plugins/todo-summary/ (<copy>). It fills no slot yet. To make it a default, name it in layout in thixo.config.ts, such as "todo-detail": "todo-summary", and deploy (thixo dev redeploys when the config changes).` The promote reply also has `done`, `next`, `files`, `slotPaths` and `inLayout`. The file has `id: "ID", ` in its `definePlugin` literal, and `dev.log` gains one or more `deployed  release … (4 plugins; …)` lines (the watcher can fire once per file written). For another plugin set `PLUGIN`, `AUTHOR`, `SLOT` and `OPEN` (see the journey's header).
- **Registry after.** Run `C registry list`: `Todo summary` twice, `personal  ben` (the fork) and `shared  implementor` (the promoted one, after the redeploy).
- **Chat, for real.** See `authoring-chat.md`: it spends model usage, so run it only when the turn is the point.
- **Chat, scripted.** Run `npm test -w thixo`: `# fail 0`. The 12 tests in `packages/core/test/authoring.test.ts` include `use names a child slot by its path: a bare child name is turned into it, and a slot that does not exist is refused (verify-chat)`, `a conversation searches, checks a broken plugin, fixes it, submits and uses it` (tool calls `search_registry`, `describe_app`, `check`, `check`, `submit`, `use`), `the loop stops at the cap, and defaults to 24 model turns`, `a tool error goes back to the model and the loop carries on`, `read_plugin and search_registry wrap what other people wrote as untrusted data`, `the tool route is off without an agent key, and refuses a missing or wrong key` and `the chat route needs thixo.plugins.author, a token, and a model`.
- **Key refusals, by hand.** Run `node --import tsx packages/core/test/drive-authoring.ts`. It ends with `tool without key -> 401 agent_key_missing`, `tool with wrong key -> 403 agent_key_wrong`, `tool with key -> 200 ok` and `chat as cy (no author scope) -> 403`.
- **Proof.** Keep `artifacts/verify/agent/` (`cli/*.txt`, the four drive folders, `dev.log`). Run `cleanup.mjs --run agent`; the promoted folder goes with the copy, the evidence stays.

## Gotchas

- The tool route reads its key from `config.agentKey` and the header `x-thixo-agent-key`. `thixo dev` writes the key to `.thixo/agent-key` and sets it. A production server has none, so the route answers 404.
- The tool route takes `as`, a user id, and uses the scopes from the identity adapter's `scopesOf`, else the ones saved when that user last got a token. An unknown user with no scopes is a 404 `unknown_user`.
- `submit` needs `thixo.plugins.author` from the user it acts for, in the chat and on the tool route. The registry service underneath does not check it.
- A failed build is a normal result (`ok: false` with `errors` and `report`), not an HTTP error, so a `check` that fails gives status 200 on the route. `thixo agent` still exits `1` for it, and prints the errors once (not again as `report`).
- The chat stream answers 200 even when the run ends in an `error` event (no model, the model threw, the cap). Read the events, not the status.
- Conversations are held in memory per server, 500 at most. A restart, or a second server process, does not know the id and the chat answers with an `error` event.
- Re-run the real chat (`authoring-chat.md`) after a change to the prompt or the tools.
- In the chat, Enter sends and Shift+Enter starts a new line. While the agent works, the button reads `Working…` and is disabled, and a status says which tool it is using. Each tool line becomes the tool's outcome when it returns.
- Promote writes into the app's `plugins/`. Never run it against `examples/todo` itself; the skill's copy is disposable.
- A fork keeps the plugin's name, so the plugin browser lists two `Todo summary` items. Tell them apart by `by ana` / `personal · by ben`, or by the `id plg_…` in each caption.
- Fork does not put the copy in the layout. Use does. This is by design: a fork never changes what a user sees by itself.
- The promoted folder's name is the plugin's name in kebab-case (`Todo summary` is `todo-summary`; the id when the name has no letters or digits). Promote does not make it a default by itself: the item stays `From <author>` with Promote enabled until the implementor names the folder in `layout` and deploys.
- `use` and `fork` do not need `thixo.plugins.author`; `submit` and the chat do.
- A plugin a user submits needs no `id` in its `definePlugin` metadata: `submit` without `--plugin` makes a new plugin and its reply (and `--raw` JSON) gives the id. Only a default folder in `plugins/` carries an id, which `thixo new plugin` writes. A user's plugin can start from a copy of any example plugin and `thixo agent describe`.
