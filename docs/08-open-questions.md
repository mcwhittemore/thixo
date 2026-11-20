# Open questions

What is not decided. Each question has a lean where there is one. A lean is a starting position, not a decision.

## Answer these first

Three questions came out of testing the first draft: a cold read of the docs, and an attempt to write a third plugin
(tags on todos) from the docs alone. Each one can change the shape of the framework.

### 1. Who agrees to a plugin's scopes?

Mostly decided on 2026-11-19. Using a plugin is the agreement, with the registry showing what it uses (P15), and a
plugin never runs with more than its author could do (P14). What those two rules leave open:

- **Whose scopes, and when?** The author's scopes when the version was submitted, or now? What happens to a plugin
  when its author loses a scope or leaves?
- **Who is the author of a fork?** The person who forked it, presumably. Then a fork by an admin lifts the cap.
- **Default plugins.** The implementor ships them. Is there a cap at all?
- **Imports the author can't call.** Should the build reject them, since no one could ever use them?
- **Newer versions.** If users follow the newest version of a plugin, its author can add endpoints later. Does a
  user see the summary again? See [layout and versions](#layout-and-versions).
- **Shared plugin data.** A plugin can read with one user's access and write into a shared store or annotation its
  author can read. The author cap doesn't stop this.

### 2. How do two plugins share data?

Data belongs to a lineage (D10), and a lineage follows forks. Two different plugins can't work over the same field.

- The todo list can never show the due date that due-dates writes. "Show the new field in the list" is the first
  thing a user will ask for.
- A list is one plugin in one frame (S9), so adding anything to a row means forking the whole list. Two users who
  want tags and due dates in the list need a third fork that merges both, and none of the forks gets the
  implementor's later updates.
- Two people who each fork the list to add tags get two separate `tags` fields holding different data.
- There is no way to read annotations for many records at once, or to find records by an annotation's value. A
  filter has to load everything into the frame, which breaks once the list is paged.

Options, none chosen:

- **A plugin can publish its fields.** Another plugin imports the declaration and gets read access, which the build
  derives like a scope.
- **A plugin can fill more than one slot.** One tags plugin then owns both the editor in the panel and a piece of
  each row.
- **Rows have slots.** A list plugin exposes a place in each row that other plugins fill. This conflicts with S9
  unless the row pieces are not frames.
- **Fork and merge is the answer.** State it and make the agent good at merging forks.
- **Plugins provide values up to their slots (S14).** The shell holds what a plugin provides and passes it into
  other slots as context. A tags plugin provides the current filter and the list receives it. If the list's slot
  accepts "badges by todo id", a due-dates plugin can decorate rows without the list being forked. The limit: a
  plugin can only provide while it is loaded, so this needs a slot kind that loads with the page and draws nothing.

**Lean:** provided values for anything live, such as filters, selection and row decoration. Published fields and
batch reads for stored data.

### 3. What does isolation really rest on?

P10, P11 and X8 depend on browser behaviour nobody has tested here. The list of tests is in the
[security model](04-security-model.md#the-spike).

- If a sandboxed frame can pull features from a blank child frame, removing them in the host document does not work.
- If a sandboxed frame on the app's domain shares a process with the shell, one stuck plugin freezes the app.
- If plugins must be served from a separate domain to be safe, X8 has to go.

**Lean:** run the spike before accepting any of the three. Be ready to drop X8.

## Scopes

### Scope shape

- Are scope names flat (`todos.write`) or do they nest, so that `todos` implies `todos.read`?
- Should alternatives be allowed, where any one of several scopes is enough (A4)?
- **Lean:** flat names, no alternatives. A plugin's scopes then stay a plain set the registry can filter on.

### Required and optional in a plugin

P4 proposes two import paths. The alternative raised was a registration file where a plugin asks for its SDK.

- **Lean:** import paths. They can be read from the source with no judgment, and they can't disagree with the code.
- **To settle:** should the build reject an optional endpoint called without first checking it is allowed?

### Tokens and identity

- How long does a narrowed token live, and is it issued per call or per plugin load?
- What happens to a running plugin when the user's scopes change?
- How do the shell's own calls, outside any plugin, authenticate?
- A6 says tokens are JWTs so scopes are readable. Under P8 a plugin never holds a token and learns what is allowed
  from the shell. Is A6 still needed as a requirement, or is it now an implementation detail?

### Scopes that depend on the record

A user may be allowed to edit their own todos and not other people's. Scopes are per endpoint, not per record.

- **Lean:** the endpoint handler decides per record, and the response tells the plugin what is allowed on each. This
  needs a worked example.

## Slots

### Slot kinds

- Is there an action kind: a button or menu item the shell draws, with plugin code behind it and no frame on screen?
- Can a plugin fill more than one slot? See question 2.
- Can a fork target a different slot from its parent?

### State between slots

A plugin's state lives in its frame or in a private store. A filter in one slot that affects another needs a new
event and context in the shell, which only the implementor can write.

- Does the shell offer a general way to share state between slots?
- When one plugin writes, how do others showing the same data find out?

### Frames and the feel of the app

- How do focus, keyboard navigation and screen readers behave across frames?
- How fast does a page with several plugin frames load? Does each frame carry its own copy of React?
- How do modals and menus that overlap the page work through shell services (S8)?
- How does a plugin style its own markup, and how do design tokens reach it?

### Layout and versions

- Who can change which plugin fills a slot: each user, an admin, or both? Can the authoring agent?
- Does a layout pin a version or follow the newest? Pinning means nobody gets fixes. Following means silent change.
- How is a bad version pulled back? Versions are never deleted, and there is no revoke or audit log.
- A default plugin can come from the app's `plugins/` folder or be promoted from the registry (G3). Which wins, and
  how does a promotion reach the deployed app?
- When the implementor updates a default plugin, what happens to users who forked it?
- How does an author try a plugin before it replaces what they use?

## Plugin data

- How do users move between versions that changed a field, so the same record doesn't show two truths?
- Are there list or set fields with add and remove, or is it last write wins per field?
- Is clearing a value a delete?
- Who sees an annotation: everyone, or can it be private like a store (D2)?
- What is the boundary of a shared store: everyone in the app, a team, or the users of one plugin?
- How does Tailor learn that a record was deleted, and what happens to its annotations?
- How does Tailor check that a user may read one particular record before returning its annotations?
- Who may delete a field's data from a lineage? How are export and erasure requests answered?
- When a fork joins a lineage, can the parent's author refuse?
- How does the source say whether a field is inherited or new, and how is a fork expressed at all?
- What are the quotas?

## Tenancy

Nothing in the design has a tenant, a team or an organisation. Registry visibility, "shared", "default", layouts,
shared stores and lineages all need a boundary.

- **Lean:** say that one deployment is one organisation, and list multi-tenant apps as not supported to start. A
  product that serves many customers from one deployment would otherwise share plugins and data across them.

## API changes

The API's versioning is outside the plugin space (A8). Plugins still break when an endpoint they import changes.

- Does a version record the API version it was built against?
- Does the registry rebuild every plugin when the API changes, and what does a user see when theirs fails?
- Can the authoring agent repair plugins after an API change?
- **Lean:** rebuild on change and flag a plugin that no longer builds to its author. Agent repair is a later
  feature.

## Build

The largest portability question. See [portability](06-portability.md#build).

- Can the default build run inside a serverless function on all three targets, within their CPU and size limits?
- If not, what does each target use, and does that break X7?
- Are plugins written in TypeScript, and where does type checking run?
- How strict is the literal form for data declarations (U11)?
- **Lean:** try bundling inside the function first, since plugins are small and have few imports. Measure before
  deciding.

## Authoring

- Where does the agent's loop run, how does it keep its place between requests, and how does it stream to the chat?
- What does the agent get as context: the API definition, the slot contracts, the design tokens, the source of
  similar plugins?
- How is the agent protected from instructions hidden in other people's plugins?
- Can a person edit plugin source by hand, or only through the chat?
- Which React helpers does Tailor ship for calls and plugin data, and how do they report loading and errors?

## Registry

- Is search by keyword, by meaning, or both? Is it a fifth adapter?
- Who can promote a plugin to shared, and who to default?

## Security

- Is the globals check worth having once the host document removes the dangerous features, or is it noise for
  authors?
- Should Hardened JavaScript be the default instead of an option?
- Should plugins be allowed vetted third-party libraries?

## Project

### Name

Tailor is a working title. Tailor Platform is an active company with a React framework for business apps, an SDK
and a command-line tool called `tailor`. The bare npm name is taken.

- **Lean:** keep the working title while there is one user. Choose a name that doesn't collide before anything is
  public.

### License

Not chosen. The repo is private until it is.

### Packages

How the framework is split into packages, and what they are called, waits on the name. See
[the plan](../packages/readme.md).
