# Model adapters

A model adapter is the model behind the authoring chat (U1). `anthropic()` from `thixo-anthropic` runs one streaming Claude API call per turn and turns the stream into text, tool and done events. `anthropic()` from `thixo-anthropic/node` does that with a key and runs the local `claude` command with none, in development.

## Sub-features

- `anthropic-text` streams the reply as text events and ends with `done`.
- `anthropic-tools` yields each tool call complete with parsed input, including two calls in one turn.
- `anthropic-history` sends earlier tool calls and their results back as `tool_use` and `tool_result` blocks.
- `anthropic-no-key` says the key is missing in one text event, then `done`, with no request made.
- `anthropic-error` rejects with the API's status and message.
- `anthropic-keyless-dev` with no key and not in production, `thixo-anthropic/node` runs the local `claude` command and logs `thixo-anthropic: no API key, so using the local `claude` login (development only).` once.
- `anthropic-keyless-production` with no key and `NODE_ENV=production`, it rejects with `The Claude API key is missing. In production...` and never runs `claude`.

## How to get to it (user POV)

- In the todo app, press `Ask for a plugin` as ana. The todo config's model is `anthropic()` from `thixo-anthropic/node`: the API if `ANTHROPIC_API_KEY` is set, else the local `claude` login (see `authoring-chat.md`).
- Pass `model: anthropic()` in the app's Thixo config, set `ANTHROPIC_API_KEY`, and open the authoring chat.
- Pass `anthropic({ apiKey, model, maxTokens, baseUrl })` to override the key, the model (default `claude-opus-5-5`), the reply limit (default 16000) or the endpoint.
- Start the app with no key set and send a message in the chat.

## Driving it with node

There is no key in a verification run, so the Claude API is replaced by a local `node:http` server that replays the shape of the Messages stream. The package's tests are that harness.

Preconditions:

- `npm install` and `npm run build` have run in the repo root.
- `ANTHROPIC_API_KEY` need not be set. The tests set and unset it themselves.

- **Run the suite.** Run `npm test -w thixo-anthropic`. Exit code `0`, and the summary ends with `# fail 0`.
- **Text.** The test named `text deltas stream as text events, then done` passes. The events are three `text` events, then `done`.
- **One tool call.** The test named `one tool call arrives complete with parsed input` passes. The input `{"path":"plugin.thx"}` arrives whole even though it was split across two stream chunks.
- **Two tool calls.** The test named `two tool calls in one turn each arrive complete, in order` passes. Two `tool` events come before `done`, in the order the model sent them.
- **History.** The test named `tool calls and results go back as tool_use and one tool_result user message` passes. The recorded request body holds one assistant message with two `tool_use` blocks, then one user message with two `tool_result` blocks.
- **API error.** The tests named `an API error rejects with the status and message` and `an error event inside the stream rejects` pass.
- **No key, in development.** `no key in development uses the local claude login and logs it once` passes against a fake `claude` script. For the real command, launch the todo app with no key and run the chat journey in `authoring-chat.md`; `dev.log` has the one `using the local claude login` line.
- **No key, in production.** `no key in production fails with a clear error and never runs claude` passes. By hand: `thixo build` then `thixo start` with no key, and send a chat message as ana: the chat shows `The model failed: The Claude API key is missing. In production...`.
- **No key, web-standard entry, by hand.** Run `env -u ANTHROPIC_API_KEY node --import tsx -e 'import {anthropic} from "./packages/thixo-anthropic/src/index.ts"; for await (const e of anthropic().run({system:"s",messages:[{role:"user",text:"hi"}],tools:[]})) console.log(JSON.stringify(e))'`. Stdout is a `text` event that begins `The Claude API key is missing` and then `{"type":"done"}`, with exit code `0` and no network use.
- **Proof.** Save the suite output with `mkdir -p artifacts/verify/model && npm test -w thixo-anthropic > artifacts/verify/model/anthropic.txt`. The file lists every test as passing.

## Gotchas

- The fake server proves the request and stream shapes, not that the real API accepts them. Run once with a real key (`ANTHROPIC_API_KEY=... `, then send a chat message) before trusting a new model id or SDK version.
- The SDK sends the key as `Authorization: Bearer`, not `x-api-key`. Assert on that header in the fake.
- An API error rejects the iterator and does not become an event. Whatever drives the adapter must catch it, or the chat shows nothing.
- A 5xx or 429 is retried by the SDK before it rejects, so a test of those statuses is slow. The tests use 401 and an in-stream error event.
- The missing-key message is a normal reply. A chat that shows it has the adapter wired correctly and only lacks the key.
