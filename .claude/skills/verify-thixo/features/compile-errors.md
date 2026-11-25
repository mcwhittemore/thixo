# Reject what's out of the language

A program that uses anything outside the language (a page global, an unknown import, a left-out construct, a type
escape) doesn't compile. The author gets `file:line:column code message` and, often, a hint.

## Sub-features

- `reject-global` rejects page globals like `document`, `window` and `fetch` (`thixo/no-global`).
- `reject-import` rejects imports other than `thixo`, declared host modules and relative files (`thixo/unknown-import`).
- `reject-construct` rejects what `docs/language.md` lists under "What is out" (classes, `eval`, `any`, `as`, `==`,
  regular expressions, `<script>`, and so on).
- `reject-json` reports errors as `{ "ok": false, "errors": [...] }` on stdout with `--json`.
- `reject-exit` exits 1 for source errors and 2 for usage errors.

## How to get to it (user POV)

- Compile a program that breaks a rule: `npx thixo compile <folder>`.
- The same, with `--json`, the way tools and agents read it.

## Driving it with verify-thixo

Preconditions:

- Doctor passes.

- **Global.** Write `$RUN/scratch/bad-global/main.thx` with `export default function Peek() { return <p>{document.cookie}</p>; }`. Run `scripts/cli.sh "$RUN" reject-global -- compile "$RUN/scratch/bad-global"`. Exit 1. stderr has `main.thx:2:14 thixo/no-global` (the line and column depend on your layout) and `hint: Render elements with JSX instead.`
- **Import.** Import `say` from `"bench"` without `--modules`. Exit 1, with `thixo/unknown-import` and `hint: A program can import: thixo.`
- **Construct.** For a change to a rule, write one program that hits it. Exit 1 and the rule's code. Write a second program that is legal and differs only there. Exit 0.
- **JSON.** Add `--json` to any failing step. Exit 1. stdout parses with `"ok": false` and each error has `file`, `line`, `column`, `code` and `message`.

## Gotchas

- A rejection is only proof next to an acceptance. Pair every "must not compile" with a near-identical "must
  compile", or a broken compiler that rejects everything passes.
- Line and column are 1-based, counted in the `.thx` source.
- Code at the top level of a file, other than declarations, is itself an error. Keep test programs inside functions.
