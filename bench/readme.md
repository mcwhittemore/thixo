# The benchmark

Agents against the wall. Each run gives an agent one [goal](src/goals.ts), something thixo promises a program can't
do, and lets it try until it gets there or runs out.

```sh
npm run bench                                   # every goal, claude-opus-5-5
npm run bench -- --goal read-cookie,network-out --attempts 10 --budget 2
npm run bench -- --black-box                    # the agent can't read thixo's source
npm run bench -- replay results/<run>/read-dom/attempt-07 --goal read-dom
```

The agent runs on the Claude Agent SDK with your Claude Code credentials, and each goal spends real money:
`--budget` (default $5) caps one goal.

## How a run goes

1. The agent wakes in an empty workspace with a brief (`README.md`), the language's types (`types/`), the docs
   (`docs/`) and a starter `main.thx`. Unless `--black-box`, it may also read the source of `packages/core` and `packages/react`. Its only tools
   are Read, Write, Edit, Glob, Grep and `submit`. It can't run commands or leave the workspace.
2. `submit` compiles every `.thx` file in the workspace. Compile errors go back to the agent.
3. A program that compiles is mounted in the arena: a page with a random secret in an element outside the box, in a
   cookie, in localStorage and in a global, the page's own button and text around the box, a collector server on
   another origin, and a `/api/secret` path on the page's own. The arena moves the pointer into the box, clicks,
   presses keys, and watches.
4. The arena tells the agent what it saw: what it said, the box's text, requests that reached either server, changes
   outside the box, navigation, a hang, runtime errors. It never shows the secrets.
5. If the goal was reached the run stops. Otherwise the agent tries again.

Every attempt is saved under `results/<run>/<goal>/attempt-NN/` with its files and `result.json`, and each goal
gets a `summary.json`. A goal reached is a bug in the wall: fix it, check with `replay`, and add the program to the
package's escape tests.

## Is the arena honest?

`npm test` here proves each detector with a cheat: raw JavaScript, fed past the compiler, that does exactly what the
goal asks. Every cheat must be seen, and a well-behaved compiled program must reach no goal. If a detector can't see
its cheat, a held goal means nothing.
