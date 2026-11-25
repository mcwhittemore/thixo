# Compile a program

`thixo compile` turns a folder of `.thx` files (or one entry file) into one ES module, written to a file or to
stdout, with a JSON summary for tools.

## Sub-features

- `compile-folder` compiles a folder whose `main.thx` default-exports the component.
- `compile-file` compiles from one `.thx` file; its folder is the program and the file is the entry.
- `compile-entry` picks a different entry with `--entry`.
- `compile-out` writes the module to `-o out.js` and prints nothing.
- `compile-json` prints `{ ok, imports, links, sourceHash }`, plus `code` when there's no `-o`.
- `compile-usage` prints the usage line and exits 2 on bad arguments.

## How to get to it (user POV)

- `npx thixo compile <folder> -o out.js` (the README's command).
- `npx thixo compile <folder>/main.thx`.
- `npx thixo compile <folder> --json`.

## Driving it with verify-thixo

Preconditions:

- Doctor passes.
- `packages/thixo/test/fixtures/orbit` exists and is unchanged.

- **Folder to file.** Run `scripts/cli.sh "$RUN" compile-folder -- compile packages/thixo/test/fixtures/orbit -o "$RUN/orbit.js"`. Exit 0, empty stdout, and `$RUN/orbit.js` exists and is non-empty.
- **JSON summary.** Run `scripts/cli.sh "$RUN" compile-json -- compile packages/thixo/test/fixtures/orbit --json`. Exit 0. stdout parses as JSON with `"ok": true`, `"imports": ["thixo"]`, a 64-hex `sourceHash`, and a `code` string.
- **Stable hash.** Run the JSON step twice. The two `sourceHash` values are equal. Edit a comment in a scratch copy and the hash changes.
- **File entry.** Copy orbit to `$RUN/scratch/orbit`, then run `scripts/cli.sh "$RUN" compile-file -- compile "$RUN/scratch/orbit/main.thx" --json`. Exit 0, same `imports`.
- **Usage.** Run `scripts/cli.sh "$RUN" compile-usage -- compile`. Exit 2, and stderr starts `usage: thixo compile`.
- **Proof the output runs.** Feed `$RUN/orbit.js` to `scripts/render.sh` (see [render.md](./render.md)). Exit 0.

## Gotchas

- `cli.sh` runs `packages/thixo-cli/bin/thixo.js`, which imports `dist`. Without `npm run build` you are testing
  old code. Doctor catches it.
- Files and folders starting with `.`, and `node_modules`, are skipped when a folder is read.
- With `--json` and no `-o`, the code is inside the JSON. Without `--json` and without `-o`, the raw module goes to
  stdout.
- Compiling succeeds or fails as a whole. There are no warnings, so "exit 0 with stderr output" is itself a finding.
