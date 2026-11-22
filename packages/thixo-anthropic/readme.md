# thixo-anthropic

The model adapter for the Claude API. It is what the authoring chat calls when a user asks for a plugin (U1).

```ts
import { defineConfig } from "thixo";
import { anthropic } from "thixo-anthropic";

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

With no key, the adapter yields one text event saying the key is missing, then `done`. The authoring chat shows it
like any reply, so a new app tells the user what to set.

## What it does

One `run(turn)` is one streaming Messages request. The turn's system prompt, messages and tools map to the request's
`system`, `messages` (an assistant message's tool calls become `tool_use` blocks, and consecutive tool results become
one user message of `tool_result` blocks) and `tools`. The stream maps back to events: a text event per delta, one tool
event per call once its input has arrived and parsed, then `done`. Two calls in one turn arrive as two tool events.

An API error, or an error event in the stream, rejects the iterator with the SDK's error, which carries `status`.
It uses the official SDK, which sits on `fetch`, so it runs on Workers as well as Node.

## Tests

`npm test` runs the adapter against a local `node:http` server that replays the shape of the Messages stream: text, one
tool call, two tool calls, an error status and an error event. No key is needed.
