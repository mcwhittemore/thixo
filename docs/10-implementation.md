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
| `packages/create-thixo-app` | `create-thixo-app` | Starts a new app from a template. Run from a checkout, it links the packages and React from it with `file:` deps, since they are not on npm yet. |

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
  A layout names it by its path, the parent's path and its own name: `main/todo-row`.
- `css({...})` turns a style object into a class name. The `style` prop takes the same objects.
- `DateInput` holds a calendar day as midnight UTC, so it reads back as the same day in every time zone.
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
  never a string where an address goes, and wraps each event handler so it gets plain data, not the event. A load
  written in the source is the app's copy (`rt.asset`), never an outside address.
- Values the host hands in are frozen copies.

### Addresses

The owner decided how outside addresses work ([decision 60](08-decisions.md#60-copy-at-build-and-addresses-from-data)).
There are no host lists: `addressHosts` and `linkHosts` are gone.

**A written-out load is copied at build.** An `https://` address written in the source where something loads
(`<img src>`, the only such place today) is fetched once when the plugin is built. Its bytes are stored with the
version, and the compiled code loads the app's copy. The page a plugin runs in never fetches from an outside host
because of something written in plugin source. The build builds like an npm install: there are no outside file refs.

- The compiler stays pure and offline. It puts each such address in the manifest's `loads`, and emits
  `rt.addr(address, "load")`, which the runtime refuses at render ("loads ... from outside the app"). The build
  step (`buildWithCopies` in `packages/core/src/server/registry/assets.ts`) fetches each one through the build
  adapter's `fetchAsset`, then compiles again with `CompileEnv.assets` (address to file), and the compiler emits
  `rt.asset("<sha256>.<ext>")` instead. The manifest keeps the original addresses (`addresses`, `loads`) and says
  what was copied (`assets`).
- Every build goes through that step: a deploy, the authoring agent's `check` and `submit`, `thixo build`, `thixo
  dev` and `thixo compile` (whose `--out` also writes `assets/`).
- A copy that fails is a build error, `build/copy-failed`, at the line that names the address, with a hint: use an
  https address that serves an image or a font, a `data:` address, or a `Url` the app hands in.
- A file is stored through the code adapter under `assets/<sha256>`, and is at most 2 MiB; one version copies at
  most 8 MiB and 32 files. Only images and fonts are copied: png, jpeg, gif, webp, avif, svg, woff, woff2, ttf and
  otf. An SVG with a `<script>`, a `<foreignObject>`, an `on...=` attribute or a `javascript:` address is refused.
- Copies are kept in memory for the process, by address, so `thixo dev` does not fetch again on every change. A
  stored version keeps its copy even if the outside file changes (U2).

**The fetch is guarded.** The server fetches on behalf of whoever wrote the source, so `guardedFetch()` in
`thixo-node` (the default for `localBuild` and `local()`) refuses to reach inside the network: https only, on port
443, no user name or password; the host resolved, and refused if any address it resolves to is loopback, private,
shared, link-local (so `169.254.169.254`), multicast, reserved, documentation, or IPv6 that carries an IPv4 address;
the connection pinned to the address that was checked, so a second lookup can't rebind it; every redirect checked
the same way, at most 3; 10 seconds in all; the size cap enforced while it reads; and the content type checked.
`localBuild(compiler, { fetchAsset })` and `local({ fetchAsset })` take another fetcher, so tests never touch the
network. A build adapter with no `fetchAsset` can't build a plugin that loads from outside.

**Copies are served under the code's rule.** `GET /_thixo/plugins/:id/:n/assets/:file` serves a file the version
copied, and only such a file, to whoever may load the version: a personal plugin's files are its author's. An
`<img>` can't carry a token, so the load route answers with `assets: { path, query }`, where the query is a ticket
bound to the user, the plugin and the version, good for 12 hours and for that version's files only. The shell gives
the runtime `RuntimeHost.assetAddress(file)`, which must return a path on the app. A copy is served with
`x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`,
`cross-origin-resource-policy: same-origin` and, for an SVG, `content-disposition: attachment`, so a copy opened on
its own runs no script and loads nothing.

**A `Url` from the app's data loads whatever its host.** An endpoint result, a slot's context or a `t.url()` field
may hold any address, and a plugin may show it, load it as an image or a style's `url()`, or link to it. The process
of making the plugin did not make that address, so the owner accepts it. A plugin still can't build or change a
`Url` (L7), and the host can't hand it `javascript:` or any scheme but http, https and mailto, a path on the app,
or a `data:` image or font. The server takes for a `t.url()` field only what the runtime can hold as a `Url`.

**A written-out link may go to any https host.** `<a href="https://...">` compiles for any host; `http:` and
`mailto:` written out are refused. Every link opens in a new tab with `rel="noopener noreferrer"`. A plugin that
chooses between fixed links by what it read tells the host one bit on a click, and the owner accepts that. The
registry summary says which hosts a plugin links to ("Links to docs.example.com"), and when there is more than one
link to a host it says "Can choose among N links to <host>: which one you click tells <host> something about what it
read" (G5). A copied load gets "Copied N files from <host> when it was built: they load from this app, never from
<host>".

**The page's CSP** is the second wall, not the first: `img-src 'self' data: https:`, so a handed-in `Url` can load,
and `font-src 'self' data:`. What stops a written-out load from reaching outside is the runtime, which refuses an
outside address from `rt.addr` for a load; the shell also drops an `<img src>` or style `url()` equal to one of the
version's `loads`.

**What remains.** A `Url` someone saved as data, such as a `t.url()` annotation another user can see, is a tracking
pixel: everyone who opens a page that shows it as an image tells its host, with no click. The plugin did not make it,
and choosing among saved `Url`s by what a plugin read still leaks a little. See
[the security model](04-security-model.md#what-p1-does-not-cover).

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
| `GET /_thixo/plugins/:id/:n.js` | The compiled module. A personal plugin is served to its author only. Takes a token, or the ticket the load route puts in `PluginLoad.code` (see below). |
| `GET /_thixo/plugins/:id/:n/load` | `PluginLoad`. |
| `GET /_thixo/plugins/:id/:n/assets/:file` | A file the version copied at build. Same rule as the code. Takes a token, or the ticket in `PluginLoad.assets.query`. |
| `GET /_thixo/layout` | `LayoutReply`. |
| `PUT /_thixo/layout/:slot` | `{ plugin, number }`. Refused when the user lacks a required scope or can't see the plugin, and when no slot reads that path (`unknown_slot`). A child slot's bare name or export name that sits in one place is stored under its path. |
| `DELETE /_thixo/layout/:slot` | Back to the default. |
| `POST /_thixo/data/read`, `read-many`, `patch`, `list`, `remove` | Plugin data. The bodies are `DataBodies` in the core contract: the plugin version and `at: { store, id } \| { record, id }`. `read` answers `{ fields }`, `read-many` `{ fields: [...] }` in the order asked, `list` `{ ids }`, `patch` and `remove` 204. The body names the plugin version. The server works out the chain, checks the fields against that version's schema (D6), and checks the scopes (D11, D12) and the record (A13). |
| `POST /_thixo/data/remove-field` | D7. Needs `thixo.data.admin`. |
| `POST /_thixo/authoring/chat` | `{ conversation?, message }` to the agent's events, as newline-delimited JSON. Needs `thixo.plugins.author`. |
| `POST /_thixo/authoring/tool` | One of the agent's tools, called directly. Off unless the server was started with an agent key, and the request carries it. See below. |

**Plugin code by address.** The page's CSP is `script-src 'self'`, so the shell imports a compiled module by its
address, not from a `blob:`. A module import can't carry the token, so the load route answers with
`code: "/_thixo/plugins/<id>/<n>.js?u=<user>&e=<expiry>&k=<hmac>"`: a ticket signed with the signing key, bound to the
user, the plugin and the version, good for five minutes. It grants reading that one module and nothing else; the
route still applies the author-only rule and re-checks the code (P7).

There is no route that takes plugin source from a browser (P6). A version is stored by the authoring agent, by a
deploy, or by a fork that copies one.

**The author cap (P3).** When the shell loads a version it gets `authorCan`. The author's scopes come from the
identity adapter's `scopesOf`, or from the scopes Thixo last saw for that user. The author of a default plugin is
`implementor`, who holds everything.

**A deploy** takes the folders in `plugins/` and the layout in the config. It builds each folder, finds or stores a
version by `sourceHash`, and writes a release. Each layout key must be a slot path the app has (`main/todo-row`, not
`todo-row`): a layout, or a user's layout change, keyed where no slot reads it would hold a plugin nobody sees. When a
folder the layout names fails to compile, `thixo dev` keeps the last release and says so rather than deploying
without it. A layout entry naming a folder that is not in `plugins/` is refused with the folders there are. Either
way the message is printed once. `thixo dev` and `thixo start` deploy when they start, and `thixo dev`
deploys again when a file in `plugins/` changes.

**Promotion** writes the plugin's source to `plugins/<slug>/` through the code adapter, with the plugin's id in its
`definePlugin` metadata. Locally that is a change in the working tree. It becomes default when the implementor
names it in `layout` in `thixo.config.ts` and deploys. The reply says both: `done` (what was written, and where)
and `next` (the layout line to add, with the slot's path, or that the layout already names the folder), with
`files`, `slotPaths` and `inLayout`.

**Ids.** Only a default plugin's folder has an `id` in its `definePlugin`, so a deploy finds the same plugin each
time. The registry drops an id from submitted source and gives a personal plugin its own. `thixo new plugin
--personal <folder>` writes a plugin with no id, outside `plugins/`.

**Summaries (G5)** come from one place. Each scope's words are the app's, from `defineScopes`, made into a sentence
(`Read todos` reads `Reads todos`); Thixo's own read `Reads its own data`, `Writes its own data` and so on
(`packages/core/src/scope-words.ts`). The registry's summary, the plugin browser's scope list (`todos.read (reads
todos)`), `thixo compile` and `thixo build` all use them.

## The authoring agent

The loop is Thixo's (U4, U5). Its tools: `search_registry`, `read_plugin`, `describe_app` (the SDK, slots and
language reference), `check` (build without storing, copying outside loads as a submit would), `submit` (build and
store a new version of the user's own plugin, or a new plugin), `fork`, `use` (put a version in the user's layout).

`describe_app` lists each slot with its full path and says that path is what `use` takes (`use takes slot:
"main/todo-row"`). `use` refuses a slot path no slot reads, naming the paths there are, and replies with the layout
entry it read back (`resolved`) and `confirmed`; a use that does not read back is `ok: false`. `read_plugin` with
`files: true` also returns each file in its own UNTRUSTED block, which `thixo agent read --out <dir>` writes to a
folder. The default prompt tells the agent to name slots by path, to confirm the layout after `use` before saying a
plugin shows, and to make anything clickable a real button.

Forking does not put the copy in the user's layout. `use` does, so a fork never changes what a user sees by itself.

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
| `thixo compile <folder or file> [--out dir] [--json]` | Builds thx the way the registry does, copying outside loads. Prints the summary in the registry's words (as `agent check` and the plugin browser give it), the scopes, the manifest, or the errors. `--out` writes `plugin.js`, `manifest.json` and `assets/`. |
| `thixo new plugin <name> --slot <slot> [--personal <folder>]` | A new folder in `plugins/`, with an id. The slot is its name or its export name; a slot the app lacks is refused, with the ones it has. Prints the `layout` line with the slot's path. `--personal` writes the plugin to another folder with no id, for `thixo agent submit`. |
| `thixo agent <tool> --as <user> [...]` | The authoring tools, against a running `thixo dev`. Exits 1 on a refusal and on a reply with `ok: false`, printing a failed build's errors once. `read --out <dir>` writes a version's files to a new folder. |
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
  keeps running. So is one the user may not load (G1): a default plugin whose required scopes the user lacks shows
  `<id> stopped: Plugin <name> needs the scope <scope>`.
- **Queries follow writes**: a call to a non-GET endpoint through any plugin makes every `useQuery` on the page ask
  again, so a child slot's plugin shows a change its parent made.
- **`<PluginBrowser />`** is the registry: search, a plugin's summary and scopes (G5), use, fork, share, promote, and
  reset a slot. Each plugin shows its id, and a default the release serves at an older version than its newest says
  so (`PluginSummary.defaultVersion`). Each slot in `Your layout` shows the version it is on and, when the plugin has
  a newer one, `v<n> is newer` with a button `Move <path> to v<n>`; a result in use says `In use: v<n> in <path>`.
  After a fork the status names the copy's id and how to edit it (`thixo agent read --out`); after a promote it says
  what was written and what is left (the layout line). A default plugin carries a `Default` badge and another user's plugin a `From <author>` badge, beside
  the name, not only in the muted caption.
- **`<AuthoringChat />`**: Enter sends and Shift+Enter starts a new line. Each tool call is a line that becomes the
  tool's outcome when it returns (`check passed`, `use put plg_…@2 in main/todo-row (confirmed in your layout)`, or
  `use failed: …`, marked `data-ok="false"`). After a `use` that succeeds the page loads the layout again at once, so
  the slot shows the new version without a reload. The log keeps its newest line in view, and the next message
  carries the conversation id the last turn ended with.
- **Annotations are shared by the record's group.** A field a plugin adds to a record is read and written per the
  record's `group`, so two users in one group see each other's values, whichever plugin wrote them. A store is
  private to each user. A plugin only one user has does not make its data private.
- **What a plugin shows in shell chrome is attributed.** A dialog from `openModal` keeps the plugin's `title` but
  always has a line under it, drawn by the shell outside the plugin's box: "From the plugin “<name>”, by <author>"
  (or "one of this app's own" for the implementor's). The dialog's accessible name is the title and that line. A
  toast carries the same line. The red team's second round drew a "Session expired" sign-in form in a dialog that
  named no plugin at all.
- **Names others see are unique.** Sharing a plugin, or submitting a new version of a shared one, is refused
  (`name_taken`, `registry/name-taken`) when its name matches a default plugin's or another shared plugin's, with
  case, width, spaces and punctuation folded away. A personal plugin may take any name, since only its author sees
  it. A fork keeps its parent's name and is renamed before it is shared.

## Verification

`npm run e2e` runs `tests/e2e/*.e2e.mjs`. `todo.e2e.mjs` runs `thixo dev` on a temp copy of `examples/todo` and
drives it in headless Chromium as each user, with the agent path through `thixo agent`. `crm.e2e.mjs` does the same
for `examples/crm`. `security.e2e.mjs` replays the red team's findings against the todo example, with an outside
listener on another port that must hear nothing, and with the page's CSP turned off where the language must hold
on its own.

`.claude/skills/verify-thixo/` is the project's verification skill, in the shape pstack's
`create-verification-skill` gives. Each part of the build adds a file to its `features/` for what it made. A change
to a feature updates its file.

## Left for later

A hosted build adapter, with its own guarded fetch. The Cloudflare, Vercel and AWS packages. Teams as a concept
(grouping is a function the implementor writes). Registry search by meaning: search here matches words.
