# Contributing

## How a change is made

1. **Find what it touches.** The language is [docs/language.md](docs/language.md), what a program can't do is
   [docs/security.md](docs/security.md).
2. **Change the wall with an attack.** Any change to `packages/core` or `packages/react` that lets more
   through comes with a hostile program showing that what it lets through is still inert.
3. **Run it.** `npm test`. For changes to the runtime or `@thixo/react`, also run the benchmark on the goals the
   change could open.
4. **Record what was settled.** When the owner settles a question, turn the matching lean in the docs into a plain
   statement.

## Rules for the documents

- What is not settled is written down as a lean or as open. Nothing is left implied.
- File and folder names are kebab-case.
