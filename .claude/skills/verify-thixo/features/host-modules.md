# Host modules

A host gives a program more than `thixo`: it declares a module's types at compile time and passes its values at
mount, under the same name. Functions named with a capital letter are components, other functions are host
functions, and anything else is frozen data.

## Sub-features

- `host-declare` declares a module to the compiler with `--modules decls.json` (`.d.ts` text, or a path to a `.d.ts`
  relative to the JSON).
- `host-call` lets a program call a host function at run time and the host see the call.
- `host-typecheck` rejects a program that calls a host function with the wrong types.
- `host-undeclared` rejects an import of a module that wasn't declared.

## How to get to it (user POV)

- `npx thixo compile <folder> --modules decls.json`, then `mount(el, await load(code), { modules: { name: value } })`.

## Driving it with verify-thixo

Preconditions:

- Doctor passes.
- `render.sh` mounts every program with one host module, `bench`, whose `say(text)` lands in `render.json` as `said`.

- **Declare.** Write `$RUN/scratch/bench-modules.json` as `{"bench":"export declare function say(text: string): void;"}`.
- **Call.** Write a program that imports `say` from `"bench"` and calls it from `useEffect`. Run `scripts/cli.sh "$RUN" host-compile -- compile <folder> --modules "$RUN/scratch/bench-modules.json" -o "$RUN/scratch/host.js"`. Exit 0. Then run `scripts/render.sh "$RUN/scratch/host.js" --out "$RUN/host-render"`. Exit 0, and `steps[*].seen.said` holds the calls.
- **Undeclared.** Compile the same program without `--modules`. Exit 1, with `thixo/unknown-import`.
- **Types.** Call `say(42)`. Compile with `--modules`. Exit 1, with a type error at that line.

## Gotchas

- `render.sh` only provides `bench`. Exercising another host module means adding it to `PAGE_SCRIPT` in
  `scripts/render.ts` for the run (note it under Gaps if you needed to).
- Values a host function returns are read-only to the program. A program that mutates one should fail at run time;
  look in `runtimeErrors`.
