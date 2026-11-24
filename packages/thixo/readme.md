# thixo

The compiler, the in-page runtime, the browser host and the `thixo` command. This package is the wall, so a change
here needs a test that tries to get past it.

## `thixo compile`

```sh
thixo compile <folder|file.thx> [-o out.js] [--entry main.thx] [--modules decls.json] [--json]
```

Compiles a program to one ES module. `--modules` is a JSON file mapping each host module's specifier to its `.d.ts`
text, or to a `.d.ts` path relative to the JSON. Errors print as `file:line:column code message`. Exit code 0 when
it compiled, 1 when the source has errors, 2 for bad usage.

## `thixo`

```ts
import { compile } from "thixo";

const r = compile({ "main.thx": source }, { modules: { "@host/palette": { dts } } });
if (r.ok) r.code; // export default function (rt) { ... }
else r.errors;    // [{ file, line, column, code, message, hint? }]
```

- `compile(files, { entry?, modules? })` returns `{ ok: true, code, imports, links, sourceHash }` or the errors.
- `verifyOutput(code)` parses emitted code again and fails if it names anything it did not declare. `compile` runs
  it before returning.
- `THIXO_DTS` and `LIB_THX_DTS` are the types of the built-in module and of the language's own lib.

## `thixo/browser`

```ts
import { load, mount } from "thixo/browser";

const handle = mount(element, await load(code), {
  modules: { "@host/palette": { colors: ["#f00", "#0f0"], pick: (i: number) => i % 2 } },
  onError: (e) => console.warn(e),
});
handle.unmount();
```

Mounts a program with React in a box that fills `element` and clips it. Builds the `thixo` module (hooks, frame
clock, pointer, size, keys) and wraps each host module: functions named with a capital are components, other
functions are host functions, anything else is copied in as frozen data. `load` needs the page to allow `blob:`
scripts. React and react-dom are peer dependencies.

## `thixo/runtime`

`createRuntime(host)` is the lower layer `mount` is built on, for a host that brings its own renderer.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
