# The language

A first sketch, to be argued with. Four things are decided: plugins are written in a language of Thixo's own that
looks a lot like JavaScript, TypeScript and React (P20), a plugin can't import outside code (P21), the implementor
chooses which libraries are exposed (P22), and a plugin can write raw elements (P23). Everything else on this page is a lean, not a decision.

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

## Still open

- **The name and the file extension.** Keeping `.tsx` gets editor support for free and tells a reader a lie.
- **`undefined`.** Keeping both it and `null` matches what the agent expects. Having one would be cleaner.
- **`while` and recursion.** Counting makes them safe to have. Leaving them out would let the build prove that a
  plugin ends, at the cost of looking less like TypeScript.
- **Regular expressions.** Useful and familiar, and one bad pattern can run for minutes inside a single call that
  counting can't interrupt. Options: leave them out, or ship an engine that can't blow up.
- **How much of TypeScript's types.** Conditional and mapped types are hard to build and the agent rarely needs
  them in a plugin. The SDK's own types may need them.
- **Styling.** Whether a plugin writes CSS, a `style` prop, class names from the implementor's design system or
  only Thixo's components. This is also a containment question, since CSS can load addresses and cover the app.
- **Which raw elements and attributes.** A plugin can write raw elements (P23). Some can't be allowed whatever
  runs the language: `<script>`, `<iframe>`, `<object>`, `<link>`, `<meta>`, `<base>`, and attributes that take
  code or an outside address. The list, and who can extend it, is not written.
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
