# The language

A first sketch, to be argued with. Four things are decided: plugins are written in a language of Thixo's own that
looks a lot like JavaScript, TypeScript and React (P20), a plugin can't import outside code (P21), the implementor
chooses which libraries are exposed (P22), a plugin can write raw elements (P23), it can't create an element that
brings in another runnable source (P24), and it can't build an address (P25). Everything else on this page is a lean, not a decision.

What runs the language can't be chosen until the language is known. The last section says which choices here
decide that.

## What the language is for

1. **The agent writes it well.** It should read as TypeScript and React to a model that has seen plenty of both.
2. **A plugin can only reach what it was handed.** There is no way to name the page, the network, a global or
   anything behind a value.
3. **A plugin can always be stopped.** No program in the language can hang the app.
4. **The build can read a plugin without running it.** Its scopes, its data and its slot come from its source
   (P2, U11).

Where 1 pulls against 2 to 4, the others win, and the difference from TypeScript goes on a short list the agent
is given.

## What a plugin looks like

The due-dates example, unchanged. Every line of it is already inside the sketch below.

```tsx
import { definePlugin, useAnnotation, useQuery, useStore } from "thixo/plugin";
import { DateInput, NumberInput, Stack, Text } from "thixo/ui";
import { todoDetail } from "@app/slots";
import { getTodo } from "@app/sdk";
import { due, prefs } from "./data";

export default definePlugin(todoDetail, { name: "Due dates" }, function DueDate({ context }) {
  const todo = useQuery(getTodo, { id: context.todoId });
  const [dates, patchDates] = useAnnotation(due, context.todoId);
  const [settings, patchSettings] = useStore(prefs);

  const warnDays = settings?.warnDaysBefore ?? 2;
  const close = dates?.dueOn && daysUntil(dates.dueOn) <= warnDays;

  return (
    <Stack>
      <Text>{todo.data?.title}</Text>
      <DateInput label="Due" value={dates?.dueOn} onChange={(dueOn) => patchDates({ dueOn })} />
      {close && <Text tone="warning">Due soon</Text>}
    </Stack>
  );
});

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}
```

## What is in

| | |
| --- | --- |
| Modules | `import` and `export`, with fixed names. A plugin imports the SDK, the exposed libraries and its own files. |
| Values | Numbers, strings, booleans, `null`, `undefined`, lists, records, functions, dates. |
| Bindings | `const` and `let`. Destructuring, spread and default values. |
| Functions | Declarations and arrows. Closures. `async` and `await`. |
| Control | `if`, `for ... of`, `while`, `switch`, `return`, the `? :` operator, `&&`, `\|\|`, `??`, `?.`. `try` and `catch`. |
| Text | Template strings. The usual string, number and list methods: `map`, `filter`, `reduce`, `find`, `sort`, `slice`, `split`, `join` and the like. |
| Built-ins | `Math`, `Date`, `JSON`, `Map`, `Set`. Each is the language's own, with a fixed list of methods. |
| JSX | Raw elements such as `<div>` and `<svg>` (P23), exposed components, fragments, props, children, event handlers. Hooks, which come from the SDK. |
| Types | TypeScript's annotations: `type`, `interface`, unions, generics, optional fields. Checked at build. |

## What is out

| Left out | Why |
| --- | --- |
| Globals: `window`, `document`, `globalThis`, `fetch`, `setTimeout`, `localStorage` | A plugin reaches the app through the SDK, which has timers and storage of its own. |
| `eval`, `Function`, `import()` | Code from a string, or chosen at run time, can't be read by the build. |
| Classes, `this`, `new` on anything but the built-ins, prototypes, `constructor`, `__proto__` | This is where JavaScript subsets have been escaped. React plugins are functions and don't need them. |
| `Proxy`, `Reflect`, `Symbol`, getters and setters, `with`, `var`, `delete`, labels | Each lets code do something its text doesn't show. |
| `any`, `as`, `// @ts-ignore`, non-null `!` | Each switches the type checker off. The types are part of the wall, so they can't be optional. |
| Elements that bring in another runnable source: `<script>`, `<iframe>`, `<object>`, `<embed>`, and attributes that take code | Decided (P24). Each would run code the language does not control. |
| Refs and the real event object | Both are handles on the page. A handler gets plain data: the value, the key, the position. |
| `==` and `!=` | Only `===` and `!==`. One fewer way for the agent to be subtly wrong. |
| Code at the top of a file, other than declarations | A file can then be read without being run (U11). |

