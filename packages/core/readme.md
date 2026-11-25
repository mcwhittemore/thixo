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
- A host module's `dts` uses the types the language reads (see [the language](../../docs/language.md)): a
  conditional or mapped type in it is a compile error, as is a name it uses that doesn't exist. Each module's
  declarations are checked once per process.

It has no dependencies. The parser, the type check and the hash are its own, and nothing in the compile path needs
Node, so a host can compile on an edge worker, in a browser or in Node. `test/budget.test.ts` holds the package to
a size and a speed: the bundle under 100 KB gzipped, and the readme's Spin compiled in under 5 ms, the first time
and every time after. To make the first time fast, the module compiles a tiny program when it loads, which adds about
13 ms to the import; an edge worker pays that at startup, not in a request.

## `@thixo/core/runtime`

`createRuntime(host)` makes the guard object compiled code runs against. [@thixo/react](../react) is built on
it; a host that brings its own renderer can use it directly.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`. `test/like-typescript.test.ts` runs each of
its programs through TypeScript as well, which is a dev dependency only.
