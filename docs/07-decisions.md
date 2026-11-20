# Decisions

What has been decided, with the reason and what was turned down. A decision here backs each requirement marked
Decided in [the requirements](02-requirements.md).

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
  software. It collides with an existing company. See [open questions](08-open-questions.md#name).

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

### 23. Plugins are written in a language of Thixo's own

Settled by Matthew Whittemore on 2026-11-20. The language is new, and it looks a lot like JavaScript, TypeScript
and React. This is P20.

- **Why:** only Thixo's agent writes plugins, so Thixo can control the language they are written in. A sandbox
  solves a problem Thixo does not have to have. The [spike](04-security-model.md#the-spike) showed what the
  sandboxed frame costs. Looking like TypeScript and React keeps the agent able to write it well.
- **Turned down:** full TypeScript. Also a subset of TypeScript with Thixo's compiler, which was the lean before
  this decision.
- **Not decided:** what runs the language, and whether the sandboxed frame goes. P10, P11 and P16 to P19 are
  still Proposed. See [the coding layer](09-coding-layer.md).

### 24. A plugin can't import outside code

Settled by Matthew Whittemore on 2026-11-20. A plugin can't install an npm package or import code from outside.
Thixo can expose libraries for plugins to use, as it does with React. This is P21.

- **Why:** outside packages are JavaScript, not Thixo's language, so importing one would bring in code the
  language does not control.
- **Not decided:** which libraries Thixo exposes, and whether an implementor can expose their own.

### 25. The implementor decides which libraries plugins can use

Settled by Matthew Whittemore on 2026-11-20. It answers what decision 24 left open. Thixo provides the way to
expose a library to plugins. The implementor decides which libraries their app exposes. This is P22.

- **Why:** Thixo is a framework. It creates the capability and does not make the call.
- **What follows:** an exposed library is outside Thixo's language, so the implementor is trusting it.
- **Not decided:** how a library is exposed, where it runs and what Thixo checks about it.