## Where it differs from TypeScript

These are the places where code that looks the same means something else. This is the list the agent is given.

- **A record has only the fields it was given.** `todo.title` reads a field. There is nothing behind it: no
  prototype, no `constructor`, no inherited method. `todo[key]` reads a field by name and nothing else.
- **Methods belong to the language.** `list.map` is the language's `map`. A plugin can't replace it, and can't
  add a method to every list.
- **Values handed to a plugin can't be changed.** Context from a slot and results from a query are read-only. A
  plugin changes things by calling an endpoint or patching its data.
- **Every loop and call is counted.** A plugin that runs too long is stopped with an error the user can see.
- **Imports are checked against a list.** Importing anything that is not the SDK, an exposed library or the
  plugin's own file is a build error.
- **Anything not in the language is a build error.** There are no warnings.

## Addresses

Decided on 2026-11-20, as P25. An image, a link, a font or a CSS `url()` runs nothing, but each sends
a request, and the address can carry data out. The rule: an address in a plugin is one of two things.

- **Written out in the source.** `<img src="https://example.com/logo.png">`. It is fixed when the plugin is built,
  so it can't carry anything the plugin learned while running.
- **Handed to the plugin from outside it.** An avatar address that an endpoint returned, or a route from the
  shell. The plugin passes it along and can't look inside it or change it.

A plugin can't build an address, join one from parts or add to one. In the language this is a type of its own,
`Url`, which is not a string. No string operation produces one.

What this buys:

- A plugin can't put data it holds into an address, which is the leak. It needs no rule about which hosts are
  allowed.
- The build can list every outside address a plugin names, and the registry can show them (P15).

**Writing an address back** is part of the rule. If a plugin could save a string to a record and read it back as
an address, the rule would be empty. So a field that holds an address is declared as one, and a plugin can only
write a `Url` to it, never a string. Where a user types an address in, the shell is what turns it into one.

### Choosing between fixed addresses

Open. The rule stops a plugin putting data into an address. It does not stop a plugin choosing which address to
load, and the choice is itself a message.

Say a plugin has 256 image addresses written out in its source, all on a server its author runs:
`.../0.png` to `.../255.png`. It reads one byte of something it can see, such as a character of a customer's
name, and shows the image with that number. The author's server sees which image was asked for and now knows the
byte. A row of images, or one image changed on a timer, sends the whole name.

Every address is fixed and none was built, so P25 is kept and the data still leaves.

Options:

| Option | Effect |
| --- | --- |
| Copy at build. The build fetches every outside address a plugin names for an image, font or style, and stores the file with the plugin's version. At run time it loads from the app. | Nothing loads from outside, so there is no server to watch the choice. Fits versions being fixed (W3). An image that changes on the outside server stops changing. |
| The implementor lists the outside hosts plugins may load from. None by default. | The leak is left open only to hosts the implementor chose. |
| Show the addresses in the registry and accept it. | Relies on someone noticing 256 addresses on one host. |

**Lean:** copy at build. A link the user clicks, `<a href>`, can't be copied and is left as it is: it leaks only
which link the user chose to click, where they can see it.

## Styles

A first sketch. Nothing here is decided.

CSS matters for containment in three ways: it can load an address, it can reach elements that are not the
plugin's, and it can draw over the app.

### What a plugin writes

| Option | For | Against |
| --- | --- | --- |
| Style objects with states, compiled to classes: `css({ padding: 8, ":hover": { ... }, "@media (min-width: 600px)": { ... } })` | Typed, so every property and value is checked. No selectors, so a plugin can only style its own elements. Agents know the shape from CSS-in-JS. The build turns fixed styles into a stylesheet. | Not every CSS feature fits. Each one has to be added on purpose. |
| A `style` prop only | The simplest thing. | No hover, focus, media queries or animation. Too weak alone. |
| Class names from a set the implementor exposes, such as their design system or Tailwind | Agents write these very well. Plugins match the app. The implementor decides, as with libraries (P22). | Only as flexible as the set. |
| CSS as text | Everything CSS can do. | Has to be parsed and filtered, selector by selector. The largest surface. |

**Lean:** style objects are the language's own way. The `style` prop takes the same objects, for values worked
out while running. Class names from the implementor are a library they can expose. No CSS as text.

### The rules, whichever is chosen

