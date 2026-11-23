# Open questions

What is not decided. Each question has a lean where there is one. A lean is a starting position, not a decision.

## Answer these first

Three questions came out of testing the first draft: a cold read of the docs, and an attempt to write a third plugin
(tags on todos) from the docs alone. Each one can change the shape of the framework.

### 1. Who agrees to a plugin's scopes?

Mostly decided on 2026-11-19. Using a plugin is the agreement, with the registry showing what it uses (P2), and a
plugin never runs with more than its author could do (P3). What those two rules leave open:

- **Whose scopes, and when?** The author's scopes when the version was submitted, or now? What happens to a plugin
  when its author loses a scope or leaves?
- **Who is the author of a fork?** The person who forked it, presumably. Then a fork by an admin lifts the cap.
- **Default plugins.** The implementor writes them (P6). Is there a cap at all?
- **Imports the author can't call.** Should the build reject them, since no one could ever use them?
- **Newer versions.** If users follow the newest version of a plugin, its author can add endpoints later. Does a
  user see the summary again? See [layout and versions](#layout-and-versions).
- **Annotations other users see.** A plugin can read with one user's access and write into an annotation its author
  can read. The author cap doesn't stop this. Stores are private to each user for now (D2), so they aren't a way out
  yet.

### 2. How do two plugins share data?

Data belongs to a lineage (D10), and a lineage follows forks. Two different plugins can't work over the same field.

- The todo list can never show the due date that due-dates writes. "Show the new field in the list" is the first
  thing a user will ask for.
- A list is one plugin in one slot (S12), so without child slots (S13) adding anything to a row means forking the whole list. Two users who
  want tags and due dates in the list need a third fork that merges both, and none of the forks gets the
  implementor's later updates.
- Two people who each fork the list to add tags get two separate `tags` fields holding different data.
- Finding records by an annotation's value is not in the first version. A filter has to load everything into the
  plugin, which breaks once the list is paged.

Options:

- **A plugin can publish its fields.** Another plugin imports the declaration and gets read access, which the build
  derives like a scope.
- **A plugin can fill more than one slot.** One tags plugin then owns both the editor in the panel and a piece of
  each row.
- **Rows have slots.** Chosen ([decision 53](08-decisions.md#53-slots-can-hold-slots), S13). The list's slot
  declares a slot in each row, and due-dates can fill it without the list being forked. Still open: how deep slots
  can nest, and what happens when the plugin filling the list doesn't place its row slots.
- **Fork and merge is the answer.** State it and make the agent good at merging forks.
- **Slot events (S11).** A plugin sends an event its slot defines, and the shell routes it into other slots as
  context. A tags plugin sends the current filter and the list receives it. If the list's slot accepts "badges by
  todo id", a due-dates plugin can decorate rows without the list being forked. The limit: a plugin can only send
  while it is loaded, so this needs a slot that loads with the page and draws nothing.

**Lean:** child slots for row decoration, slot events for anything live, such as filters and selection, and
published fields and batch reads for stored data.

### 3. What does containment rest on?

Plugin code is compiled from the language and runs in the app's page (P7), so the compiler is the whole wall. The
sandboxed frame was dropped ([decision 42](08-decisions.md#42-plugin-code-runs-in-the-page-compiled-from-the-language)).
What that leaves:

- **Can the compiler's output be escaped?** Give the job to an agent whose only task is to break out. Records with
  nothing behind them and computed field names are where an escape would be found. See
  [the language](05-language.md#what-this-tells-us-about-what-runs-it).
- **A plugin can hang the page.** Code on the main thread can't be stopped from outside. Counting loops and calls in
  compiled code covers the language, but not a long call into a built-in or a library the implementor exposes. Not
  hanging the app is a goal, not a requirement.
- **Styles.** A plugin's styles share the app's page. Can they be scoped so that they can't touch or cover the app,
  and which properties have to be filtered?
- **The rest of the tests** are listed in [the language](05-language.md#what-has-to-be-tested-first).

## Scopes

### Scope shape

- Are scope names flat (`todos.write`) or do they nest, so that `todos` implies `todos.read`?
- **Lean:** flat names, no alternatives. A plugin's scopes then stay a plain set the registry can filter on.

### Required and optional in a plugin

The import path says which (P2). Still to settle: should the build reject an optional endpoint called without first
checking it is allowed?

### Tokens and identity

- How long does the user's token live, and how does the broker renew it?
- Plugin data endpoints need to know which plugin and lineage a call is for. With one token per user (decision 23),
  the broker says so and the API takes its word. Is that enough?
- What happens to a running plugin when the user's scopes change?
- How do the shell's own calls, outside any plugin, authenticate?
- A5 says tokens are JWTs so scopes are readable. Under P5 a plugin never holds a token and learns what is allowed
  from the shell. Is A5 still needed as a requirement, or is it now an implementation detail?

### Scopes that depend on the record

A user may be allowed to edit their own todos and not other people's. Scopes are per endpoint, not per record.

- **Lean:** the endpoint handler decides per record, and the response tells the plugin what is allowed on each. This
  needs a worked example.

## Slots

### Slots

- Is there an action slot: a button or menu item the shell draws, with plugin code behind it and nothing of its own on screen?
- Can a plugin fill more than one slot? See question 2.
- Can a fork target a different slot from its parent?

### State between slots

A plugin's state lives in the plugin or in its private store. A filter in one slot that affects another needs a new
event and context in the shell, which only the implementor can write.

- Does the shell offer a general way to share state between slots?
- When one plugin writes, how do others showing the same data find out?

### The feel of the app

- How do focus, keyboard navigation and screen readers move between plugins and the app?
- How fast does a page with several plugins load, and what does the compiled code add to a slot's start time?
- How do modals and menus that overlap the page work through shell services (S8)?
- How does a plugin measure layout, manage focus and draw on a canvas?

### Layout and versions

- Who can change which plugin fills a slot: each user, an admin, or both? Can the authoring agent?
- A slot a user changed pins a version, and one they didn't follows each release
  ([data model](06-data-model.md#default-plugins-and-deploys)). Does a pinned slot ever move to a newer version, and
  is the user told?
- How is a bad version pulled back? Versions are never deleted, and there is no revoke or audit log.
- When the implementor updates a default plugin, what happens to users who forked it?
- How does an author try a plugin before it replaces what they use?

## Plugin data

- Are there list or set fields with add and remove, or is it last write wins per field?
- Is clearing a value a delete?
- How is the grouping that decides who sees an annotation (A11) defined?
- When stores can be shared across users (D2), who picks the grouping, and can a new version or a fork widen it?
  Widening it silently would show private records to others.
- Which fields can be searched, and how does a plugin declare one? Search is cut from the first version.
- When the app deletes a record (A13), what happens to its annotations?
- Does a Thixo upgrade that recompiles unchanged source make a new version, or a new `compiled` on the same one?
- Who may delete a field's data from a lineage (D7)? How are export and erasure requests answered?
- When a fork joins a lineage, can the parent's author refuse?
- How is a fork expressed in source?
- What are the quotas?

## Tenancy

Nothing in the design has a tenant, a team or an organisation. Registry visibility, "shared", "default", layouts,
shared stores and lineages all need a boundary.

- **Lean:** say that one deployment is one organisation, and list multi-tenant apps as not supported to start. A
  product that serves many customers from one deployment would otherwise share plugins and data across them.

## API changes

The API's versioning is outside the plugin space (A7). Plugins still break when an endpoint they import changes.

- Does a version record the API version it was built against?
- Does the registry rebuild every plugin when the API changes, and what does a user see when theirs fails?
- Can the authoring agent repair plugins after an API change?
- **Lean:** rebuild on change and flag a plugin that no longer builds to its author. Agent repair is a later
  feature.

## Build

The largest portability question. See [portability](07-portability.md#build).

- Can the default build run inside a serverless function on all three targets, within their CPU and size limits?
- If not, what does each target use, and does that break the principle that no feature depends on one provider?
- Where does type checking run?
- How strict is the literal form for data declarations (U7)?
- **Lean:** try compiling inside the function first, since plugins are small and have few imports. Measure before
  deciding.

## Authoring

- Where does the agent's loop run, how does it keep its place between requests, and how does it stream to the chat?
- What does the agent get as context: the API definition, the slot contracts, the design tokens, the source of
  similar plugins?
- How is the agent protected from instructions hidden in other people's plugins?
- Which React helpers does Thixo ship for calls and plugin data, and how do they report loading and errors?

## Registry

- Is search by keyword, by meaning, or both? Is it a fifth adapter?

## Security

- What does Thixo check about a library the implementor exposes, if anything?
- A `Url` saved as data is a tracking pixel for whoever opens the page
  ([decision 60](08-decisions.md#60-copy-at-build-and-addresses-from-data)). Should the shell offer an implementor a
  way to proxy or copy handed-in images too, or to mark which url fields may load?
- Shell chrome a plugin fills. A dialog and a toast now carry a line, drawn by the shell, naming the plugin and its
  author. Should a plugin also be refused form fields that look like a sign-in (a password-like label), or should
  `openModal` stop taking a free-text title?
- Look-alike names. Sharing refuses a name equal to a default's or another shared plugin's after folding case,
  width, spaces and punctuation. Letters from other scripts that look the same ("Due dаtes" with a Cyrillic а) still
  pass; the `Default` badge is what tells them apart. Should the registry fold confusable letters too?

## Project

### Name

Decided: Thixo. See [decision 22](08-decisions.md#22-the-name-is-thixo). Still to do:

- Claim the npm name and scope, a GitHub organisation and a domain. Nothing has been registered.

### License

Not chosen. The repo is private until it is.

### Packages

How the framework is split into packages is not settled. See
[the plan](../packages/readme.md).
