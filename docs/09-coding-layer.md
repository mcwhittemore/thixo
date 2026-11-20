# The coding layer

A proposal, from a discussion on 2026-11-20. It would replace the sandboxed frame (P10, P11) as the way a plugin
is contained. One part is decided: plugins are written in a language of Thixo's own
([decision 23](07-decisions.md#23-plugins-are-written-in-a-language-of-thixos-own)). The rest is proposed.

## Where it comes from

[The spike](04-security-model.md#the-spike) showed that a sandboxed frame can be made to hold, but at a price: a
narrow policy that is easy to get wrong, a leak in Chrome with no fix yet, a stuck plugin that freezes the app in
Safari, and a frame's cost in every slot.

Matthew's point: a frame is how you contain code you don't control. Thixo controls this code. Plugins are written
only by Thixo's authoring agent, in whatever language Thixo gives it. So control the language, and most of those
problems have nowhere to happen. In his words, it should be "a coding layer, not a new version of HTML".

## The idea

- **A plugin is code, in Thixo's own language.** It looks a lot like JavaScript, TypeScript and React, and the
  agent writes it against the SDK. `examples/todo` shows roughly how it reads.
- **It is not new markup.** A plugin uses ordinary HTML elements and CSS. There is no Thixo vocabulary of boxes and
  stacks to learn, and S3 and S4 stand.
- **Thixo controls what the code can reach.** Plugin code runs where there is no page: no `document`, no
  `window`, no network. It has the SDK and nothing else.
- **The shell draws for it.** The plugin's JSX produces a description of elements. The shell creates the real
  elements in the app's own page and sends events back to the plugin.

The safety comes from what the code can reach, not from who wrote it. The agent is the only author, but users
steer it and plugins are shared, so its output is treated like anyone's. A plugin that was talked into misbehaving
can still only call the endpoints it imports, within its scopes (P1) and its author's (P14).

Shopify's remote-dom and Figma's plugin runtime work this way, so the pattern is proven.

## What it changes

| | Sandboxed frame | Coding layer |
| --- | --- | --- |
| WebRTC, child frames, navigating away, `prerender` | Each needs a policy rule or a removal. One has no fix yet. | The plugin has no page to do them from. The shell creates only elements and attributes on an allowlist. |
| A stuck plugin | Freezes the app in Safari. | Runs off the main thread, so the shell stays live and can stop it. Not yet tested. |
| Cost per slot | 35 to 75 ms a frame. | No frame. The cost of the runtime is not yet measured. |
| Menus, dialogs, tooltips | Clipped to the frame. The shell has to draw them. | Drawn in the page like any other element. |
| One plugin per row of a list | Ruled out by frame cost (S9). | Possible. |
| The plugin's styles | Can't touch the app. | Share the app's page. Has to be solved. See below. |

## What it costs

- **No direct access to the page.** Measuring an element, moving focus, drawing on a canvas and reading a
  selection all happen in the page. Each needs a path through the SDK, or a plugin can't do it.
- **Libraries that touch the page don't work.** A chart or editor library that expects `document` can't run in a
  plugin. Thixo would have to offer the common ones as shell-side components.
- **Events arrive late.** The plugin hears about a click after it happened. Cancelling an event, dragging and text
  inputs that correct themselves as you type all need design.
- **The plugin's elements live in the app's page.** This is the new risk. A plugin's CSS could restyle the app,
  cover the app's own buttons or fetch an outside address with `url()`. The shell has to scope a plugin's styles to
  its slot and filter what they can load.
- **Thixo has to build and keep the bridge:** the allowlist, the event forwarding and the runtime.

## The language, and where it runs

There are two questions. The first is decided and the second is open.

### What the agent writes

Decided: a new language, which looks a lot like JavaScript, TypeScript and React.

- **It is Thixo's language, not a subset of someone else's.** Thixo says what it means. Where JavaScript is
  dangerous or odd, the language can differ: no globals, no prototypes, no `constructor`, no `eval`, no way to
  reach a value the SDK did not hand over.
- **It looks familiar on purpose.** The agent has read a great deal of TypeScript and React and none of this
  language. The closer the two read, the better the agent writes it.
- **Anything not in the language is an error.** The compiler works from a list of what is allowed, never from a
  list of what is banned.

Also decided: a plugin can't import outside code (P21). It can't install an npm package. It imports the SDK and
the libraries the implementor exposes (P22). Thixo is a framework: it provides the way to expose a library, and
the implementor decides which ones their app's plugins get.

An exposed library is ordinary JavaScript, outside the language. The implementor is trusting it, in the same way
they are trusted to get their endpoints right. A library that hands a plugin the network or the page undoes the
containment for that app.

Turned down: full TypeScript, where the language can say anything and all the containment has to come from where
it runs. Also a language that looks nothing like TypeScript, which the agent would write badly.

Still open about the language:

- Its name and its file extension.
- Where it differs from TypeScript, written down as a list the agent is given.
- Whether it has TypeScript's types, a smaller set or its own.
- How an implementor exposes a library, and how its types reach the agent so that it knows what it can call.
- Whether an exposed library runs in the page or beside the plugin, and what Thixo checks about one, if anything.
- Whether a library is part of what a plugin "uses" in the registry, as its endpoints are.
- What a shared plugin does in an app that doesn't expose a library it imports.
- How errors are reported to the agent so that it can fix its own code.
- Who writes the type checker, the formatter and the editor support, and how much of TypeScript's tooling can be
  reused because the syntax is close.

### What runs it

| Option | What contains the plugin | Concern |
| --- | --- | --- |
| A WebAssembly runtime that interprets the language, in a worker | The runtime. The plugin gets only what the runtime hands it. | Slower, a larger download, and every event crosses to a worker and back. |
| Compile to JavaScript and run it in the page | The compiler. Its output is the only plugin code that ever runs: the store keeps the source, never JavaScript. | The compiler is the whole wall. One bug in it gives a plugin the page and the session. A stuck plugin needs a counter compiled into its loops, since nothing can stop it from outside. |
| Compile to JavaScript and run it in a worker | The compiler, then the worker. | Events cross to a worker and back. What a worker can reach on the app's domain is untested. |

Compiling to JavaScript and running in the page is worth a close look. The plugin would render real React elements
directly, so events are immediate and there is no bridge to build. Elm contains its programs this way. It is also
the option with only one wall.

Checking ordinary JavaScript at build, with no compiler that owns the language, is not on the list. It rejects
what it recognises, and that has a long record of being got round.

**Lean:** let a spike settle it. Start with compiled JavaScript in the page, with loop counters, and fall back to
the WebAssembly runtime if the single wall is not enough.

## What it does to the requirements

- **Stand as they are:** P1 to P9, P12 to P15, and all of the API and data requirements. The broker still makes
  every call (P8).
- **Replaced:** P10 and P11, by P17 to P19 below.
- **No longer needed:** S9, most of S8, and X8, since there is no frame and no second domain to argue about.
- **Narrowed:** S3. A plugin can render any element and style on the allowlist. It can't run code in the page.

Drafts, listed as Proposed in the [requirements](02-requirements.md):

| # | Requirement |
| --- | --- |
| P16 | Plugins are written only by Thixo's authoring agent. Nobody uploads plugin code. |
| P20 | Plugins are written in a language of Thixo's own, which looks a lot like JavaScript, TypeScript and React. Decided. |
| P21 | A plugin can't import outside code or install packages. It imports the SDK and the libraries exposed to it. Decided. |
| P22 | The implementor decides which libraries are exposed to plugins. Thixo provides the way to expose one. Decided. |
| P17 | Plugin code runs outside the page, with no access to the page, the network or the user's session. The SDK is everything it can reach. |
| P18 | A plugin draws by describing ordinary HTML elements and styles. The shell creates them in the app's page from an allowlist, and scopes the plugin's styles to its slot. |
| P19 | The shell can stop a plugin that does not respond, without the app freezing. |

## What has to be tested first

- How well does the agent write the language, measured against how well it writes TypeScript?
- Can the compiler's output be escaped? Give the job to an agent whose only task is to break out.
- Do compiled loop counters stop a stuck plugin, and what do they cost?
- If a runtime in a worker is used: is typing in an input fast enough to feel direct?
- Can the shell stop a stuck plugin in Safari, Chrome and Firefox?
- What does the runtime add to the download and to a slot's start time?
- Can a plugin's CSS be scoped so that it can't touch or cover the app? Which properties have to be filtered?
- Which elements and attributes go on the allowlist, and which URL forms are allowed in them?
- If a plain worker is used instead: what can it reach on the app's domain, under a policy?

## What is still open

- How a plugin measures layout, manages focus and draws on a canvas.
- Whether the sandboxed frame stays as a fallback for a plugin that needs the real page.
- Whether P16 rules out a developer writing a default plugin by hand, and if so how default plugins get written.
