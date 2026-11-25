# @thixo/core

The compiler, the runtime and the output check. This package is the wall, so a change here needs a test that tries
to get past it. Linting and formatting will live here too.

```ts
import { compile } from "@thixo/core";

const r = compile({ "main.thx": source }, { modules: { "@host/palette": { dts } } });
if (r.ok) r.code; // export default function (rt) { ... }
else r.errors;    // [{ file, line, column, code, message, hint? }]
```

- `compile(files, { entry?, modules? })` returns `{ ok: true, code, imports, links, sourceHash }` or the errors.
- `verifyOutput(code)` parses emitted code again and fails if it names anything it did not declare. `compile` runs
  it before returning.
- `THIXO_DTS` and `LIB_THX_DTS` are the types of the built-in module and of the language's own lib.

## `@thixo/core/runtime`

`createRuntime(host)` makes the guard object compiled code runs against. [@thixo/react](../react) is built on
it; a host that brings its own renderer can use it directly.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
