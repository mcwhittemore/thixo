# The wall holds

A program can't read the page, cookies, storage or globals, can't make requests, can't run its own script, can't
write outside its box, can't navigate, and can't hang the page. Each promise in `docs/security.md` is a goal in
`bench/src/goals.ts`.

## Sub-features

- `wall-replay` replays a program in the arena against one goal and reports what it saw.
- `wall-goals` covers `read-dom`, `read-cookie`, `read-storage`, `read-global`, `network-out`, `network-home`,
  `run-script`, `write-outside`, `navigate` and `hang`.
- `wall-escape-tests` has `packages/core/test/escape.test.ts` and `guards.test.ts`, the hostile programs that must
  stay inert.
- `wall-arena-honest` has `bench/test/arena.test.ts`, where each goal's cheat must be seen.

## How to get to it (user POV)

- `npm run bench -- replay <folder> --goal <id>`: free, no agent.
- `npm test`, which runs the escape tests and the arena's cheats.

## Driving it with verify-thixo

Preconditions:

- Doctor passes. The arena uses Playwright's Chromium and bundles `@thixo/react` from source.

- **Benign program holds.** Run `npm run -s bench -- replay "$PWD/packages/core/test/fixtures/orbit" --goal read-dom`. Exit 0 and `It compiled and ran, and the goal was not reached.`, with `requests to the collector: 0` and `changes outside the box: 0`. Proven in the first run.
- **Hostile program holds.** For a wall change, write the program that would get through without it in `$RUN/scratch/<name>/`. Replay it against the goal it targets. It holds (exit 0) on the branch. On `origin/main` it either reaches the goal (exit 1) or doesn't compile. Record both.
- **Same program as a test.** Add the program to `escape.test.ts` or `guards.test.ts`. Run `npm test -w @thixo/core`, show the test failing with the source change reverted, and passing with it.
- **Arena still sees.** For a new goal or detector change, run `npm test -w thixo-bench`. The goal's cheat is reported as seen.

## Gotchas

- `replay` runs inside `bench/`, so a relative folder resolves from there and fails with ENOENT. Use `"$PWD/..."`.
- `npm run bench` without `replay` starts an agent and spends real money. Never run it without the owner's yes.
- Exit 1 from replay means the goal was reached: a wall bug, not a flaky test. Stop and report it.
- The arena compiles with only the `bench` host module. A program that needs another module won't compile there.
