# Requirements

What Thixo must do.

MUST, SHOULD and MAY carry their usual meaning: required, expected unless there is a good reason, and optional. A
requirement with none of them is a MUST.

## Who it is for

| # | Requirement |
| --- | --- |
| W1 | Thixo is a framework, in the vein of Next.js. Its user is the implementor: a developer building a malleable product. |
| W2 | Thixo provides the pieces: the authoring chat, registry search, forking, sharing and promotion. The authoring chat comes with Thixo's own flow, such as searching the registry before writing a new plugin, and an implementor can replace that flow with an adapter. Who can promote a plugin to shared or default is the implementor's call. |
| W3 | The design MUST NOT rely on users trusting each other. The limits on a plugin hold for a stranger's plugin too. |

## The API

| # | Requirement |
| --- | --- |
| A1 | The app's API has two sides. The implementor defines their side as a set of endpoints. Thixo provides the other side, the same in every app: plugins and their versions, the registry, plugin data, authors and authoring. |
| A2 | Each endpoint MUST carry its scopes. An endpoint can need more than one. |
| A3 | A caller MUST hold every scope an endpoint carries. |
| A4 | Thixo's side of the API MUST issue the tokens and enforce the user's scopes, on every endpoint of both sides. Which calls each plugin may make is enforced by the broker (P1). |
| A5 | Tokens are JWTs, and a token's scopes are readable as claims. |
| A6 | The API is a fixed writing surface. A plugin can't add or change endpoints. |
| A7 | Versioning the API is outside the plugin space. |
| A8 | Thixo does not own identity. An identity adapter tells Thixo who the user is and which scopes they hold. Thixo ships adapters for identity services such as Clerk, WorkOS, Auth0 and Cognito, and an implementor can write their own. |
| A9 | Thixo MUST generate an API SDK from the API definition, with one function per endpoint, for the base app to call the API. Thixo serves it from a route in the deployment, so it never has to be published anywhere else. It is not the plugin SDK. |
| A10 | The implementor declares which of the app's records plugins can annotate, such as a todo, and the scopes needed to read one. |
| A11 | For each annotatable record, the implementor also says who sees an annotation on it, as a grouping of users: from one user, through a team, to everyone. |
| A12 | Scopes say which API calls a caller can make. They do not say which data a caller can see. What an endpoint returns is the implementor's to get right. |
| A13 | An annotatable record lives in the implementor's storage, which Thixo can't see. Its definition (A10) MUST give Thixo a way to ask whether a record exists and whether the current user may read it, and a signal when one is deleted. |

## The shell and slots

| # | Requirement |
| --- | --- |
| S1 | A base React app provides the always-on functionality, defines where plugins go and holds the default plugins in its own project (G3). |
| S2 | The constraint on a plugin sits at the slot, not at the components. |
| S3 | A plugin MAY render anything inside its slot that the language allows (L5, L6). |
| S4 | Thixo ships design tokens and primitive components as defaults. Using them is never required. |
| S5 | The implementor defines each slot, including its size. There is no separate layer of slot kinds. |
| S6 | Thixo ships a few basic slots as defaults, such as page, panel and widget. |
| S7 | The implementor MUST NOT have to wire up a plugin by hand. They place a slot and Thixo does the rest. |
| S8 | A plugin reaches everything outside its slot through shell services in the SDK: navigation, modals, clipboard, downloads. |
| S9 | Each user has a layout saying which plugin versions fill which slots. The implementor sets the defaults. |
| S10 | A slot's contract is the context the shell passes in and the events a plugin can send back. The slot also sets its size. |
| S11 | Plugins don't message each other. A slot defines the events a plugin filling it can send, and the shell routes each event to where it belongs. Those events and writes to the API are the only ways plugins communicate. |
| S12 | Each slot is filled by one plugin. |
| S13 | A slot's contract can declare child slots, and the plugin filling it places them. Only the implementor defines slots. Each field of a slot's context names the scopes that read it, and a plugin that fills the slot requires them. |

## Plugins and scopes

| # | Requirement |
| --- | --- |
| P1 | It MUST be impossible for a plugin to make a call outside its scopes. The broker refuses any endpoint that isn't in the plugin version's manifest. |
| P2 | A plugin's scopes come from what it imports, never a hand-written list. Endpoints from the plain plugin SDK path, plus every record it annotates, give its required scopes. Endpoints from the optional path give its optional ones. A user without a required scope isn't offered the plugin. The registry shows a plugin's scopes before anyone uses it, and using it is agreeing to them. Nobody grants scopes per plugin. |
| P3 | A plugin never runs with more than its author could do. The broker refuses a plugin's call when its author doesn't hold the endpoint's scopes. |
| P4 | A plugin MUST be able to ask whether the current user can call any endpoint it imports, so it can gray out what they can't do. |
| P5 | A plugin can reach nothing but the plugin SDK. API calls, tokens, the network, the page and the user's session are reached through the shell, or not at all. |
| P6 | Plugins are written only by Thixo's authoring agent or by the implementor. No author uploads plugin code. |
| P7 | Thixo compiles a plugin from its language to JavaScript that runs only in the app's page, while the plugin is on screen. There is no background work. The language decides what that code can reach, not a sandbox. |
| P8 | A plugin draws ordinary HTML elements and styles into its slot, and its styles are scoped to that slot. Which elements it may create is set by the language (L5, L6). |

