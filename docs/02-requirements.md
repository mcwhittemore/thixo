# Requirements

What Thixo must do. This is the document to argue with.

Each requirement has a status:

- **Decided:** settled in discussion. Changing it needs a new entry in [decisions](07-decisions.md).
- **Proposed:** a specific answer has been put forward and not yet accepted. Push on these first.
- **Open:** no answer yet. Details are in [open questions](08-open-questions.md).

MUST, SHOULD and MAY carry their usual meaning: required, expected unless there is a good reason, and optional.

## Who it is for

| # | Requirement | Status |
| --- | --- | --- |
| W1 | Thixo is a framework, in the vein of Next.js. Its user is the implementor: a developer building a malleable product. | Decided |
| W2 | Thixo provides capabilities. The product flows built on them belong to the implementor. | Decided |
| W3 | The first target is a team inside one company, where users are colleagues. | Decided |
| W4 | Nothing in the design MAY rely on users trusting each other. The limits on a plugin hold for a stranger's plugin too. | Decided |

## The API

| # | Requirement | Status |
| --- | --- | --- |
| A1 | The implementor defines the app's API as a set of endpoints. | Decided |
| A2 | Each endpoint MUST carry its scopes. An endpoint can need more than one. | Decided |
| A3 | A caller must hold every scope an endpoint carries. | Proposed |
| A4 | An endpoint does not support alternative scopes, where any one of several is enough. | Proposed |
| A5 | The API MUST issue the tokens and enforce the scopes. No other part of the system is trusted to. | Decided |
| A6 | Tokens are JWTs, and a token's scopes are readable as claims. | Decided |
| A7 | The API is a fixed writing surface. A plugin can't add or change endpoints. | Decided |
| A8 | Versioning the API is outside the plugin space. | Decided |
| A9 | Thixo does not own identity. The implementor tells Thixo who the user is and which scopes they hold. | Proposed |
| A10 | Thixo MUST generate the SDK from the API definition, with one function per endpoint. | Proposed |
| A11 | The API names its record types and the scopes needed to read each, so plugin data can attach to them. | Proposed |
| A12 | Scopes say which API calls a caller can make. They do not say which data a caller can see. What an endpoint returns is the implementor's to get right. | Decided |

## The shell and slots

| # | Requirement | Status |
| --- | --- | --- |
| S1 | A base React app provides the always-on functionality, defines where plugins go and ships the default plugins. | Decided |
| S2 | The constraint on a plugin sits at the slot, not at the components. | Decided |
| S3 | A plugin MAY render anything inside its slot. | Decided |
| S4 | Thixo ships design tokens and primitive components as defaults. Using them is never required. | Decided |
| S5 | Slots come in a short, fixed set of kinds. | Decided |
| S6 | The kinds are page, panel and widget to start. | Proposed |
| S7 | The implementor MUST NOT have to write a frame, a sandbox attribute or a message handler. They place a slot and Thixo does the rest. | Proposed |
| S8 | A plugin reaches anything outside its frame through shell services in the SDK: navigation, modals, clipboard, downloads. | Proposed |
| S9 | Every filled slot is one frame. A list of items is one plugin rendering the list, not one plugin per row. | Proposed |
| S10 | Each user has a layout saying which plugin versions fill which slots. The implementor sets the defaults. | Proposed |
| S11 | A slot's contract is the context the shell passes in and the events a plugin can send back. The slot's kind sets its size. | Proposed |
| S13 | Plugins don't message each other. The shell passes information between them. | Proposed |
| S14 | A slot's contract can also name values a plugin provides up to the shell. The shell holds them and passes them into other slots as context. | Proposed |
| S12 | A slot holds either one plugin or any number, as its definition says. | Proposed |

## Plugins and scopes

| # | Requirement | Status |
| --- | --- | --- |
| P1 | It MUST be impossible for a plugin to make a call outside its scopes. | Decided |
| P2 | A plugin's scopes MUST be derived from the SDK endpoints it uses. There is no list to maintain. | Decided |
| P3 | A plugin's scopes are split into required and optional, so it is clear whether a given user can use it. | Decided |
| P4 | The split comes from how an endpoint is imported: the plain SDK path for required, a separate path for optional. | Proposed |
| P13 | Required scopes are those of every required endpoint and of every record the plugin annotates. Optional scopes are those of its optional endpoints. | Proposed |
| P14 | A plugin never runs with more than its author could do. A call succeeds only when the user and the plugin's author both hold the endpoint's scopes. | Decided |
| P15 | Choosing to use a plugin is the agreement to what it uses. The registry shows what a plugin uses before a user takes it. | Decided |
| P5 | A plugin MUST be able to ask whether the current user can call any endpoint it imports, so it can gray out what they can't do. | Decided |
| P6 | Plugins do not create tokens. | Decided |
| P7 | Users are not asked to grant scopes per plugin. | Decided |
| P8 | A plugin never holds a token. The shell's broker makes the API call on its behalf. | Proposed |
| P9 | Each call carries a narrowed token that names the user and the plugin version. The API accepts it only for endpoints in that version's manifest, and only within the user's scopes and the author's (P14). | Proposed |
| P10 | A plugin runs in a sandboxed frame with its own origin and no access to the user's session, cookies or the shell's page. | Proposed |
| P11 | A plugin has no network access. The message channel to the shell is its only way out. | Proposed |
| P12 | A plugin that needs third-party data gets it through an API endpoint with a scope. | Proposed |
| P16 | Plugins are written only by Thixo's authoring agent. Nobody uploads plugin code. | Proposed |
| P20 | Plugins are written in a language of Thixo's own, which looks a lot like JavaScript, TypeScript and React. | Decided |
| P21 | A plugin can't import outside code or install packages. It imports the SDK and the libraries exposed to it. | Decided |
| P22 | The implementor decides which libraries are exposed to plugins. Thixo provides the way to expose one. | Decided |
| P17 | Plugin code runs outside the page, with no access to the page, the network or the user's session. The SDK is everything it can reach. | Proposed |
| P18 | A plugin draws by describing ordinary HTML elements and styles. The shell creates them in the app's page from an allowlist, and scopes the plugin's styles to its slot. | Proposed |
| P19 | The shell can stop a plugin that does not respond, without the app freezing. | Proposed |

