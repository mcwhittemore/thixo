# thixo

A language that reads as TypeScript and React and compiles to JavaScript that can't reach the page it runs in. See
[readme.md](readme.md).

- `docs/decisions.md` is append-only, and only the project's owner settles an entry. Entries 1 to 60 are history
  from the framework thixo started as (in the history, at commit `58adb67`).
- `docs/language.md` says what the language is. Where it says **lean**, the build took a side the owner has not
  settled; don't present a lean as a decision.
- `docs/security.md` says what a program can't do. Each promise there is a goal in `bench/src/goals.ts`; keep them
  in step.
- `packages/thixo` is the wall. A change to the compiler, the runtime or `thixo/browser` needs a test that tries to
  get past it (`test/escape.test.ts`, `test/guards.test.ts`).
- `packages/thixo/src/contract.ts` is the package's public types. Change it with its readme.
- A goal a benchmark agent reaches is a bug: fix the wall, check with `npm run bench -- replay`, and add the program
  to the escape tests.
- A new goal needs a cheat in `bench/test/arena.test.ts` that proves the arena can see it.
- Name files and folders in kebab-case.
- [contributing.md](contributing.md) says how a change is made.

## Commands

- `npm install`, then `npm run build` builds the package. `npm test` runs the package's tests and the arena's.
- `npx thixo compile <folder> -o out.js` compiles a program.
- `npm run bench -- --goal <id>` runs an agent against one goal. It spends real money; ask before running it.