## The plugin language

What the language plugins are written in can and can't do. The design is in [the language](05-language.md).

| # | Requirement |
| --- | --- |
| L1 | Plugins are written in a language of Thixo's own, which looks a lot like JavaScript, TypeScript and React. |
| L2 | A plugin can't import outside code or install packages. It imports the SDK, the app's slot definitions and the libraries exposed to it. There are no dynamic imports. |
| L3 | The implementor decides which libraries are exposed to plugins. Thixo provides the way to expose one. |
| L4 | The plugin language has no way to reach the network: no fetch, sockets or anything like them. A plugin's only way out is the plugin SDK (P5). |
| L5 | A plugin can write raw HTML and SVG elements, not only exposed components. |
| L6 | A plugin can't create an element or attribute that runs code or brings in another runnable source: no frames, no scripts, no event-handler attributes such as onclick, no javascript: URLs, nothing that loads or runs code from elsewhere. A plugin handles events only through the language, which compiles them to code the compiler wrote. |
| L7 | An address in a plugin is either written out in its source or a value handed to it from outside the plugin. A plugin can't build or change one. A field that holds an address is declared as one, and a plugin can't write a string to it. |
| L8 | Compiling a plugin produces its manifest: endpoints used, scopes, data schema and its hash, shell services. |

## Authoring

| # | Requirement |
| --- | --- |
| U1 | Thixo provides a chat interface where a user describes a plugin and an agent writes it. |
| U2 | Every version of a plugin is stored. Versions are distinct. There is no concept of branches. |
| U3 | Plugin source lives in object storage, such as R2 or S3. |
| U4 | The authoring agent runs the same checks while it writes, so a failed build is feedback to the agent before a person sees it. |
| U5 | The authoring agent can search the registry as a tool. |
| U6 | The authoring agent reaches its model through a model adapter, and the implementor picks which. Thixo ships adapters for model providers such as Anthropic, OpenAI and X, and an implementor can write their own. |
| U7 | A plugin's data declarations and its metadata are written in a literal form the build can read without running the code. |

## The registry

| # | Requirement |
| --- | --- |
| G1 | Search MUST account for the user's permissions and each plugin's scope requirements. A user is offered only plugins whose required scopes they hold. |
| G2 | Users can find their peers' plugins and submit their own. |
| G3 | A plugin can move from personal to shared to default. A default plugin lives in the implementor's project: promoting one opens a change there through the code storage adapter, and the next deploy publishes what changed there to the registry. |
| G4 | A fork records the version it started from. |
| G5 | On submission, and before a user takes a plugin, the registry shows a plain summary from the manifest, such as "reads todos, writes its own data, adds two fields". |

## Plugin data

| # | Requirement |
| --- | --- |
| D1 | Plugin data lives in two fixed API resources: a store for the plugin's own records, and annotations attached to the app's records. |
| D2 | A plugin's store is private to each user: a user sees only the records they wrote. Sharing a store across users is left for later. |
| D3 | Each plugin version declares its data fields and types as part of its interface. A stable hash of them is computed on submission and tracked. |
| D4 | Submission MUST flag a change that would lose data. |
| D5 | Versions of one plugin in use at the same time share the same records. Every field is optional: each version must work when a field is missing, so a version can stop using a field without breaking an older one. |
| D6 | Writes are patches. A version can only touch the fields it declares. |
| D7 | Deleting a field's data is an explicit act, separate from publishing a version. |
| D8 | A field's type never changes. A different type needs a new field with a new name. |
| D9 | A fork reads through to its parent's data by default (D10), and can start empty instead. |
| D10 | Each fork is its own layer over its parent's data, like a JavaScript prototype chain. Reading a field looks in the fork's layer first and then steps up to its parent. A fork's writes land in its own layer, so two forks that add the same name each have their own field. |
| D11 | Reading plugin data and writing it are two scopes, held like any other. Most users hold both, but an implementor can withhold either to limit which plugins a user can run. Within them, a plugin reaches only its own lineage's data, which the broker enforces from the plugin's manifest. A lineage is not a scope. |
| D12 | Annotating a record requires the scopes that read it. The build derives them from the plugin's data declarations. |
| D13 | Deleting plugin data is never a side effect of a new version. A user can delete their own store records, and removing a field's data from a lineage is an explicit act (D7) by someone with the right to do it. |

## Portability

| # | Requirement |
| --- | --- |
| X1 | An implementor MUST NOT be locked into a cloud provider. |
| X2 | Storing and reading plugin code MUST be pluggable. |
| X3 | Thixo's server code is written against the web-standard `Request` and `Response`, so one core runs on every target. |
| X4 | Provider-specific code lives only in adapters: code storage, data storage, build and model. |
