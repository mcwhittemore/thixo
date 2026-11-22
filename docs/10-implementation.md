# Implementation

How the first build realises the other docs. Where a doc leaves something open, this page says which lean the
build took. None of these choices is a requirement: a choice here that turns out wrong is changed here, and one that
should bind every implementation goes through the [decisions log](08-decisions.md) first.

The two files of types are the contract between packages. This page is the prose around them.

- [`packages/thx/src/contract.ts`](../packages/thx/src/contract.ts): the compiler and the in-page runtime.
- [`packages/core/src/contract.ts`](../packages/core/src/contract.ts): the app, the adapters, and what the shell asks
  the server.

## Packages

An npm workspace. Node 22.13 or later. TypeScript 5.9, because the compiler uses its parser and checker as a
library.

| Folder | npm name | What it owns |
| --- | --- | --- |
| `packages/thx` | `thixo-thx` | The plugin language, thx: compiler, output verifier, in-page runtime. The wall. |
| `packages/core` | `thixo` | `thixo`, `thixo/api`, `thixo/schema`, `thixo/slots`, `thixo/server`, `thixo/shell`. No provider code (X4). |
| `packages/thixo-sql` | `thixo-sql` | The data adapter, on a small SQL driver interface. |
| `packages/thixo-node` | `thixo-node` | Local adapters: files for code, `node:sqlite` for data, an in-process build, a Node HTTP server, a Claude Code model adapter. |
| `packages/thixo-anthropic` | `thixo-anthropic` | The model adapter for the Claude API. |
| `packages/cli` | `thixo-cli` | The `thixo` command. |
| `packages/create-thixo-app` | `create-thixo-app` | Starts a new app from a template. |

## The language is called thx

A plugin is a folder of `.thx` files: `plugin.thx`, an optional `data.thx`, and any other `.thx` file it imports by
a relative path. The extension settles the open question about `.tsx` telling a reader a lie.

### What a plugin imports

| Specifier | Exports | Who implements it at run time |
| --- | --- | --- |
| `thixo/plugin` | `definePlugin`, `useState`, `useMemo`, `useEffect`, `useQuery`, `useCan`, `useAnnotation`, `useAnnotations`, `useStore`, `useStoreList`, `ChildSlot`, `css` | The shell's plugin host |
| `thixo/ui` | `Stack`, `Text`, `Button`, `TextInput`, `NumberInput`, `DateInput`, `Checkbox`, `Select`, `Badge`, `Card`, `tokens` | The shell |
| `thixo/data` | `annotate`, `store` | The shell's plugin host. The compiler reads the calls as literals (U7) |
| `thixo/schema` | `t` | Same |
| `thixo/services` | `navigate`, `openModal`, `copyToClipboard`, `download`, `toast` | The shell (S8). Each one imported is a shell service in the manifest |
| `@app/sdk` | One function per endpoint, and each record | The broker |
| `@app/sdk/optional` | The same functions, imported as optional (P2) | The broker |
| `@app/slots` | Each slot the app defines | Generated |
| An exposed library | Whatever the implementor exposed (L3) | The implementor's module, wrapped at the boundary |

`react` is not importable. `useState` and the other hooks come from `thixo/plugin`.

The hooks:

- `useQuery(endpoint, input?)` returns `{ data, error, loading, refresh }`. For an optional endpoint the user can't
  call, it loads nothing and `data` stays undefined.
- `useCan(endpoint)` returns a boolean (P4).
- `useAnnotation(decl, recordId)` returns `[fields | undefined, patch]`. `useAnnotations(decl, recordIds)` returns a
  `Map` of id to fields, read in one call.
- `useStore(decl)` returns `[fields | undefined, patch]` for the user's one record in that store.
  `useStoreList(decl)` returns `{ records, create, patch, remove }` for a store with many records.
- `ChildSlot` places a child slot the parent slot's contract declares (S13): `<ChildSlot is={todoRow} context={...} />`.
- `css({...})` turns a style object into a class name. The `style` prop takes the same objects.
- A component gets `{ context, emit }`. `emit.select({ todoId })` sends an event the slot declares (S11).

### Data declarations

```ts
import { annotate, store } from "thixo/data";
import { t } from "thixo/schema";
import { Todo } from "@app/sdk";

export const due = annotate(Todo, { dueOn: t.date() });
export const prefs = store("prefs", { fields: { warnDaysBefore: t.number() } });
```

A field is one of `t.string()`, `t.number()`, `t.boolean()`, `t.date()`, `t.url()`, `t.array(t.string())` or
`t.array(t.number())`. These calls are allowed only at the top of a file, as the value of an exported `const`, with
literal arguments.

