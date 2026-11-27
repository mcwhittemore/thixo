# The language

thixo is a language that reads as TypeScript and React. It compiles to JavaScript that runs in the page, and that
JavaScript can reach only what the program was handed. Where this page says **lean**, it describes what the build
does today and is not yet decided by the owner.

## What it is for

1. **An agent writes it well.** It should read as TypeScript and React to a model that has seen plenty of both.
2. **A program can only reach what it was handed.** There is no way to name the page, the network, a global or
   anything behind a value.
3. **A program can always be stopped,** as far as the language can make it true. A long call into a built-in or a
   host function can't be interrupted.
4. **The compiler can read a program without running it.** Its imports and the addresses it links to come from its
   source.

Where 1 pulls against 2 to 4, the others win, and the difference from TypeScript goes on the short list below.

## What a program looks like

A program is a folder of `.thx` files. `main.thx` default-exports the component; other files are imported by a
relative path.

```tsx
import { useState, useFrame, usePointer, css } from "thixo";
import { ring } from "./lib/shapes";

export default function Orbit() {
  const [t, setT] = useState(0);
  const pointer = usePointer();
  useFrame((time) => setT(time));

  return (
    <svg width="400" height="300" className={css({ display: "block", background: "#111" })}>
      {ring(12).map((p, i) => (
        <circle key={i} cx={pointer.x + Math.cos(t + p.angle) * 60} cy={pointer.y + Math.sin(t + p.angle) * 60} r={6} fill="tomato" />
      ))}
    </svg>
  );
}
```

```sh
npx @thixo/cli compile ./orbit -o orbit.js
```

## The built-in module

Every program may import from `thixo`. **Lean:** this is the list today.

| Export | What it does |
| --- | --- |
| `useState`, `useMemo`, `useEffect` | React's, with deps compared by value: values cross into the host as fresh copies. |
| `useFrame(fn)` | Calls `fn(time, delta)` once a frame, in seconds, while the host lets its clock run. `time` counts only the frames that ran. |
| `usePointer()` | `{ x, y, down, inside }`, in pixels from the top left of the program's box. |
| `useSize()` | `{ width, height }` of the box. |
| `useKeys()` | The keys held down while the box has focus. |
| `css(style)` | A generated class name for a style object, with `:hover`-style states and `@media` inside it. |

A host may add modules: it declares their types to the compiler (`compile(files, { modules })`) and passes their
values to `mount` under the same names. Anything else a program imports is a compile error.

## What is in

| | |
| --- | --- |
| Modules | `import` and `export`, with fixed names. A program imports `thixo`, the host's modules and its own files. |
| Values | Numbers, strings, booleans, `null`, `undefined`, lists, records, functions, dates. |
| Bindings | `const` and `let`. Destructuring, spread and default values. |
| Functions | Declarations and arrows. Closures. `async` and `await`. |
| Control | `if`, `for ... of`, `while`, `switch`, `return`, `? :`, `&&`, `\|\|`, `??`, `?.`, `try` and `catch`. |
| Text | Template strings, and the usual string, number and list methods. |
| Built-ins | `Math`, `Date`, `JSON`, `Map`, `Set`. Each is the language's own, with a fixed list of methods. |
| JSX | Raw HTML and SVG elements from an allowlist, components, fragments, props, children, event handlers. |
| Types | TypeScript's annotations: `type`, `interface`, unions, intersections, generics, optional fields, tuples, `keyof`, `typeof`, and the lib's `Partial`, `Required`, `Readonly`, `Pick`, `Omit`, `Record`, `Exclude`, `Extract`, `NonNullable`, `Parameters`, `ReturnType` and `Awaited`. Checked at compile. |

## What is out

| Left out | Why |
| --- | --- |
| Globals: `window`, `document`, `globalThis`, `fetch`, `setTimeout`, `requestAnimationFrame`, `localStorage` | A program reaches the page through what it imports. `useFrame` is its clock. |
| `eval`, `Function`, `import()` | Code from a string, or chosen at run time, can't be read by the compiler. |
| Classes, `this`, `new` on anything but the built-ins, prototypes, `constructor`, `__proto__` | This is where JavaScript subsets have been escaped. Components are functions. |
| `Proxy`, `Reflect`, `Symbol`, getters and setters, `with`, `var`, `delete`, labels, regular expressions | Each lets code do something its text doesn't show, or run unbounded inside one call. |
| `any`, `as`, `// @ts-ignore`, non-null `!` | Each switches the type checker off. The types are part of the wall. |
| Conditional types, mapped types, `infer` | Types a component doesn't need. **Lean:** the compiler checks types itself, without TypeScript, and reads only the types listed under "What is in". |
| `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form action>`, `id`, attributes that take code, raw HTML | Each runs code the language does not control, or reaches out of the box. |
| Refs and the real event object | Both are handles on the page. A handler gets plain data: the value, the key, the position. |
| `==` and `!=` | Only `===` and `!==`. |
| Code at the top of a file, other than declarations | A file can then be read without being run. |

## Where it differs from TypeScript

This is the list an agent is given.

- **A record has only the fields it was given.** There is nothing behind it: no prototype, no `constructor`, no
  inherited method. `record[key]` reads a field by name and nothing else.
- **Methods belong to the language.** `list.map` is the language's `map`. A program can't replace it.
- **Values handed to a program can't be changed.** Props and what a host function returns are read-only.
- **Every loop and call is counted.** A program that runs too long in one go (a render, a handler, a frame) is
  stopped with an error.
- **Imports are checked against a list,** and anything not in the language is a compile error. There are no
  warnings.
- **The type check is the compiler's own.** It reads the types under "What is in" the way TypeScript does, and a
  test runs the same programs through both to keep them agreeing. **Lean:** where it can't follow TypeScript it
  refuses rather than guesses. A `let` declared without a value takes the types of what is assigned to it, and a
  comparison between types that can't overlap is not an error. A function made inside an `if` keeps the narrowing
  of a `const`, but not of a `let` that is assigned anywhere, so `let x: string | undefined = "a"; const f = () =>
  x.length;` is refused where TypeScript accepts it.

## Addresses

A program can't build an address. In the language an address is a type of its own, `Url`, which is not a string,
and no string operation makes one. An address in a program is one of two things:

- **Written out in the source,** such as `<a href="https://example.com">`. It is fixed at compile, so it can't carry
  anything the program learned while running.
- **Handed in by the host,** which minted it. The program can pass it along and can't look inside it.

**Lean:** a program loads nothing it wrote out. `<img src>` and a style's `url()` take a `data:` image or font, or a
`Url` the host handed in. An outside address the page fetched with no click would tell that server the program ran,
and a choice between several written-out addresses would carry data in which one was fetched. A written-out link may
go to any `https://` host: it waits for a click.

## Styles

**Lean:** style objects, compiled to generated class names (`css({...})`), and the `style` prop for values worked
out while running. No selectors that reach outside the element, no `@import`, no `position: fixed`. The host mounts
the program in a box with `contain: strict`, so nothing it draws leaves the box.

## Open

- **`undefined`.** Keeping both it and `null` matches what an agent expects. Having one would be cleaner.
- **`while` and recursion.** Counting makes them safe to have. Leaving them out would let the compiler prove a
  program ends.
- **Regular expressions.** Useful and familiar, and one bad pattern can run for minutes inside a single call.
- **The list of elements and attributes,** and who can extend it.
- **Which CSS features the style objects carry:** animations, grid, container queries, pseudo-elements.
- **Errors for the agent.** What a compile error says, so that an agent fixes its own code in one pass.
