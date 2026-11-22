# thixo-thx

thx is the language a plugin is written in. A plugin is a folder of `.thx` files: `plugin.thx`, an optional
`data.thx`, and any other `.thx` file it imports by a relative path. The package has the compiler, a check on the
compiler's output, and the in-page runtime that runs the result. This package is the wall that keeps a plugin inside
what the app allows, so changes here need a test that tries to get past it.

## Exports

### `thixo-thx`

The compiler and the output check.

```ts
import { compile, verifyOutput } from "thixo-thx";

const result = compile({ "plugin.thx": source }, env);
if (result.ok) verifyOutput(result.code);
```

- `compile(files, env)` takes the plugin's files and the environment the app gives it (the modules it may import and
  the app's slots). It returns `{ ok: true, code, ... }` or the errors, each with a file, line and column.
- `verifyOutput(code)` parses the emitted code again. It fails if the code names anything it did not declare.
- `sourceHash(files)` and `schemaHash(schema)` give the hashes the registry uses to find a version again.
- `LIB_THX_DTS` is the type declarations of thx's own library, as `.d.ts` text.

### `thixo-thx/runtime`

```ts
import { createRuntime } from "thixo-thx/runtime";
```

`createRuntime(host)` returns the in-page runtime. Compiled plugin code calls it for every field read, call and
element. A record a plugin gets is frozen. Functions and elements have no fields at all, so a plugin cannot reach
into them.

### `thixo-thx/contract`

The types the other packages code against: `Compiler`, `CompileEnv`, `CompileResult`, `SourceFiles`, `ModuleDecl`,
`Runtime` and `RuntimeHost`.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