`definePlugin(slot, { name, description, id? }, Component)` is the default export of `plugin.thx`. Its second
argument is a literal. `id` is there on a default plugin's folder and names the plugin it publishes to.

### How the wall is built

The compiler works from what is allowed (L1). It parses with TypeScript's parser, walks the tree against a list of
the syntax it knows, and rejects every node that is not on it. The type check runs after, against a library of
thx's own (`noLib`), so `window` is not a type error to be suppressed but a name that does not exist.

The emitted module is `export default function (rt) { ... }` and names nothing but `rt` and what it declares
itself. `verifyOutput` parses the emitted code again and proves that. It runs on every build, and the plugin route
refuses to serve code that fails it.

In the emitted code:

- Every field read, by a fixed name or a computed one, goes through a guard. A record has only its own fields.
  A list, string, number, `Map`, `Set`, `Date` or promise has the language's methods and nothing else. A function
  has no fields at all. So does an element.
- Every call of a method goes through the guard too, so `list.map` is always the language's `map`.
- Every loop body and function entry counts against a budget. Each entry from the host (a render, an event
  handler, a resumed `await`) starts a new count.
- Every element goes through one function that checks its tag and attributes against a list, takes a `Url` and
  never a string where an address goes, and wraps each event handler so it gets plain data, not the event.
- Values the host hands in are frozen copies.

### Addresses

