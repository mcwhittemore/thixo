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

- **Describe.** Run `C agent describe --as ana`. Exit `0`; the reference starts `# Writing a plugin for this app`, lists `todo-detail (export todoDetail, panel)` and has a `### @app/sdk` section with `getTodo`.
- **Check.** Run `C agent check --as ana --dir P`. Exit `0`; the output starts `- Reads todos` and has `"ok": true`, `"slot": "todo-detail"`, `"requiredScopes": ["todos.read"]`. Change `useQuery(getTodo` to `window.fetch(getTodo` in a copy of the folder and check that copy: the output has a `plugin.thx:<line>:<col>` error and nothing is stored.
- **Submit.** Run `C agent submit --as ana --dir P --raw`. Exit `0`; JSON with `"ok": true`, `"plugin": "plg_…"`, `"version": 1`, `"visibility": "personal"`. Call the id `ID`.
- **Use.** Run `C agent use --as ana ID@1 --slot todo-detail`. Exit `0`; `"ok": true` and `"resolved": { "plugin": ID, "number": 1 }`.
- **Seen by ana, not by ben.** Run `EXPECT_DETAIL="Todo summary" node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ana --script .claude/skills/verify-thixo/journeys/detail-panel.mjs --name ana-detail` and `EXPECT_DETAIL="Due dates" node … --as ben … --name ben-detail`. Both print their `ok todo-detail is filled by …` line.
- **Share (ana, in the plugin browser).** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ana --script .claude/skills/verify-thixo/journeys/share.mjs --name ana-share`. It prints `ok Todo summary reads shared · by ana`.
- **Use, fork and promote (ben, in the plugin browser).** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run agent --as ben --script .claude/skills/verify-thixo/journeys/use-fork-promote.mjs --name ben-use-fork-promote`. It prints `ok ben's layout puts Todo summary in todo-detail`, `ok the panel shows Todo summary for ben`, `ok a personal fork by ben is listed`, `ok promote answered 200 with folder todo-summary` and `ok plugins/todo-summary/plugin.thx exists in the app copy`. That file has `id: "ID", ` in its `definePlugin` literal, and `dev.log` gains a `deployed  release … (4 plugins; …)` line.
- **Registry after.** Run `C registry list`: `Todo summary` twice, `personal  ben` (the fork) and `shared  implementor` (the promoted one, after the redeploy).
- **Chat, scripted.** Run `npm test -w thixo`: `# fail 0`. The 11 tests in `packages/core/test/authoring.test.ts` include `a conversation searches, checks a broken plugin, fixes it, submits and uses it` (tool calls `search_registry`, `describe_app`, `check`, `check`, `submit`, `use`), `the loop stops at the cap, and defaults to 24 model turns`, `a tool error goes back to the model and the loop carries on`, `read_plugin and search_registry wrap what other people wrote as untrusted data`, `the tool route is off without an agent key, and refuses a missing or wrong key` and `the chat route needs thixo.plugins.author, a token, and a model`.
- **Key refusals, by hand.** Run `node --import tsx packages/core/test/drive-authoring.ts`. It ends with `tool without key -> 401 agent_key_missing`, `tool with wrong key -> 403 agent_key_wrong`, `tool with key -> 200 ok` and `chat as cy (no author scope) -> 403`.
- **Proof.** Keep `artifacts/verify/agent/` (`cli/*.txt`, the four drive folders, `dev.log`). Run `cleanup.mjs --run agent`; the promoted folder goes with the copy, the evidence stays.

## Gotchas

- The tool route reads its key from `config.agentKey` and the header `x-thixo-agent-key`. `thixo dev` writes the key to `.thixo/agent-key` and sets it. A production server has none, so the route answers 404.
- The tool route takes `as`, a user id, and uses the scopes from the identity adapter's `scopesOf`, else the ones saved when that user last got a token. An unknown user with no scopes is a 404 `unknown_user`.
- `submit` needs `thixo.plugins.author` from the user it acts for, in the chat and on the tool route. The registry service underneath does not check it.
- A failed build is a normal result (`ok: false` with `errors` and `report`), not an HTTP error, so a `check` that fails gives status 200.
- The chat stream answers 200 even when the run ends in an `error` event (no model, the model threw, the cap). Read the events, not the status.
- Conversations are held in memory per server, 500 at most. A restart, or a second server process, does not know the id and the chat answers with an `error` event.
- The tools ran against the real compiler through `thixo agent`. The chat loop has only run with `scriptedModel`: before trusting the prompt, send one message in `Ask for a plugin` with `claudeCode()` (the todo config's model, which spends Claude usage) or `anthropic()`.
- Promote writes into the app's `plugins/`. Never run it against `examples/todo` itself; the skill's copy is disposable.
- A fork keeps the plugin's name, so the plugin browser lists two `Todo summary` items. Tell them apart by `by ana` / `personal · by ben`.
- `use` and `fork` do not need `thixo.plugins.author`; `submit` and the chat do.