- **No selectors that reach out.** A style applies to the element it is given to, and to its states. A plugin
  can't write `body`, `*`, `:root` or anything that matches by position in the page.
- **An address in a style is a `Url`** (P25). No `@import`.
- **The slot is a box.** The shell wraps each slot so that a plugin can't draw outside it: `position: fixed`,
  a huge `z-index` and negative margins all stay inside. Without this a plugin could cover the app's own buttons
  with look-alikes.
- **Menus, dialogs and tooltips need to leave the box.** They come from the shell or from exposed components,
  which draw them on the plugin's behalf.
- **The app's design tokens are readable.** A plugin can use the implementor's colours and spacing by name (S4).
  It can't redefine them outside its slot.
- **Class names are generated.** Two plugins can't collide, and a plugin can't guess the app's class names to
  restyle them.

### Open

- Which CSS features the style objects carry at first: animations, grid, container queries, pseudo-elements.
- Whether "the slot is a box" is done with CSS containment or a shadow root, and what each does to fonts,
  inherited colour and focus.
- How a plugin's styles are delivered: one stylesheet per version, built ahead, or added as the plugin runs.
- Whether an implementor can let a trusted plugin draw outside its slot.

## Still open

- **The name and the file extension.** Keeping `.tsx` gets editor support for free and tells a reader a lie.
- **`undefined`.** Keeping both it and `null` matches what the agent expects. Having one would be cleaner.
- **`while` and recursion.** Counting makes them safe to have. Leaving them out would let the build prove that a
  plugin ends, at the cost of looking less like TypeScript.
- **Regular expressions.** Useful and familiar, and one bad pattern can run for minutes inside a single call that
  counting can't interrupt. Options: leave them out, or ship an engine that can't blow up.
- **How much of TypeScript's types.** Conditional and mapped types are hard to build and the agent rarely needs
  them in a plugin. The SDK's own types may need them.
- **Styling.** See [Styles](#styles).
- **The list of elements and attributes.** A plugin can't create anything that brings in another runnable source
  (P24): no `<script>`, `<iframe>`, `<object>` or `<embed>`, and no attribute that takes code. The full list is
  not written, and neither is who can extend it. `<link>`, `<meta>` and `<base>` don't run code themselves, but
  each can load or redirect what the page does, so they probably belong on it.
- **Addresses.** See the section below. The rule is proposed (P25), and three parts of it are open.
- **Links.** Whether `<a href>` can point outside the app. It loads nothing into the plugin, but the address can
  carry data out when the user clicks.
- **How an exposed library looks from inside the language.** It is JavaScript, so its values have prototypes. The
  boundary has to turn what it returns into the language's own values, or wrap it.
- **Errors for the agent.** What a build error says, so that the agent can fix its own code in one pass.
- **Tooling.** Whether the type checker is TypeScript's own, run after Thixo's parser has rejected what is out.
- **Default plugins.** Whether a developer writes them in the same language by hand (P16).

## What this tells us about what runs it

Three choices on this page decide between compiling to JavaScript and a WebAssembly runtime.

| If the language has | Compiling to JavaScript | A WebAssembly runtime |
| --- | --- | --- |
| Records with nothing behind them | Every field read by a computed name needs a guard in the compiled code, and every built-in method needs to be the language's own. This is the hard part, and where an escape would be found. | Free. The runtime's values are its own. |
| Counted loops and calls | A counter compiled into every loop and function. A long call into a built-in, such as a sort or a pattern match, is not counted. | Free, and it covers built-ins too. |
| Raw elements | Every element passes through one check against a list. The plugin never holds the element. | The same check, on the shell's side. |

Raw elements are decided (P23), and they don't settle this. Writing `<div>` in the language produces a
description of an element, which is data. What matters is what a plugin can do with an element:

- **It never holds one.** There are no refs and no real event object, so a plugin has no handle on the page to
  call methods on or walk outward from.
- **Some elements and attributes do things by existing.** `<script>`, `<iframe>`, a `javascript:` address, raw
  HTML as a string, a CSS `url()`. These are kept out by a list, checked where the description becomes an element.

Both hold in compiled JavaScript as well as in a runtime. The check is one function that every element passes
through, so compiling to JavaScript in the page is still on the table.

What is left to decide the call is how strict records have to be, and how far counting has to reach. A
WebAssembly runtime gives both for free and costs speed. Compiled JavaScript is fast, and has to earn both with
guards and counters in its output.