Copy at build is the lean in [the language](05-language.md#choosing-between-fixed-addresses). This build takes the
second option, which needs no fetch at build: an address that loads something (`<img src>`, a style's `url()`) must
be a `data:` address or on a host in `addressHosts` in the config, which is empty by default. A link the user
clicks, `<a href>`, may point anywhere when it is written out in the source, and opens in a new tab with
`rel="noopener noreferrer"`. Every outside address is in the manifest.

## The app

```
api/               endpoints, records and scopes: every export is collected
app/slots.ts       the slots
app/shell.tsx      the base app, default export
plugins/<name>/    the default plugins
thixo.config.ts
```

- `thixo/api`: `endpoint({ method, path, scopes, input?, output?, handler })`, `record(name, { read, fields,
  canRead?, group? })`, `defineScopes({...})`. An endpoint's name is its export name.
- `thixo/schema`: `t.string()`, `t.number()`, `t.boolean()`, `t.date()`, `t.url()`, `t.array(x)`, `t.object({...})`,
  `t.optional(x)`. A record is a schema too, so `t.array(Todo)` works. `t` values carry their `SchemaJson` and
  validate.
- `thixo/slots` (also exported from `thixo/shell`): `slot.page`, `slot.panel`, `slot.widget`, `slot.custom`, each
  taking `{ name, context?, contextScopes?, emits?, children?, size? }`.
- `thixo/shell`: `Shell`, `Slot`, `AuthoringChat`, `PluginBrowser`, `mount`, and the generated API SDK's client.
  `<Slot is={main} context={...} on={{ select: fn }} />`.
- `thixo`: `defineConfig`.

`thixo/shell` resolves to the React-free `thixo/slots` under Node, so `app/slots.ts` can be loaded by the server.

## The server

`createThixo(app, config)` in `thixo/server` returns `{ fetch(request): Promise<Response>, deploy(...) }` (X3).

| Route | What |
| --- | --- |
| `POST /_thixo/token` | Trades the session for a token (A4). The identity adapter says who and which scopes. HS256, 15 minutes, scopes as a claim (A5). |
| `GET /_thixo/app` | `AppInfo`. |
| `GET /_thixo/sdk.js` | The API SDK (A9): an ES module, one function per endpoint, each taking `(input, { token })`. |
| `ALL /api/...` | The implementor's endpoints. The token is verified and its scopes checked before the handler runs (A3, A4). Input is validated. |
| `GET /_thixo/registry/search?q=&slot=` | `PluginSummary[]`: shared and default plugins, and the user's own, that the user holds the required scopes for (G1). |
| `GET /_thixo/registry/plugins/:id` | `PluginSummary`, with its versions. |
| `POST /_thixo/registry/plugins/:id/fork` | `{ version, empty? }` to a new personal plugin whose first version has the same source (G4, D9). |
| `POST /_thixo/registry/plugins/:id/share` | Personal to shared. The author only, with `thixo.plugins.share`. |
| `POST /_thixo/registry/plugins/:id/promote` | Asks the promotion adapter, then opens a change in `plugins/` through the code adapter (G3). |
| `GET /_thixo/plugins/:id/:n.js` | The compiled module. A personal plugin is served to its author only. |
| `GET /_thixo/plugins/:id/:n/load` | `PluginLoad`. |
| `GET /_thixo/layout` | `LayoutReply`. |
| `PUT /_thixo/layout/:slot` | `{ plugin, number }`. Refused when the user lacks a required scope or can't see the plugin. |
| `DELETE /_thixo/layout/:slot` | Back to the default. |
| `POST /_thixo/data/read`, `read-many`, `patch`, `list`, `remove` | Plugin data. The body names the plugin version. The server works out the chain, checks the fields against that version's schema (D6), and checks the scopes (D11, D12) and the record (A13). |
| `POST /_thixo/data/remove-field` | D7. Needs `thixo.data.admin`. |
| `POST /_thixo/authoring/chat` | `{ conversation?, message }` to the agent's events, as newline-delimited JSON. Needs `thixo.plugins.author`. |
| `POST /_thixo/authoring/tool` | One of the agent's tools, called directly. Off unless the server was started with an agent key, and the request carries it. See below. |

There is no route that takes plugin source from a browser (P6). A version is stored by the authoring agent, by a
deploy, or by a fork that copies one.

**The author cap (P3).** When the shell loads a version it gets `authorCan`. The author's scopes come from the
identity adapter's `scopesOf`, or from the scopes Thixo last saw for that user. The author of a default plugin is
`implementor`, who holds everything.

**A deploy** takes the folders in `plugins/` and the layout in the config. It builds each folder, finds or stores a
version by `sourceHash`, and writes a release. `thixo dev` and `thixo start` deploy when they start, and `thixo dev`
deploys again when a file in `plugins/` changes.

**Promotion** writes the plugin's source to `plugins/<slug>/` through the code adapter, with the plugin's id in its
`definePlugin` metadata. Locally that is a change in the working tree. It becomes default when the implementor
names it in `layout` in `thixo.config.ts` and deploys.

## The authoring agent

The loop is Thixo's (U4, U5). Its tools: `search_registry`, `read_plugin`, `describe_app` (the SDK, slots and
language reference), `check` (build without storing), `submit` (build and store a new version of the user's own
plugin, or a new plugin), `fork`, `use` (put a version in the user's layout).

Three ways to drive it:

1. `<AuthoringChat />` in the shell, with a model adapter (U1). `thixo-anthropic` needs `ANTHROPIC_API_KEY`.
   `claudeCode()` from `thixo-node` runs the local `claude` command and needs no key.
2. A scripted model adapter, for tests.
3. `thixo agent <tool> --as <user>` from the command line, in development. An outside coding agent is the authoring
   agent, and uses the same tools as a named user. `thixo dev` writes a key to `.thixo/agent-key`, and the tool route
   refuses a request without it. A production server has no key, so the route is off.

## The command

| Command | What |
| --- | --- |
| `thixo dev [dir] [--port 3000]` | Builds the app, deploys, serves, and rebuilds on change. |
| `thixo build [dir]` | Builds into `.thixo/build/`: the server bundle, the shell bundle, the SDK, each default plugin. Fails on any plugin error. |
| `thixo start [dir]` | Serves a build. |
| `thixo compile <folder or file> [--out dir] [--json]` | Compiles thx. Prints the manifest and summary, or the errors. |
| `thixo new plugin <name> --slot <slot>` | A new folder in `plugins/`, with an id. |
| `thixo agent <tool> --as <user> [...]` | The authoring tools, against a running `thixo dev`. |
| `thixo registry list` / `thixo release` | What the local registry holds, and the current release. |

The build uses esbuild twice: `api/`, `app/slots.ts` and the config for Node, and `app/shell.tsx` for the browser.
State lives in `.thixo/`: `data.sqlite`, `code/`, `signing-key`, `agent-key`, `build/`.

## The shell

`<Shell>` gets a token, keeps it in memory, and runs the broker. `<Slot>` reads the layout, loads the version's
`PluginLoad` and compiled module, makes a runtime for it, and renders its component inside the slot's box.

- **The broker** is a closure the plugin's SDK functions call. It checks the manifest and `authorCan` before every
  call (P1, P3), and holds the token (P5). A refused call rejects with an error the plugin can catch.
- **The box**: `contain: layout paint style`, `overflow: auto`, `isolation: isolate`, `position: relative`.
- **Errors**: a plugin that throws or runs out of budget is replaced, in its slot, by a message. The rest of the app
  keeps running.
- **`<PluginBrowser />`** is the registry: search, a plugin's summary and scopes (G5), use, fork, share, promote, and
  reset a slot.

## Verification

`.claude/skills/verify-thixo/` is the project's verification skill, in the shape pstack's
`create-verification-skill` gives. Each part of the build adds a file to its `features/` for what it made. A change
to a feature updates its file.

## Left for later

Copy at build for addresses. A hosted build adapter. The Cloudflare, Vercel and AWS packages. Teams as a concept
(grouping is a function the implementor writes). Registry search by meaning: search here matches words.
