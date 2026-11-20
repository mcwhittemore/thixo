# Decisions

What has been decided, with the reason and what was turned down. A decision here backs each requirement marked
Decided in [the requirements](02-requirements.md).

New decisions go at the bottom. To reverse one, add a new entry that names the one it replaces. Don't edit history.

## 2026-11-19: founding discussion

Every decision in this section was settled by Matthew Whittemore, the project's owner, in the discussion that
started the project.

### 1. A framework, not an app

Tailor is a framework in the vein of Next.js. Its user is a developer building a malleable product for other people.

- **Why:** the hard parts (containment, data that survives change, common ground) are the same for every such
  product.
- **Turned down:** describing product flows, such as "the chat searches before it creates". Tailor exposes the
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

Tailor fixes what a plugin receives from its slot. It does not fix what the plugin renders. Design tokens and
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
