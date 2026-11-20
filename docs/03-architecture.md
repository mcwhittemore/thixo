# Architecture

How the parts fit. Most of this follows from requirements marked Proposed, so it is a design to test, not a settled
one. Where a section depends on a requirement, it says which.

## The parts

| Part | Where it runs | What it does |
| --- | --- | --- |
| API | Server | The implementor's endpoints. Issues tokens and enforces scopes. |
| Plugin data | Server | The store and annotations, as fixed endpoints in the API. |
| Registry | Server | Stores versions, builds them, derives manifests, answers searches. |
| Plugin route | Server | Serves a built plugin with the headers that isolate it. |
| Authoring agent | Server | Writes plugins from a chat. Uses the registry's build and search. |
| Shell | Browser | The base app. Places slots, loads plugins, runs the broker. |
| Plugin | Browser, in a sandboxed frame | Renders into its slot. Calls the SDK. |

Tailor owns all of these except the endpoint handlers and the shell's own content.

## What the implementor writes

Following Next.js, Tailor reads an app from its folders:

```
api/        endpoints, each with its scopes
app/        the shell: the always-on app and its slots
plugins/    the default plugins, one folder each
tailor.config.ts
```

From `api/`, Tailor generates the SDK. From `app/`, it knows the slots. From `plugins/`, it builds the default
plugins through the same pipeline a user's plugin goes through.

## From source to a running plugin

```mermaid
flowchart TD
  A[Author describes a plugin in the chat] --> B[Agent writes source]
  B --> C{Build checks}
  C -- fail --> B
  C -- pass --> D[Registry stores source as a new version]
  D --> E[Registry builds the bundle and derives the manifest]
  E --> F[Version is personal: only the author has it]
  F --> G[Author shares it: the registry lists it]
  G --> H[Another user finds it, uses it or forks it]
```

The build checks and what the manifest holds are in the [security model](04-security-model.md#at-build). The checks
are the same whether the source came from the agent, a person or the implementor's `plugins/` folder (U4, U8).

## What happens on a call

A plugin calls `updateTodo(...)`. The plugin holds no token and can't reach the network (P8, P11).

```mermaid
sequenceDiagram
  participant P as Plugin (sandboxed frame)
  participant B as Broker (shell)
  participant A as API
  P->>B: call updateTodo, over the message channel
  B->>B: is updateTodo in this version's manifest?
  B->>A: request with the narrowed token for this user and version
  A->>A: verify the token, check the endpoint's scopes
  A-->>B: result
  B-->>P: result
```

Two checks happen:

1. **The broker** refuses an endpoint that isn't in the version's manifest. This gives a fast, clear error.
2. **The API** verifies the narrowed token. The token names the user and the plugin version. The API accepts it only
   for an endpoint in that version's manifest, and only within the user's scopes (P9).

The second check catches a broker that forwards a call it should have refused. It does not protect against a shell
that lies about which plugin is calling: the API can't see the plugin, only what the shell tells it. What the design
trusts, and why, is in the [security model](04-security-model.md#what-is-trusted).

### Where the narrowed token comes from

1. The shell asks Tailor's API layer for a token for one plugin version, using the user's ordinary session.
2. Tailor calls the implementor's identity function to learn who the user is and which scopes they hold (A9).
3. Tailor signs a short-lived token naming the user and the version.
4. The broker keeps it and attaches it to that plugin's calls. The plugin never sees it (P8).

The manifest records endpoints, not scopes. Scopes are looked up from the endpoints when a token is checked, so a
change to an endpoint's scopes takes effect without rebuilding any plugin.

## Loading a plugin

1. The shell reads the user's layout to see which version fills each slot (S10).
2. For each filled slot, the shell renders a sandboxed frame pointed at the plugin route.
3. The plugin route returns Tailor's host document and the built bundle, with headers that block network access and
   limit who can frame it.
4. The host document runs first. It removes the browser features a plugin must not have, opens a message channel to
   the shell and loads the bundle.
5. The shell sends the slot's context, the design tokens and which of the plugin's endpoints the current user can
   call.
6. The plugin renders. It reports its height back so the shell can size the frame.

## The SDK

The SDK a plugin imports is a thin stub. Each function sends a message to the broker and waits for the reply.

- **One function per endpoint,** generated from the API definition (A10).
- **Two import paths.** `@app/sdk` for endpoints the plugin requires. `@app/sdk/optional` for endpoints it can work
  without (P4).
- **A plugin can ask about any endpoint it imports:** whether the current user may call it (P5).
- **Records come from the SDK too.** A plugin imports a record to annotate it, and gets its type.
- **Fixed modules for plugin data and shell services,** which are the same in every app.

The names `@app/sdk` and `tailor/...` are placeholders.

## Scopes, end to end

```mermaid
flowchart LR
  E[Endpoint declares scopes] --> S[SDK function generated]
  S --> I[Plugin imports it]
  I --> M[Build derives the manifest]
  M --> R[Registry filters search by the user's scopes]
  M --> T[API issues the narrowed token]
```

The scopes are written once, on the endpoint. Everything after that is derived (P2).

## Slots

A slot has a kind and a contract.

- **Kind:** page, panel or widget (S6). The kind sets how the frame is sized and where it can appear.
- **Contract:** the context the shell passes in, such as which todo is selected, and the events a plugin can send
  back, such as "this todo was picked" (S11).

The app defines each slot once. The shell places it, and a plugin targets it, by importing that definition. A slot
holds one plugin or any number (S12), and the user's layout says which.

## What is not designed yet

- How two different plugins work over the same data. See [open questions](08-open-questions.md#2-how-do-two-plugins-share-data).

- How the build runs on each provider. See [portability](06-portability.md#build).
- What happens to existing plugins when the API changes. See [open questions](08-open-questions.md#api-changes).
- How a plugin acts without rendering, such as a button the shell draws. See
  [open questions](08-open-questions.md#slot-kinds).
