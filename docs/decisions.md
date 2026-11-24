# Decisions

What has been decided, with the reason and what was turned down. Entries 1 to 60 were made for the framework Thixo
started as; that framework is kept at the `framework-v0` tag, and links in those entries point at documents that
live there now.

New decisions go at the bottom. To reverse one, add a new entry that names the one it replaces. Don't edit history.

## 2026-11-19: founding discussion

Every decision in this section was settled by Matthew Whittemore, the project's owner, in the discussion that
started the project.

### 1. A framework, not an app

Thixo is a framework in the vein of Next.js. Its user is a developer building a malleable product for other people.

- **Why:** the hard parts (containment, data that survives change, common ground) are the same for every such
  product.
- **Turned down:** describing product flows, such as "the chat searches before it creates". Thixo exposes the
  capability. The flow is the implementor's.
- **Requirements:** W1, W2.

### 2. Four parts

An API with scopes, a base React app with slots, an authoring chat with versioned storage, and a registry aware of
permissions.

- **Why:** these were the starting sketch, and each later decision fits inside one of them.
- **Requirements:** A1, S1, U1, G1, G2.

### 3. The API issues tokens and enforces scopes

Plugins do not create tokens. The API creates them and decides what is allowed. Tokens are JWTs with scopes as
claims. A plugin must be able to learn what the user may do, so it can gray out the rest.

- **Why:** enforcement belongs in one place, and it has to be the server.
- **Requirements:** A5, A6, P5, P6.

### 4. Each endpoint carries its scopes

An endpoint can need more than one scope.

- **Why:** one scope per endpoint was too simple for real APIs. This also changed the unit a plugin works with: it
  imports endpoints, and its scopes are the union of what they need.
- **Requirements:** A2.

### 5. The SDK is the source of truth for a plugin's scopes

Which SDK calls a plugin can make defines its scopes. There is no list to maintain.

- **Why:** a hand-written list drifts from the code and can lie. The registry's search depends on it being true.
- **Turned down:** a manifest the author writes.
- **Requirements:** P2, P3.

### 6. Going past its scopes must be impossible

A plugin declaring one thing and doing another has to be impossible, not unlikely.

- **Why:** a plugin runs in front of users with more access than its author. The first users are colleagues in one
  company, and the design must hold for a stranger.
- **Turned down:** treating declared scopes as a usability hint with the user's full token behind them.
- **Requirements:** P1, W3, W4.

### 7. Users don't grant scopes per plugin

- **Why:** a permission prompt per plugin is poor to use and people stop reading it.
- **Requirements:** P7.

### 8. The constraint is at the slot

Thixo fixes what a plugin receives from its slot. It does not fix what the plugin renders. Design tokens and
primitives ship as defaults.

- **Why:** the software should be malleable, not constrained. A locked component library would undo the point.
- **Requirements:** S2, S3, S4, S5.

### 9. Plugin data lives in two fixed resources

A store for the plugin's own records and annotations on the app's records. The API stays a fixed writing surface,
and its versioning stays outside the plugin space.

- **Why:** plugins need their own data, and letting them change the API would make every plugin an API migration.
- **Requirements:** A7, A8, D1.

### 10. Data schemas are hashed and tracked

A stable hash of a version's fields and types is part of the plugin's interface, computed on submission. Changes
that would lose data are flagged. Forward capability must be kept.

- **Why:** it makes a data change visible at the moment it is submitted.
- **Requirements:** D3, D4, D5.

### 11. A compatible fork can read its parent's data

- **Why:** this is what lets someone change a colleague's plugin without starting from nothing. It was called out
  as key.
- **Requirements:** D9.

### 12. Versions are distinct, with no branches

Every version is kept, in object storage. A fork is a copy that remembers where it came from.

- **Why:** branches and merges are a developer's model. Users need "the one I'm using" and "the one I started from".
- **Requirements:** U2, U3, G4.

### 13. Plugins move from personal to shared to default

- **Why:** without a path between them, the plugins an implementor ships and the ones users write are separate
  worlds, and a good personal plugin can never become common ground.
- **Requirements:** G3.

### 14. Search is a capability the authoring agent can use

The registry exposes search. The agent can call it as a tool.