P10, P11 and X8 rest on browser behaviour. [The spike](04-security-model.md#the-spike) tested it: P10 held, X8 can
stay, and P11 holds only with the policy the spike ended with. A stuck plugin can still freeze the app in Safari,
and no requirement in that design covers it.

P16 to P22 are [the coding layer](09-coding-layer.md). P20 to P22 are decided. The rest is a proposal that would replace
P10 and P11, drop S9 and X8 and narrow S3. The two designs are alternatives: accept one set, not both.

## Authoring

| # | Requirement | Status |
| --- | --- | --- |
| U1 | Thixo provides a chat interface where a user describes a plugin and an agent writes it. | Decided |
| U2 | Every version of a plugin is stored. Versions are distinct. There is no concept of branches. | Decided |
| U3 | Plugin source lives in object storage, such as R2 or S3. | Decided |
| U4 | The registry MUST build a plugin from its source. It never accepts a prebuilt bundle. | Proposed |
| U5 | The build enforces an import allowlist: the SDK, the app's slot definitions, React, Thixo's own modules and the plugin's own files. Dynamic imports are rejected. | Proposed |
| U6 | The build flags any use of a global outside an allowlist. | Proposed |
| U7 | The build produces the manifest: endpoints used, scopes, data schema and its hash, shell services. | Proposed |
| U8 | The authoring agent runs the same checks while it writes, so a failed build is feedback to the agent before a person sees it. | Proposed |
| U9 | The authoring agent can search the registry as a tool. | Decided |
| U10 | Which model runs the authoring agent is the implementor's choice. | Proposed |
| U11 | A plugin's data declarations and its metadata are written in a literal form the build can read without running the code. | Proposed |

## The registry

| # | Requirement | Status |
| --- | --- | --- |
| G1 | Search MUST account for the user's permissions and each plugin's scope requirements. A user is offered only plugins whose required scopes they hold. | Decided |
| G2 | Users can find their peers' plugins and submit their own. | Decided |
| G3 | A plugin can move from personal to shared to default. | Decided |
| G4 | A fork records the version it started from. | Decided |
| G5 | On submission, and before a user takes a plugin, the registry shows a plain summary from the manifest, such as "reads todos, writes its own data, adds two fields". | Decided |

## Plugin data

| # | Requirement | Status |
| --- | --- | --- |
| D1 | Plugin data lives in two fixed API resources: a store for the plugin's own records, and annotations attached to the app's records. | Decided |
| D2 | A store is either private to one user or shared by everyone using the plugin. | Proposed |
| D3 | Each plugin version declares its data fields and types as part of its interface. A stable hash of them is computed on submission and tracked. | Decided |
| D4 | Submission MUST flag a change that would lose data. | Decided |
| D5 | Old and new versions of a plugin MUST be able to run against the same data. | Decided |
| D6 | Writes are patches. A version can only touch the fields it declares. | Proposed |
| D7 | A new version can't delete a field's data. Dropping a field from the schema hides it. Deletion is a separate, explicit act. | Proposed |
| D8 | A field's type never changes. A different type needs a new field with a new name. | Decided |
| D9 | A fork whose schema is compatible with its parent's MUST be able to read the parent's data. | Decided |
| D10 | Data belongs to a lineage. A fork attaches to its parent's lineage by default and can opt to start empty. | Proposed |
| D11 | A field also records which plugin introduced it, so two forks adding the same name don't collide. | Proposed |
| D12 | Access to a lineage's data is a scope, derived through the SDK like any other. | Proposed |
| D13 | Annotating a record requires the scopes that read it. The build derives them from the plugin's data declarations. | Proposed |

## Portability

| # | Requirement | Status |
| --- | --- | --- |
| X1 | An implementor MUST NOT be locked into a cloud provider. | Decided |
| X2 | Storing and reading plugin code MUST be pluggable. | Decided |
| X3 | The first proof of concept runs on Cloudflare. | Decided |
| X4 | Vercel and AWS MUST be supported. | Decided |
| X5 | Thixo's server code is written against the web-standard `Request` and `Response`, so one core runs on every target. | Proposed |
| X6 | Provider-specific code lives only in adapters: code storage, data storage, build and model. | Proposed |
| X7 | No feature MAY depend on something only one provider offers. | Proposed |
| X8 | Thixo MUST work on a single domain. Isolation can't require the implementor to own a second one. | Proposed |

## Not requirements

Things Thixo deliberately does not do:

- **Own login.** The implementor brings identity (A9).
- **Lock the design.** There is no required component library (S4).
- **Field-level permissions.** Scopes are about which calls can be made (A12).
- **Let plugins change the API or the core schema.** Plugin data goes in the store and annotations (A7, D1).
- **Prescribe product flows.** Whether the chat searches before it creates, or how a plugin gets promoted, is the
  implementor's call (W2).
- **Run plugin code on the server.** A plugin works only while it is on screen. There is no background work.
- **Allow third-party libraries in plugins,** at least to start (U5).
- **Run a public marketplace.** The limits hold for strangers (W4), but review, billing and discovery across
  companies are out of scope.
