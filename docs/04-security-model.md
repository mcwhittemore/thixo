# Security model

How a plugin is contained. The requirement is P1: it MUST be impossible for a plugin to make a call outside its
scopes. A plugin's code runs in the app's page, compiled from the plugin language (P7), so what contains it is the
language and the broker, not a sandbox. This document says how that works, what it does not cover, and what has to
be tested.

## What we are defending against

A plugin is code written by an agent for one person and shared with others, running in front of a user who may hold
more access than its author.

| Threat | Example | Covered by |
| --- | --- | --- |
| Calling past its scopes | A plugin built with only `getTodo` calls a payroll endpoint with an admin's access. | This document |
| Stealing the session | A plugin reads the user's cookie or token. | This document |
| Leaking data to the outside | A plugin allowed to read todos sends them to an outside server. | This document |
| Reaching into the app | A plugin reads or changes the shell's page, or another plugin's. | This document, with gaps |
| Destroying data | A plugin version wipes what another version wrote. | [Plugin data](05-plugin-data.md) |
| Using an admin's access | A plugin that openly imports a payroll endpoint is shared by someone who can't run payroll, and an admin uses it. | The author cap (P3) |
| Moving data between users | A plugin reads with one user's access and writes it into an annotation other users can see. | **Not covered** |
| Hanging the app | A plugin, or a library it was given, loops forever. | **Not covered** |