- **Why:** finding a colleague's plugin before building a new one is how the same tool stops being built three
  times. As a capability, it leaves the flow to the implementor.
- **Requirements:** U9, G1.

### 15. No cloud lock-in

Storing and reading plugin code must be pluggable. The first proof of concept runs on Cloudflare. Vercel and AWS
must be supported.

- **Why:** an implementor choosing a framework should not also be choosing a cloud.
- **Requirements:** X1, X2, X3, X4.

### 16. Requirements before code

The first step is a clear set of requirements. The framework does not need to exist yet, and intent is refined
before code is accepted.

- **Why:** the decisions above are cheap to change in a document and expensive to change in a framework.

### 17. Tailor is a working title

- **Why:** it states the property directly, and "tailorable systems" is an older term for user-customisable
  software. It collides with an existing company. See [open questions](09-open-questions.md#name).

## 2026-11-19: after the first review

Settled by Matthew Whittemore after reading the first draft.

### 18. Scopes are about API calls, not data

A scope says which calls a caller can make. It does not say which data a caller sees. There are no field-level
permissions.

- **Why:** Thixo provides security by enforcing scopes. What an endpoint returns is the app author's to get right.
- **Turned down:** a scope on a record field, with the framework leaving the field out for callers without it. Data
  that needs another scope gets its own endpoint.
- **Requirements:** A12.

### 19. Using a plugin is the agreement

The registry shows what a plugin uses, and a user choosing to use it is the agreement. Scopes are a fact read from
the code, not something to negotiate.

- **Requirements:** P15, G5. Consistent with decision 7.

### 20. A plugin never runs with more than its author could do

- **Why:** it stops a plugin written by someone with little access from acting with an admin's access when the
  admin picks it up.
- **Requirements:** P14.

### 21. A field's type never changes

A different type needs a new field with a new name.

- **Why:** a version must never read a value in a shape it doesn't expect.
- **Turned down:** treating the same name with a new type as a second field.
- **Requirements:** D8.

### 22. The name is Thixo

Replaces decision 17. From "thixotropic": a material that holds its shape at rest and flows when you work it, as
potter's clay slip does. The API, slots and scopes hold firm while plugins flow.

- **Why:** it states the property, and a check on 2026-11-19 found no software product, framework or company using
  it. On npm, `thixo`, `thixojs`, `create-thixo` and the `@thixo` scope had nothing published.
- **Turned down:** Tailor, which collides with Tailor Platform, an active React framework for business apps with a
  `tailor` command-line tool. Also clay, putty, Greenware, Clathem and Pliant.
- **Not done:** nothing has been registered or claimed. The GitHub account name `thixo` is taken; `thixojs` and
  `thixodev` were free.

## 2026-11-20: reviewing the concepts

Settled by Matthew Whittemore while revising the concepts doc.

### 23. The broker enforces what a plugin may call

Every call carries the user's own token, not a token narrowed to one plugin. The broker holds each plugin to the
endpoints in its version's manifest and to its author's scopes. The API checks the user's scopes.

Changes part of decision 3: the server still issues tokens and enforces the user's scopes, but holding a plugin to
its manifest moves to the broker. Decision 6 still holds: going past its scopes stays impossible for the plugin,
because only the broker can reach the API.

- **Why:** a token per plugin on the page is extra machinery for little gain. The shell is already trusted, so the
  per-plugin token only caught a broker with a bug.
- **Turned down:** a narrowed token per user and plugin version, checked by the API.
- **Requirements:** A5, P9.

## 2026-11-20: the coding layer

Settled while working through the isolation spike and the coding layer.

### 24. Plugins are written in a language of Thixo's own

Settled by Matthew Whittemore on 2026-11-20. The language is new, and it looks a lot like JavaScript, TypeScript
and React. This is P20.

- **Why:** only Thixo's agent writes plugins, so Thixo can control the language they are written in. A sandbox
  solves a problem Thixo does not have to have. The [spike](04-security-model.md#the-spike) showed what the
  sandboxed frame costs. Looking like TypeScript and React keeps the agent able to write it well.
- **Turned down:** full TypeScript. Also a subset of TypeScript with Thixo's compiler, which was the lean before
  this decision.
- **Not decided:** what runs the language, and whether the sandboxed frame goes. P10, P11 and P16 to P19 are
  still Proposed. See [the coding layer](05-language.md).

### 25. A plugin can't import outside code

Settled by Matthew Whittemore on 2026-11-20. A plugin can't install an npm package or import code from outside.
Thixo can expose libraries for plugins to use, as it does with React. This is P21.

- **Why:** outside packages are JavaScript, not Thixo's language, so importing one would bring in code the
  language does not control.
- **Not decided:** which libraries Thixo exposes, and whether an implementor can expose their own.

### 26. The implementor decides which libraries plugins can use

Settled by Matthew Whittemore on 2026-11-20. It answers what decision 25 left open. Thixo provides the way to
expose a library to plugins. The implementor decides which libraries their app exposes. This is P22.

- **Why:** Thixo is a framework. It creates the capability and does not make the call.
- **What follows:** an exposed library is outside Thixo's language, so the implementor is trusting it.
- **Not decided:** how a library is exposed, where it runs and what Thixo checks about it.

### 27. A plugin can write raw elements

Settled by Matthew Whittemore on 2026-11-20. A plugin can write raw HTML and SVG elements such as `<div>` and
`<svg>`, not only components that Thixo or the implementor expose. This is P23.

- **Why:** it keeps S3. The software is meant to be malleable, not limited to a set of components.
- **Turned down:** exposed components only, which would have been a much smaller surface to secure.
- **What follows:** Thixo has to check every element and attribute a plugin creates against a list.
- **Not decided:** which elements and attributes are on the list, and who can extend it.

### 28. A plugin can't create an element that brings in another source

Settled by Matthew Whittemore on 2026-11-20. It limits decision 27. A plugin can't create every kind of element:
no frames, no script tags, nothing that brings in other sources. This is P24.

- **Why:** what matters is what a plugin can do with an element, not that it can describe one. An element that
  loads outside code or content does something the language does not control.
- **Not decided:** the full list, who can extend it, and whether an image, font or CSS `url()` from an outside
  address counts. Read strictly, it does.

### 29. Decision 28 is about runnable sources

Settled by Matthew Whittemore on 2026-11-20. It corrects the wording of decision 28 and of P24. What a plugin
can't create is an element that brings in another runnable source: code from elsewhere, or a frame that runs it.

- **What follows:** an image, a font or a CSS `url()` from an outside address is not covered by P24, because it
  runs nothing.
- **Not decided:** whether those are allowed. They send a request whose address can carry data out, which is the
  question P11 asks.

### 30. A plugin can't build an address

Settled by Matthew Whittemore on 2026-11-20. An address in a plugin is either written out in its source or
handed to it from outside the plugin. A plugin can't build or change one. A field that holds an address is
declared as one, and a plugin can only write an address to it, never a string. This is P25.

- **Why:** an image, link, font or style address runs nothing, but the request it sends can carry data out. If a
  plugin can't build an address, it can't put data in one, and no list of allowed hosts is needed.
- **Not decided:** what to do about a plugin choosing between many fixed addresses, which leaks by the choice.
  See [the language](05-language.md#choosing-between-fixed-addresses).

## 2026-11-20: reviewing the requirements

Settled by Matthew Whittemore while revising the requirements doc.

### 31. W3 is not a requirement

The first target being a team in one company is context on how Thixo rolls out, not something the product must do.
W3 is cut. W4 still makes the design hold for strangers.

### 32. The API has two sides

The implementor's endpoints are one side. Thixo's side, the same in every app, handles plugins and their versions,
the registry, plugin data, authors and authoring, and it issues tokens and checks scopes for both sides.

- **Requirements:** A1, A5.

### 33. Only every-scope endpoints, for now

A4 is cut. Any-one-of-several scopes is a fine idea that Thixo doesn't support today, so it is not a requirement
that it never will. A3 says what is supported.

### 34. Identity is an adapter

Thixo does not own identity. An identity adapter says who the user is and which scopes they hold. Thixo ships
adapters for services such as Clerk, WorkOS, Auth0 and Cognito, and an implementor can write their own.

- **Turned down:** a plain identity function as the only way in.
- **Requirements:** A9.

### 35. Thixo serves an API SDK

Thixo generates an API SDK for the base app, one function per endpoint, and serves it from a route in the
deployment so it never has to be published elsewhere. It is not the plugin SDK.

- **Requirements:** A10.

### 36. The implementor declares annotatable records and who sees annotations

The implementor says which records plugins can annotate, the scopes that read one, and who sees an annotation on
it, as a grouping of users from one person to everyone. How a grouping is defined is open.

- **Requirements:** A11, A13.

### 37. The implementor defines the slots

Changes part of decision 8, which backed a short, fixed set of slot kinds (S5). There is no layer of kinds: the
implementor defines each slot, size included, and Thixo ships page, panel and widget as defaults. Each slot is
filled by one plugin.

- **Requirements:** S5, S6, S12.

### 38. Slots carry events, and that is how plugins talk

A slot defines the events a plugin filling it can send, and the shell routes them. Those events and writes to the
API are the only ways plugins communicate.

- **Turned down:** values a plugin provides up to the shell (S14), which overlapped with events.
- **Requirements:** S13.

### 39. Thixo doesn't say how an app lays out lists

S9, one frame per list rather than per row, is cut. How an app shows lists is the implementor's to decide, not the
framework's.

### 40. The shell's other slot requirements

The implementor never writes a frame, sandbox attribute or message handler (S7). A plugin reaches everything outside
its frame through shell services (S8). Each user has a layout, with defaults set by the implementor (S10).

- **Requirements:** S7, S8, S10.

### 41. The plugins and scopes rules, folded

Several requirements said the same thing in parts. They are now fewer and say it once:

- How a plugin gets its scopes (P2, P3, P4, P13 and P15) is one requirement: they come from what it imports, the
  import path says which are required, using a plugin is agreeing to them, and nobody grants scopes per plugin
  (which was P7).
- That a plugin creates no tokens (P6) and holds none (P8) is part of "a plugin can reach nothing but the plugin
  SDK".
- What the broker checks (P9) is part of P1 and the author cap (P14).
- P12, third-party data only through an API endpoint, is cut. It was too tight: an implementor can give plugins
  other ways to move data, and it follows from the language having no network anyway.

### 42. Plugin code runs in the page, compiled from the language

Settles what runs the language ([the language](05-language.md#what-this-tells-us-about-what-runs-it)). Thixo compiles a plugin to
JavaScript that runs in the app's page, only while the plugin is on screen. The language decides what that code can
reach, not a sandbox.

- **Turned down:** the sandboxed frame (P10), a worker, and a WebAssembly runtime. With the frame goes the need for
  a second domain (X8).
- **Requirements:** P7, P8.

### 43. The implementor can write plugins too

Plugins are written by Thixo's authoring agent or by the implementor. No author uploads plugin code. This is how
default plugins get written.

- **Requirements:** P6.

### 44. A plugin that hangs is a goal, not a requirement

P19 said the shell can stop a plugin that doesn't respond. Code on the page's main thread can't be interrupted from
outside, so a library the implementor exposes could still loop forever. Not hanging the app is a goal for the
language, not a promise.

### 45. The plugin language has its own requirements

The rules about the language moved to their own section with their own ids. The rule against runnable sources also
covers event-handler attributes such as `onclick` and `javascript:` addresses: a plugin handles events only through
the language. Compiling a plugin produces its manifest.

- **Requirements:** L1 to L8.

### 46. Default plugins live in the implementor's project

A default plugin is kept in the implementor's project, not only in the registry. Promoting a plugin to default
opens a change there through the code storage adapter, and a change there publishes a new version to the registry.

- **Turned down:** default as a flag in the registry alone, which leaves two copies to disagree.
- **Requirements:** G3, S1.

### 47. Implementors change adapters, users change plugins

When something is the implementor's to change, it is an adapter. When it is a user's, it is a plugin. So Thixo
ships the authoring chat's flow and the promotion flow, and an implementor replaces them with adapters. Who can
promote is the implementor's call. The authoring agent's model is an adapter too.

- **Requirements:** W2, U7.

### 48. Plugin data, settled for now

- A plugin's store is private to each user. Sharing a store across users is left for later (D2).
- Every field is optional, so versions in use at the same time share records and a version can stop using a field
  without breaking an older one (D5).
- Deleting a field's data is its own act, separate from publishing a version (D7).
- A fork is a layer over its parent's data, like a JavaScript prototype chain: reads step up to the parent, writes
  stay in the fork (D9, D10). The old D9, that a compatible fork can read its parent's data, follows from this.
- Reading and writing plugin data are two scopes. A plugin reaches only its own lineage's data, which the broker
  enforces. A lineage is not a scope (D11).

### 49. Build details are not requirements

Cut, because each is how the first version gets built rather than what Thixo must do: the registry builds from
source (U4), the globals check (U6, which the language makes moot), the first proof of concept on Cloudflare
(X3), and support for Vercel and AWS (X4). Decision 15 still records the providers. No feature depending on one
provider (X7) is now a guiding principle in [portability](07-portability.md).

### 50. Every requirement is decided, and renumbered

Each requirement is now decided or cut, so the status column and the "Not requirements" list are gone. Six of the
list's eight items restated a requirement. The other two moved into P7 and decision 44.

The ids were renumbered so each section counts from 1. The plugin language got its own letter, L. Entries above
this one use the old ids.

| Old | New |
| --- | --- |
| W4 | W3 |
| A5 to A11 | A4 to A10 |
| A13 | A11 |
| S10, S11, S13 | S9, S10, S11 |
| P14, P5, P8 | P3, P4, P5 |
| P16, P17, P18 | P6, P7, P8 |
| P20, P21, P22, P11, P23, P24, P25 | L1 to L7 |
| U7 | L8 |
| U5, U8, U9, U10, U11 | U4 to U8 |
| D10, D11, D12, D13 | D9 to D12 |
| X5, X6 | X3, X4 |

### 51. The import allowlist is part of the language

U4, the build's import allowlist, is cut. L2 and L3 already say what a plugin can import. The two things only U4
said move into L2: a plugin can import the app's slot definitions, and there are no dynamic imports. The authoring
ids after it move up by one: U5 to U8 are now U4 to U7.

### 52. The coding layer folds into the language

The coding layer doc was the proposal that replaced the sandboxed frame. Once decided, most of it repeated the
security model, the architecture and decision 42. Its open questions about exposed libraries and its list of what
to test first moved to [the language](05-language.md), and the doc is gone. The docs are renumbered so the design
comes before the decisions and open questions. Links in entries above point at the new file names.

### 53. Slots can hold slots

A slot's contract can declare child slots, such as a slot in each row of a list, and the plugin filling the parent
places them. Only the implementor defines slots, so a fork can't change a contract other plugins depend on.

Each field of a slot's context names the scopes that read it, and a plugin that fills the slot requires them. A
parent can then hand data down without a child holding data its author could never read.

- **Turned down:** child slots that get only ids. It is safe, but every row would fetch again what the parent already
  has.
- **Requirements:** S13.

### 54. The data adapter speaks plugin data

The data adapter's interface is in plugin-data terms: read through a fork chain, read many, find by a declared
field, patch, delete. Each adapter decides how to store that and owns its schema and its migrations. A plugin never
changes the database schema. Thixo's SQL adapter is its own package, `thixo-sql`.

- **Why:** a generic document store left Thixo to build the fork chain and filtering on top, which pushed toward
  requiring SQL. A framework for malleable software shouldn't be rigid there. It has an opinion, the SQL adapter, and
  an implementor can swap it.
- **Turned down:** requiring a SQL database.
- **Requirements:** X4.

### 55. One data model doc

The structures on Thixo's side of the API, such as plugins, versions, manifests, layers, plugin data records and
layouts, are defined in one place, the [data model](06-data-model.md), in the schema module's types. It replaces the
plugin data doc, whose rules are about the same structures and now follow them.

## 2026-11-21: the data model

### 56. Only a deploy publishes a default plugin

A default plugin is a folder in `plugins/` whose metadata names its `PluginId`. A commit publishes nothing. A deploy
builds every folder, reuses the version with the same source hash or stores a new one, and records the default
layout, resolved to versions, as a release. Promoting a version writes its source into `plugins/`, so the deploy
after the merge finds that same version and makes no new one. Each environment has its own registry, and rolling
back is a deploy of an older commit. See the [data model](06-data-model.md#default-plugins-and-deploys).

- **Why:** "a change there publishes a new version" left open when a change counts, which version a layout in the
  repo names before the registry has numbered it, and what a promotion or a rollback mints.
- **Requirements:** G3, S9.

### 57. Default is not a visibility

A plugin's visibility is personal or shared. Default is where its source lives, the implementor's `plugins/`, and
the current release says which plugins those are.

- **Requirements:** G3.

### 58. No search over plugin data in the first version

The data adapter reads through a chain, reads many, patches and deletes. Finding records by a field's value, and
declaring fields searchable, are cut. Registry search is unchanged.

- **Why:** it pulled indexes, a filter language and inherited values into the adapter before anything needs them.
- **Changes:** decision 54.

### 59. Deleting data and the app's records are requirements

Two parts of the data model were requirements, not structures: deletion is never a side effect of a new version
(D13), and an annotatable record's definition gives Thixo a way to check it and a signal when it is deleted (A13).
"Two versions, two truths" is cut as a limit: it is a fact of malleable software, not something Thixo can solve.
Cambria is no longer held in reserve.

- **Requirements:** A13, D13.

## 2026-11-22: addresses

### 60. Copy at build, and addresses from data

The owner settled the open part of L7, choosing between fixed addresses.

- **Copy at build.** "The build should build like an npm install. There should be no outside file refs." An outside
  address written in a plugin's source that loads something, such as an image or a font, is fetched once when the
  plugin is built and stored with the version. The page loads the app's copy, so it never fetches from an outside
  host because of something written in plugin source. A fetch that fails is a build error. The fetch runs on the
  server for whoever wrote the source, so it must not reach inside the network.
- **Addresses from data load anywhere.** "As long as the process of creating the plugin is not what makes the URL
  this is ok. If people want to put external urls into the apis, that's fine." A `Url` the app hands a plugin, from
  an endpoint, a slot's context or a url field, may be shown, loaded and linked whatever its host. A plugin still
  can't build or change one, and no address that runs code is allowed.
- **Links go anywhere.** A written-out link may go to any https host. A plugin that chooses between fixed links
  tells the host one bit on a click, and the registry names the hosts it links to.
- **Turned down:** the implementor listing the hosts plugins may load from and link to. It left the leak open on
  every listed host, and it stopped plugins showing the app's own outside images.
- **What remains:** a `Url` someone saved as data is a tracking pixel for whoever opens the page.
- **Requirements:** L4, L7, L8.

## 2026-11-24: thixo is the language

Settled by Matthew Whittemore, the project's owner, after the first build of the framework. Entries 1 to 60 stay as
history.

### 61. Thixo is a compiler from .thx to JavaScript, and nothing else

The project is cut down to what the plugin language promised: code that looks like TypeScript and React, compiled
to JavaScript that runs in a page and reaches only what it was handed. The name is thixo; `.thx` stays as the file
extension. The framework (API, shell, slots, registry, plugin data, authoring agent, adapters, examples) is removed
from the tree, and the last commit that had it is tagged `framework-v0`.

- **Why:** the containment was the idea worth keeping. The rest of the framework was a bet on a product shape that
  may be wrong, and it made the language harder to test on its own.
- **Turned down:** keeping the framework beside the compiler, or moving it to an `archive/` folder.

### 62. A program is a React component

A program's entry file default-exports a component. It renders raw elements and SVG through JSX, and gets its hooks
from a built-in module, `thixo`, including a frame clock and the pointer, so that it can animate. A host may give it
more modules.

- **Turned down:** a canvas draw loop with no React; both together.

### 63. A benchmark of agents trying to get out

The wall is measured by agents whose only job is to break it. Each goal is one thing thixo promises a program can't
do: read the page, reach the network, run its own JavaScript and the like. An agent, run with the Claude Agent SDK,
writes thixo, submits it, and the program is compiled and run in a real browser that reports whether the goal was
reached. If it was, the agent is done; if not, it gets the feedback and tries again.

- **Turned down:** a hand-written tool loop on the Claude API.

### 64. The animation site is its own project

An app where people prompt an agent for looping and interactive animations is the first thing built on thixo. It
lives in its own repository and uses thixo only to compile. There is no `thixo dev`.

