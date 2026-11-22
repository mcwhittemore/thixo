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

## Driving it with node

There is no shell chat or real model in a verification run. The server's fetch handler is driven with `scriptedModel` and the in-memory adapters the core tests use, so every route and tool runs for real and only the model and the compiler are doubles. The compiler double reads the manifest from a `// @manifest` comment and fails on `@error`, so build messages are not the real thx messages.

Preconditions:

- `npm install` has run in the repository root. Nothing else needs to be running.

- **Run the suite.** Run `npm test -w thixo`. The summary reads `# fail 0`. The 11 tests in `packages/core/test/authoring.test.ts` cover the cases below by name.
- **Full conversation.** The test named `a conversation searches, checks a broken plugin, fixes it, submits and uses it` passes. Tool calls come in the order `search_registry`, `describe_app`, `check`, `check`, `submit`, `use`. The first `check` result has `ok: false` and a `report` that starts `plugin.thx:1:1 thx/test`. The plugin exists as a personal plugin of `ana` and her layout holds it at `main/todo-detail`.
- **Cap.** The test named `the loop stops at the cap, and defaults to 24 model turns` passes. A run with `maxTurns: 3` ends with an `error` event that starts `Stopped after 3 model turns`, then `done`. A run with no cap makes exactly 24 model turns.
- **Tool error.** The test named `a tool error goes back to the model and the loop carries on` passes. `read_plugin` of a missing plugin gives `plugin_not_found`, an unknown tool gives `unknown_tool`, bad input gives `bad_input`, and the loop still reaches the model's closing text.
- **Untrusted data.** The test named `read_plugin and search_registry wrap what other people wrote as untrusted data` passes. A hostile name, description and source come back inside `<<<UNTRUSTED ... token` and `UNTRUSTED token>>>` markers, and the closing token appears once.
- **Key and scope refusals.** The tests named `the tool route is off without an agent key, and refuses a missing or wrong key` and `the chat route needs thixo.plugins.author, a token, and a model` pass.
- **Driven session.** Run `node --import tsx packages/core/test/drive-authoring.ts`. Expected lines, in order: `chat -> 200 application/x-ndjson; charset=utf-8`, the events (`tool: search_registry`, `tool: check` with `ok=false`, `tool: check` with `ok=true`, `tool: submit`, `tool: use`, the closing `text:`, `done`), then `tool without key -> 401 agent_key_missing`, `tool with wrong key -> 403 agent_key_wrong`, `tool with key -> 200 ok` and `chat as cy (no author scope) -> 403`.
- **Proof.** Run `mkdir -p artifacts/authoring && node --import tsx packages/core/test/drive-authoring.ts > artifacts/authoring/drive.txt && npm test -w thixo > artifacts/authoring/tests.txt`. Both files exist after cleanup, and `tests.txt` ends with `# fail 0`.

## Gotchas

- The tool route reads its key from `config.agentKey` and the header `x-thixo-agent-key`. `thixo dev` writes the key to `.thixo/agent-key` and sets it. A production server has none, so the route answers 404.
- The tool route takes `as`, a user id, and uses the scopes from the identity adapter's `scopesOf`, else the ones saved when that user last got a token. An unknown user with no scopes is a 404 `unknown_user`.
- `submit` needs `thixo.plugins.author` from the user it acts for, in the chat and on the tool route. The registry service underneath does not check it.
- A failed build is a normal result (`ok: false` with `errors` and `report`), not an HTTP error, so a `check` that fails gives status 200.
- The chat stream answers 200 even when the run ends in an `error` event (no model, the model threw, the cap). Read the events, not the status.
- Conversations are held in memory per server, 500 at most. A restart, or a second server process, does not know the id and the chat answers with an `error` event.
- Nothing here ran against the real thx compiler or a real model. Before trusting the prompt, run a chat once with `anthropic()` or `claudeCode()` and a real app.
- `npm run build` at the root fails in `examples/todo` until the thx package is built (`thixo-thx/dist` missing). `npm run build -w thixo` is clean.
