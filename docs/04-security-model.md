# Security model

How a plugin is contained. The requirement is P1: it must be impossible for a plugin to make a call outside its
scopes. The rest of this document is the proposed way to meet it.

## What we are defending against

A plugin is code written by an agent or by another person, running in front of a user who may hold more access than
its author.

| Threat | Example |
| --- | --- |
| Calling past its scopes | A plugin that uses only `todos.read` calls `payroll.write` with an admin's access. |
| Stealing the session | A plugin reads the user's cookie or token and sends it somewhere. |
| Leaking data | A plugin allowed to read todos sends them to an outside server. |
| Reaching into the app | A plugin reads or changes the shell's page, or another plugin's. |
| Destroying data | A plugin version wipes what another version wrote. See [plugin data](05-plugin-data.md). |

The first target is colleagues in one company, where the likely cause is a mistake or an agent doing more than it
was asked. The model is built for the stranger case anyway (W4), because retrofitting isolation is the hard
direction.

Users are not asked to approve scopes per plugin (P7). Containment has to work without them.

## Three layers

No single layer is enough. Each covers what the others can't.

### At build

The registry builds every version from source and never accepts a prebuilt bundle (U4), so the checks run on exactly
the code that ships.

- **Import allowlist (U5):** a plugin may import the SDK, React, Tailor's components and its own files. Imports are
  static in JavaScript, so this check is sound.
- **Scope derivation (P2):** the endpoints imported are the plugin's scopes. This rests on the allowlist.
- **Globals check (U6):** any reference to a name outside an allowlist is flagged. This catches direct use of
  `fetch`, `RTCPeerConnection`, `location`, `eval` and the like.
- **Schema extraction (D3):** the data fields and their hash come from the plugin's declared types.

Static analysis of JavaScript can't prove a plugin never reaches something, because code can build names at runtime.
That is why this layer isn't trusted alone.

### In the browser

- **Sandboxed frame (P10):** the plugin runs in a frame with scripts allowed and same-origin access not allowed. The
  browser gives it an origin of its own, so it can't read the shell's cookies, storage or page.
- **No network (P11):** the plugin route sends a content security policy with everything denied by default. That
  blocks `fetch`, WebSockets, beacons, and loading images, fonts or scripts from other hosts.
- **No code from strings:** the policy leaves out `unsafe-eval`, so `eval` and the `Function` constructor fail. This
  closes the main way around the globals check.
- **Host document runs first:** Tailor owns the document inside the frame. Before the plugin loads, it removes
  constructors a plugin must not have, such as `RTCPeerConnection`.
- **No child frames, workers or popups:** each would give the plugin a fresh copy of what the host document removed.
- **Frames stay put:** the shell's own policy limits what its frames may load, so a plugin can't send data out by
  navigating itself to another site.

### At the API

- **The plugin holds no token (P8).** The broker in the shell makes the call.
- **Narrowed token (P9).** For each user and plugin version, the API issues a token limited to the scopes both have.
  The API verifies it on every call. This is the layer that makes P1 true: whatever happens in the browser, the API
  won't carry out a call the plugin's version wasn't built with.

## What the implementor has to provide

The origin rules put requirements on the app, not only on Tailor.

| Requirement | Why |
| --- | --- |
| Auth that can issue and verify narrowed tokens | A cookie-only session can't be limited per plugin. |
| Plugin code never served bare from the app's origin | Opened directly without the sandbox header, it would run with the app's full authority. All plugin code goes through Tailor's plugin route. |
| A host that allows setting response headers | The isolation is delivered by headers. |
| A content security policy that allows the plugin frames | The app must permit framing the plugin route, and only that. |
| The user's token kept out of anything a plugin can read | The broker uses it. It never crosses the message channel. |

## What a plugin author has to live with

- **No browser storage.** A sandboxed frame has no cookies, `localStorage` or IndexedDB. Plugin data goes through the
  SDK.
- **No direct network.** Third-party data comes through an API endpoint with a scope (P12).
- **No reach outside the frame.** Navigation, modals, clipboard and downloads are shell services (S8).

## Known gaps

These are not closed, and the docs should not claim they are.

| Gap | Standing |
| --- | --- |
| A plugin leaks data through an endpoint it is allowed to call | Not a containment problem. It is a question of which scopes exist. |
| WebRTC reaching outside hosts | Removed by the host document. The policy directive for it exists, but browser support is unchecked. |
| DNS lookups leaking a few bytes | Historical. Low bandwidth. Unchecked in current browsers. |
| A blank child frame restoring removed features | The policy should refuse it. Needs a test in each browser. |
| A frame navigating itself away | The shell's policy should refuse it. Needs a test in each browser. |

Every "needs a test" above becomes a test in the framework's suite before the first release.

## Options held in reserve

- **Hardened JavaScript.** Locking down the built-in objects so code can touch only what it is handed. It is
  stricter than the globals check and can be awkward with React.
- **A separate plugin domain.** Stronger than a sandboxed frame on one domain. Ruled out as a requirement by X8, and
  possible as an option.

## Reading

- [The `sandbox` attribute on `<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [The CSP `sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)
- [`window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
- [Channel Messaging API](https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API)
- [Play safely in sandboxed IFrames](https://web.dev/articles/sandboxed-iframes)
- [How Figma built its plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