The last two rows are not solved. See [what P1 does not cover](#what-p1-does-not-cover).

The model is built for strangers' plugins (W3), because retrofitting containment is the hard direction.

## What is trusted

P1 holds only if these hold. Everything else is treated as hostile.

| Trusted | For what |
| --- | --- |
| The API | Verifying tokens and enforcing the user's scopes. |
| The compiler | Turning the language into JavaScript that reaches only what the language allows. Its output is the only plugin code that runs. |
| The shell, including the broker | Holding each plugin to its manifest and its author's scopes, and never handing a plugin the user's session or token. |
| Libraries the implementor exposes | They are ordinary JavaScript, outside the language, trusted the way the app's own code is (L3). |

Two consequences worth stating:

- **The API can't see a plugin.** The broker is the only thing holding a plugin to its manifest. A shell that lies,
  or a broker with a bug, can do anything the user can. That is acceptable, because the shell already holds the
  user's session.
- **The compiler is the whole wall.** There is no sandbox behind it. One bug in what it lets through gives a plugin
  the page and the session, so it is tested by an agent whose only job is to break out.

## Three layers

### At build

The registry compiles every version from its source, so the checks run on exactly the code that ships.

- **Only the language (L1):** anything that isn't in the language is an error. The compiler works from what is
  allowed, never from a list of what is banned.
- **Imports (L2, L3, U4):** the SDK, the slot definitions and the libraries the implementor exposes. Dynamic imports
  are rejected.
- **Endpoint and scope derivation (P2):** the endpoints imported are what the plugin may call.
- **The manifest (L8):** endpoints, scopes, data schema and shell services, derived, never written by hand.
- **Schema extraction (D3):** the data fields and their hash come from the plugin's declarations, which are written
  in a literal form so the build can read them without running the code (U8).

### In the page

- **No network (L4):** the language has no fetch, sockets or anything like them.
- **No runnable sources (L6):** no frames, scripts, event-handler attributes or `javascript:` addresses. A plugin
  handles events only through the language.
- **Fixed addresses (L7):** an address is written out in the source or handed in. A plugin can't build one, so it
  can't put data in one.
- **Its own slot (P8):** a plugin's styles are scoped to its slot. It reaches anything outside the slot through
  shell services (S8), and `navigate` goes only to routes inside the app.
- **Only while on screen (P7):** there is no background work.

### In the broker and at the API

- **The plugin reaches only the SDK (P5).** It holds no token. The broker in the shell makes the call.
- **The broker holds each plugin to its manifest (P1).** It forwards a call only for an endpoint in that version's
  manifest whose scopes the plugin's author holds (P3).
- **The API enforces the user's scopes (A4).** Every call carries the user's token.

## What P1 does not cover

P1 stops a plugin doing what it was not built to do. Two more rules cover a plugin doing what it openly was built to
do:

- **The author cap (P3).** A plugin never runs with more than its author could do. A plugin written by someone who
  can't run payroll can't run payroll for an admin either.
- **Using it is agreeing to it (P2).** The registry shows what a plugin uses. There is no prompt.

What is still open:

- **Annotations other users see are a way out.** A plugin can read with the current user's access and write what it
  read into an annotation its author can see (A11). No network is needed. Stores are private to each user (D2), so
  they are not a way out today.
- **A later version can ask for more.** If users follow the newest version of a shared plugin, its author can add an
  endpoint and every user picks it up.
- **The authoring agent reads other people's plugins.** Text in a plugin's source or description could steer the
  agent when it works for someone else.
- **A plugin can hang the page.** Code on the page's main thread can't be stopped from outside, so not hanging the
  app is a goal for the language, not a promise
  ([decision 44](07-decisions.md#44-a-plugin-that-hangs-is-a-goal-not-a-requirement)).

See [open questions](08-open-questions.md#1-who-agrees-to-a-plugins-scopes).

## The spike

Before [decision 42](07-decisions.md#42-plugin-code-runs-in-the-page-compiled-from-the-language), a plugin was to
run in a sandboxed frame. A spike tested that on 2026-11-19 and 2026-11-20. The code and full
results are in [`spikes/isolation`](../spikes/isolation/readme.md) on the `isolation-spike` branch.

It ran in Playwright's Chromium 159, Firefox 159 and WebKit 27.2, and in the installed Chrome 157. The freeze test
also ran in the installed Safari 17.6 and Firefox 95. Playwright's WebKit is not the Safari people use, so a
WebKit-only result needs a check in Safari before anything rests on it.

| Question | Answer |
| --- | --- |
| Can a sandboxed frame create a child frame and take features from it? | Yes, one way. A blank child frame gives nothing: reading from it throws. But a plugin can write its own script into a child frame's `srcdoc`. The child inherits the policy, so the script is allowed, and the host document never ran there. WebRTC is back, and data left over it in every browser. |
| Can a frame navigate itself to an outside address? | Yes, unless the shell stops it. `location.href`, a clicked link and a `meta` refresh all reached an outside server. A `frame-src` in the shell's own policy, limited to the plugin route, blocked all three in every browser. Popups, forms and navigating the top page were already blocked by the sandbox. |
| Does a sandboxed frame on the app's domain share a thread with the shell? | In Safari and Firefox, yes. See the freeze table below. |
| Can WebRTC or other side channels reach outside hosts? | WebRTC can. The content policy does not cover it, and the `webrtc 'block'` directive changed nothing in any browser. Removing `RTCPeerConnection` in the host document stops it in the plugin's own frame. Two smaller leaks got through the policy. In Chrome 157, `<link rel=prerender>` sent a request whose address can carry data. In Playwright's WebKit, `<link rel=preconnect>` opened a connection with no request, which signals little more than "connected". `fetch`, `XMLHttpRequest`, WebSocket, WebTransport, images, media, fonts, stylesheets, workers and beacons were all blocked. |
| Can the plugin's bundle load in a frame with no origin? | Yes. Inline scripts, modules and `<script src>` from the app all load. `'self'` matches nothing in WebKit, so the policy has to name the app's address. |
| Do inline styles and React render under the policy? | Yes. React 19 runs without `unsafe-eval`. Inline styles, `<style>`, constructed stylesheets, data and blob images, SVG and canvas all render. Fonts need `font-src data:`. |
| Can the frame reach the user's session? | Not from where it sits: cookies and storage throw. If it navigates itself to the app's own domain, the request carries cookies: only `SameSite=None` ones in Chrome and Firefox, but Lax, Strict and HttpOnly ones in WebKit. The shell's `frame-src` blocks that navigation. |

### What a stuck plugin does to the app

Each cell is what happened to the shell while a plugin ran a three-second loop.

| Plugin frame | Safari 17.6 | Chrome 157 | Firefox 95 |
| --- | --- | --- | --- |
| App's domain, sandboxed | Froze | Kept running | Froze |
| Another site | Froze | Kept running | Kept running |

- Safari froze in every arrangement. A second domain does not help there.
- Two plugin frames freeze each other in every browser, Chrome included.
- A sandboxed frame can't start a worker, so a plugin can't move its own work off the thread.
- Firefox 95 is old. Playwright's Firefox 159 agreed with it, and kept running only with site isolation turned on.

No frame arrangement keeps a stuck plugin from freezing the app in Safari. Thixo can't promise that today.

### What the policy has to be

The frame design needed four changes to hold.

- **Hashes, not a nonce.** Plugin code can read a nonce off its own script tag, then load a script from anywhere.
  This worked in all four browsers. A hash leaves no nonce to read.
- **The host document and the plugin load as one script, under one hash.** A child frame made with `srcdoc`
  inherits the policy, so any script the policy allows on its own can be replayed there without the host document.
  When the two are one inline script with one hash, a replay runs the host document's removals first, and nothing
  leaked. Trusted Types (`require-trusted-types-for 'script'`) also blocked the replay, in the browsers that have
  it. This means the plugin's bundle is inlined into the host document, not loaded from an address.
- **The shell needs a policy too.** The implementor's pages have to send `frame-src` limited to the plugin route.
  Without it a plugin can navigate its frame away. Thixo has to set this, which is a new requirement on the shell.
- **`<link>` hints are not covered.** No policy directive stopped the `prerender` and `preconnect` leaks, and they
  are markup, so there is no constructor for the host document to remove. The build can reject them in source. A
  plugin that creates one at run time is not yet stopped.

The policy the spike ended with, for the plugin route:

```
sandbox allow-scripts; default-src 'none';
script-src 'sha256-<host document and plugin, as one inline script>';
style-src 'unsafe-inline'; img-src data: blob:; font-src data:;
frame-src 'none'; child-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'
```

Still to check: a full React plugin under this exact policy (the spike ran React from an address, and the replay
test with a small script), whether a hash plus an address for the bundle can be replayed the same way, a way to stop the two `<link>` leaks at run time with the host document's
removals in place, and the WebKit-only results in Safari.

### Other things it found

- The shell tells frames apart by `event.source`. A sandboxed frame's origin is the string `"null"`.
- A plugin can't draw outside its frame. Menus, dialogs and tooltips that overflow have to be drawn by the shell.
- A frame costs about 35 to 75 ms to start. Twenty on one page took about 120 to 180 ms, against about 30 without
  frames.

### Why it was dropped

The frame could be made to hold, but only with a narrow policy that is easy to get wrong, a leak in Chrome with no
fix, a stuck plugin that freezes the app in Safari whatever the domain, and 35 to 75 ms for every slot. Thixo
controls the language plugins are written in, so it contains them there instead. See
[the coding layer](09-coding-layer.md).

## What the implementor has to provide

| Requirement | Why |
| --- | --- |
| An identity adapter | Thixo asks it who the user is and which scopes they hold. Thixo ships adapters for common identity services, and a custom one can read any session, including a cookie. |
| A signing key | Thixo signs the user's tokens with it. |
| Plugin code only from the compiler | Code that skipped the compiler runs with the app's full authority. All plugin code goes through Thixo's build and its plugin route. |
| Care with exposed libraries | A library that hands a plugin the network or the page undoes the containment for that app. |

## What a plugin author has to live with

- **No browser storage.** The language can't reach cookies, `localStorage` or IndexedDB. Plugin data goes through
  the SDK.
- **No direct network.** Data from outside comes through ways the implementor provides (L4).
- **No reach outside the slot.** Navigation, modals, clipboard and downloads are shell services (S8).
- **Only the libraries the implementor exposes** (L2, L3).
- **No background work.** A plugin runs only while it is on screen (P7).

## Options held in reserve

- **A worker or a WebAssembly runtime.** If the compiler can't be made to hold, either one puts a second wall behind
  it, at a cost in speed. Both were turned down in decision 42.

## Reading

- [The `sandbox` attribute on `<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [Play safely in sandboxed IFrames](https://web.dev/articles/sandboxed-iframes)
- [How Figma built its plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
