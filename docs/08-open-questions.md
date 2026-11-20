# Open questions

What is not decided. Each question has a lean where there is one. A lean is a starting position, not a decision.

Ordered by how much depends on the answer.

## Scopes

### Scope shape

Requirement A3 proposes a required set plus optional scopes per endpoint, and A4 proposes no alternatives.

- Is "required plus optional" the right shape, or do optional scopes belong on separate endpoints?
- Are scope names flat (`todos.write`) or do they nest, so that `todos` implies `todos.read`?
- **Lean:** required plus optional, flat names, no alternatives. A plugin's scopes then stay a plain set that the
  registry can filter on.

### Required and optional in a plugin

Requirement P4 proposes two import paths. The alternative raised was a registration file where a plugin asks for
its SDK.

- **Lean:** import paths. They can be read from the source with no judgment, and they can't disagree with the code.
- **To settle:** whether an optional import can be promoted to required by how it is used.

### Tokens and identity

- How does the implementor tell Tailor who the user is and what scopes they hold?
- Who signs narrowed tokens, how long do they live, and are they issued per call or per session?
- What happens to a running plugin when the user's scopes change?
- **Lean:** the implementor writes one function from a request to a user and their scopes. Tailor signs short-lived
  narrowed tokens with a key the implementor supplies.

### Scopes that depend on the record

A user may be allowed to edit their own todos and not other people's. Scopes as designed are per endpoint, not per
record.

- **Lean:** the endpoint handler decides per record, and a plugin learns from the response. Graying out per record
  is then the endpoint's job to support. This needs a worked example.

## Slots

### Slot kinds

Requirement S6 proposes page, panel and widget.

- Is there an action kind: a button or menu item the shell draws, with plugin code behind it and no frame on screen?
- Can a plugin fill more than one slot?
- Can plugins talk to each other, or only to the shell?
- **Lean:** start with the three kinds, one slot per plugin, no plugin-to-plugin messages. Add the action kind when
  the todo example needs it.

### Frames and the feel of the app

Every filled slot is a frame (S9).

- How do focus, keyboard navigation and screen readers behave across frames?
- How fast does a page with several plugin frames load?
- How do modals and menus that should overlap the page work? Requirement S8 says through shell services. That needs
  a design.

### Layout

- Who can change which plugin fills a slot: each user, an admin, or both?
- When the implementor updates a default plugin, what happens to users who forked it?

## Plugin data

- Who may delete a field's data from a lineage?
- Does writing an annotation on a record need that record's write scope, or only its read scope?
- What is the boundary of a shared store: everyone in the app, a team, or the users of one plugin?
- How are export and erasure requests answered for data spread across lineages?
- When a fork joins a lineage, can the parent's author refuse?
- **Lean:** annotations need the record's read scope and the lineage scope. The rest needs discussion.

## API changes

The API's versioning is outside the plugin space (A8). Plugins still break when an endpoint they import changes.

- Does a version record the API version it was built against?
- Does the registry rebuild every plugin when the API changes, and what does a user see when theirs fails?
- Can the authoring agent repair plugins after an API change?
- **Lean:** record the API version in the manifest and rebuild on change. A plugin that no longer builds is flagged
  to its author. An agent repair is a later feature.

## Build

The largest portability question. See [portability](06-portability.md#build).

- Can the default build run inside a serverless function on all three targets, within their CPU and size limits?
- If not, what does each target use, and does that break X7?
- Are plugins written in TypeScript, and where does type checking run?
- **Lean:** try bundling inside the function first, since plugins are small and have few imports. Measure before
  deciding.

## Authoring

- Where does the agent's loop run, and how does it stream to the chat?
- What does the agent get as context: the API definition, the slot contracts, the design tokens, the source of
  similar plugins?
- Can a person edit plugin source by hand, or only through the chat?
- How does an author try a plugin before it replaces what they use?

## Registry

- Is search by keyword, by meaning, or both? Is it a fifth adapter?
- Who can promote a plugin to shared, and who to default?
- Is there review between personal and shared?

## Security

The gaps listed in the [security model](04-security-model.md#known-gaps) each need a browser test. Beyond those:

- Is the globals check worth having once the host document removes the dangerous features, or is it only noise for
  authors?
- Should Hardened JavaScript be the default instead of an option?

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
