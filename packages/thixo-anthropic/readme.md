# thixo-anthropic

The one place an implementor goes for Claude as the authoring chat's model (U1). It has two entries.

- `thixo-anthropic/node` is what an app on Node uses. `anthropic()` there calls the Claude API when a key is set
  (`apiKey`, else `ANTHROPIC_API_KEY`). With no key, in development, it runs the local `claude` command, so a machine
  that is signed in to Claude Code works with no key. It logs one line, on the first turn, saying which it chose. With
  no key in production (`NODE_ENV=production`, which `thixo start` sets) it fails with a clear error. It also exports
  `claudeCode()`, the local-`claude` adapter by itself, which `thixo-node` re-exports.
- `thixo-anthropic` is web-standard (X3): `anthropic()` calls the API only, and with no key it replies that the key is
  missing. It never starts a process, so it runs on Workers and other targets.

```ts
import { defineConfig } from "thixo";
import { anthropic } from "thixo-anthropic/node";

export default defineConfig({
  // ...
  model: anthropic(),
});
```

## Options

| Option | Default |
| --- | --- |
| `apiKey` | `ANTHROPIC_API_KEY` |
| `model` | `claude-opus-5-5` |
| `maxTokens` | `16000` |
| `baseUrl` | the Claude API |

`thixo-anthropic/node` also takes `local` (options for the `claude` command: `model`, `command`, `timeoutMs`,
`extraArgs`), `log` and `production`. The local path runs `claude -p` with no tools, no project context and a temporary
working directory. It still uses the signed-in account and costs usage.

With no key, the web-standard `anthropic()` yields one text event saying the key is missing, then `done`. The
authoring chat shows it like any reply, so a new app tells the user what to set.

## What it does

One `run(turn)` is one streaming Messages request. The turn's system prompt, messages and tools map to the request's
`system`, `messages` (an assistant message's tool calls become `tool_use` blocks, and consecutive tool results become
one user message of `tool_result` blocks) and `tools`. The stream maps back to events: a text event per delta, one tool
event per call once its input has arrived and parsed, then `done`. Two calls in one turn arrive as two tool events.

An API error, or an error event in the stream, rejects the iterator with the SDK's error, which carries `status`.
It uses the official SDK, which sits on `fetch`, so it runs on Workers as well as Node.

## Tests

`npm test` runs the API path against a local `node:http` server that replays the shape of the Messages stream: text, one
tool call, two tool calls, an error status and an error event. No key is needed. The API path has only been run
against that fake, never the real API, because no key was available. The local path has been run for real, through
`thixo dev` on examples/todo, and its parts are tested against a fake `claude` script.
