# The coding layer

From a discussion on 2026-11-20. It replaced the sandboxed frame as the way a plugin is contained. Plugins are
written in a language of Thixo's own ([decision 24](07-decisions.md#24-plugins-are-written-in-a-language-of-thixos-own)),
compiled to JavaScript that runs in the app's page
([decision 42](07-decisions.md#42-plugin-code-runs-in-the-page-compiled-from-the-language)). The requirements are in
[the plugin language](02-requirements.md#the-plugin-language) and P5 to P8.

## Where it comes from

[The spike](04-security-model.md#the-spike) showed that a sandboxed frame can be made to hold, but at a price: a
narrow policy that is easy to get wrong, a leak in Chrome with no fix yet, a stuck plugin that freezes the app in
Safari, and a frame's cost in every slot.

Matthew's point: a frame is how you contain code you don't control. Thixo controls this code. Plugins are written
only by Thixo's authoring agent or the implementor (P6), in whatever language Thixo gives them. So control the language, and most of those
problems have nowhere to happen. In his words, it should be "a coding layer, not a new version of HTML".

## The idea

- **A plugin is code, in Thixo's own language.** It looks a lot like JavaScript, TypeScript and React, and the
  agent writes it against the SDK. `examples/todo` shows roughly how it reads.
- **It is not new markup.** A plugin uses ordinary HTML elements and CSS. There is no Thixo vocabulary of boxes and
  stacks to learn, and S3 and S4 stand.
- **Thixo controls what the code can reach.** The compiler turns a plugin into JavaScript that runs in the app's
  page and can name nothing the language doesn't give it: no `document`, no `window`, no network. It has the SDK and
  nothing else (P5, P7).
- **It draws into its slot.** The plugin's JSX becomes real elements in the app's page, inside its slot, with its
  styles scoped to the slot (P8).

The safety comes from what the code can reach, not from who wrote it. The agent is the only author, but users
steer it and plugins are shared, so its output is treated like anyone's. A plugin that was talked into misbehaving
can still only call the endpoints it imports, within its scopes (P1) and its author's (P3).

Elm contains its programs this way: what the language can't say, the program can't do.

## What it changes

| | Sandboxed frame | Coding layer |
| --- | --- | --- |
| WebRTC, child frames, navigating away, `prerender` | Each needs a policy rule or a removal. One has no fix yet. | The language has no way to name them (L4, L6). |
| A stuck plugin | Freezes the app in Safari. | Can still freeze the app: code in the page can't be stopped from outside. Counted loops cover the language, not libraries. |
| Cost per slot | 35 to 75 ms a frame. | No frame. The cost of the compiled code is not yet measured. |
| Menus, dialogs, tooltips | Clipped to the frame. The shell has to draw them. | Drawn in the page like any other element. |
| One plugin per row of a list | Ruled out by frame cost. | Possible. |
| The plugin's styles | Can't touch the app. | Share the app's page. Has to be solved. See below. |

## What it costs

- **The compiler is the whole wall.** There is no sandbox behind it. One bug in what it lets through gives a plugin
  the page and the session.
- **The plugin's elements live in the app's page.** A plugin's CSS could restyle the app, cover the app's own
  buttons or fetch an outside address with `url()`. Its styles have to be scoped to its slot and filtered for what
  they can load.
- **A stuck plugin can't be stopped.** Counting loops and calls in the compiled code covers the language. A long
  call into a built-in or an exposed library is not covered.
- **Thixo has to build and keep the compiler,** and the tooling the agent needs around it.

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

Also decided: a plugin can't import outside code (L2). It can't install an npm package. It imports the SDK and
the libraries the implementor exposes (L3). Thixo is a framework: it provides the way to expose a library, and
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

Decided: compile to JavaScript and run it in the page
([decision 42](07-decisions.md#42-plugin-code-runs-in-the-page-compiled-from-the-language)). The options weighed:

| Option | What contains the plugin | Concern |
| --- | --- | --- |
| A WebAssembly runtime that interprets the language, in a worker | The runtime. The plugin gets only what the runtime hands it. | Slower, a larger download, and every event crosses to a worker and back. |
| Compile to JavaScript and run it in the page | The compiler. Its output is the only plugin code that ever runs: the store keeps the source, never JavaScript. | The compiler is the whole wall. One bug in it gives a plugin the page and the session. A stuck plugin needs a counter compiled into its loops, since nothing can stop it from outside. |
| Compile to JavaScript and run it in a worker | The compiler, then the worker. | Events cross to a worker and back. What a worker can reach on the app's domain is untested. |

Compiling to JavaScript and running in the page renders real elements directly, so events are immediate and there
is no bridge to build. It is also the option with only one wall.

Checking ordinary JavaScript at build, with no compiler that owns the language, is not on the list. It rejects
what it recognises, and that has a long record of being got round.

[The language](10-language.md) is a first sketch of the language, and ends with what compiling to JavaScript
has to get right.

## What has to be tested first

- How well does the agent write the language, measured against how well it writes TypeScript?
- Can the compiler's output be escaped? Give the job to an agent whose only task is to break out.
- Do compiled loop counters stop a stuck plugin, and what do they cost?
- What does the compiled code add to the download and to a slot's start time?
- Can a plugin's CSS be scoped so that it can't touch or cover the app? Which properties have to be filtered?
- Which elements and attributes go on the allowlist, and which URL forms are allowed in them?

## What is still open

- How a plugin measures layout, manages focus and draws on a canvas.
- Whether a worker or a runtime is kept in reserve, if the compiler can't be made to hold.
