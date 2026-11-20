# Security model

How a plugin is contained. The requirement is P1: it must be impossible for a plugin to make a call outside its
scopes. The rest of this document is the proposed way to meet it, what it does not cover, and what has to be tested
before it is accepted.

## What we are defending against

A plugin is code written by an agent or by another person, running in front of a user who may hold more access than
its author.

| Threat | Example | Covered by |
| --- | --- | --- |
| Calling past its scopes | A plugin built with only `getTodo` calls a payroll endpoint with an admin's access. | This document |
| Stealing the session | A plugin reads the user's cookie or token. | This document |
| Leaking data to the outside | A plugin allowed to read todos sends them to an outside server. | This document, with gaps |
| Reaching into the app | A plugin reads or changes the shell's page, or another plugin's. | This document, with gaps |
| Destroying data | A plugin version wipes what another version wrote. | [Plugin data](05-plugin-data.md) |
| Using an admin's access | A plugin that openly imports a payroll endpoint is shared by someone who can't run payroll, and an admin uses it. | The author cap (P14) |
| Moving data between users | A plugin reads with one user's access and writes into a shared store its author can read. | **Not covered** |

The last row is not solved. See [what P1 does not cover](#what-p1-does-not-cover).

The first target is colleagues in one company, where the likely cause is a mistake or an agent doing more than it
was asked. The model is built for the stranger case anyway (W4), because retrofitting isolation is the hard
direction.

## What is trusted

P1 holds only if these hold. Everything else is treated as hostile.

| Trusted | For what |
| --- | --- |
| The API | Verifying tokens and enforcing the user's scopes. |
| The registry's build | Deriving the manifest from the source it stores. |
| The shell, including the broker | Knowing which frame a message came from, holding each plugin to its manifest and its author's scopes, and never handing a plugin the user's session or token. |
| The browser's sandbox | Keeping a plugin's frame apart from the shell's page. |

Two consequences worth stating:

- **The API can't see a plugin.** The broker is the only thing holding a plugin to its manifest. A shell that lies,
  or a broker with a bug, can do anything the user can. That is acceptable, because the shell already holds the
  user's session.
- **The broker must tie each message to a frame.** It does this by giving each frame its own message channel. A
  sandboxed frame has no usable origin to check.

## Three layers

### At build

The registry builds every version from source and never accepts a prebuilt bundle (U4), so the checks run on exactly
the code that ships.

- **Import allowlist (U5):** the list is in the requirement. Static imports can be read from the source with
  certainty. Dynamic imports are rejected.
- **Endpoint and scope derivation (P2, P13):** the endpoints imported are what the plugin may call.
- **Globals check (U6):** any reference to a name outside an allowlist is flagged. This catches direct use of
  `fetch`, `RTCPeerConnection`, `location`, `eval` and the like.
- **Schema extraction (D3):** the data fields and their hash come from the plugin's declarations, which are written
  in a literal form so the build can read them without running the code (U11).

Static analysis of JavaScript can't prove a plugin never reaches something, because code can build names at runtime.
That is why this layer isn't trusted alone.

### In the browser

- **Sandboxed frame (P10):** the plugin runs in a frame with scripts allowed and same-origin access not allowed. The
  browser gives it an origin of its own, so it can't read the shell's cookies, storage or page.
- **No network (P11):** the plugin route sends a content security policy that denies by default. It then allows
  only what a plugin needs to draw: inline styles, and images from data the plugin already holds. Images from the
  app arrive through the broker.
- **No code from strings:** the policy leaves out `unsafe-eval`, so `eval` and the `Function` constructor fail.
- **Host document runs first:** Thixo owns the document inside the frame. Before the plugin loads, it removes
  constructors a plugin must not have, such as `RTCPeerConnection`.
- **No child frames, workers or popups:** each would give the plugin a fresh copy of what the host document removed.
- **Frames stay put:** the shell's own policy limits what its frames may load.
- **Shell services are narrow:** `navigate` goes to routes inside the app, never to an arbitrary address.

### In the broker and at the API

- **The plugin holds no token (P8).** The broker in the shell makes the call.
- **The broker holds each plugin to its manifest (P9).** It forwards a call only for an endpoint in that version's
  manifest whose scopes the plugin's author holds (P14).
- **The API enforces the user's scopes (A5).** Every call carries the user's token.

## What P1 does not cover

P1 stops a plugin doing what it was not built to do. Two more rules cover a plugin doing what it openly was built to
do:

- **The author cap (P14).** A plugin never runs with more than its author could do. A plugin written by someone who
  can't run payroll can't run payroll for an admin either.
- **Using it is agreeing to it (P15).** The registry shows what a plugin uses. There is no prompt (P7).

What is still open:

- **Shared plugin data is a way out.** A plugin can read with the current user's access and write what it read into
  a shared store or annotation. Its author can read that. No network is needed, so the browser layer doesn't help.
- **A later version can ask for more.** If users follow the newest version of a shared plugin, its author can add an
  endpoint and every user picks it up.
- **The authoring agent reads other people's plugins.** Text in a plugin's source or description could steer the
  agent when it works for someone else.

See [open questions](08-open-questions.md#1-who-agrees-to-a-plugins-scopes).

## The spike

P10, P11 and X8 depend on browser behaviour this project has not tested. Before they are accepted, a small test page
should answer each of these in current Chrome, Safari and Firefox.

| Question | Why it matters |
| --- | --- |
| Can a sandboxed frame create a blank child frame and take features from it? | It would undo everything the host document removed. This is the likeliest hole. |
| Can a frame navigate itself to an outside address? | Data could leave in the address. |
| Does a sandboxed frame on the app's own domain share a process with the shell? | If so, a plugin stuck in a loop freezes the whole app, and timing attacks on the shell's memory are possible. |
| Can WebRTC or DNS lookups still reach outside hosts? | Low-bandwidth leaks. |
| Can the plugin's bundle load as a module in a frame with no origin? | If not, the bundle has to be inlined into the host document. |
| Do inline styles and Thixo's components render under the policy? | "Render anything" (S3) depends on it. |

If the answers are bad, the alternative is to serve plugins from a separate domain, which the browser isolates much
more strongly. That conflicts with X8 as written. All three first targets can provide a second hostname, so X8 may
be the requirement to give up.

## What the implementor has to provide

| Requirement | Why |
| --- | --- |
| An identity function | Thixo asks it who the user is and which scopes they hold. Any session mechanism works, including a cookie. |
| A signing key | Thixo signs the user's tokens with it. |
| Plugin code never served bare from the app's origin | Opened directly without the sandbox header, it would run with the app's full authority. All plugin code goes through Thixo's plugin route. |
| A host that allows setting response headers | The isolation is delivered by headers. |
| A content security policy that allows the plugin frames | The app must permit framing the plugin route, and only that. |

## What a plugin author has to live with

- **No browser storage.** A sandboxed frame has no cookies, `localStorage` or IndexedDB. Plugin data goes through the
  SDK.
- **No direct network.** Third-party data comes through an API endpoint with a scope (P12).
- **No reach outside the frame.** Navigation, modals, clipboard and downloads are shell services (S8).
- **No third-party libraries,** at least to start (U5). No chart or date library unless Thixo ships one.
- **No background work.** A plugin runs only while it is on screen.

## Options held in reserve

- **Hardened JavaScript.** Locking down the built-in objects so code can touch only what it is handed. It is
  stricter than the globals check and can be awkward with React.
- **A separate plugin domain.** See [the spike](#the-spike).

## Reading

- [The `sandbox` attribute on `<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [The CSP `sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)
- [`window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [Channel Messaging API](https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API)
- [Play safely in sandboxed IFrames](https://web.dev/articles/sandboxed-iframes)
- [How Figma built its plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
