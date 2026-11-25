---
name: verify-thixo
description: Prove a change to thixo works by driving it the way a user does. Compile programs with the real `thixo` command, mount them in headless Chromium with @thixo/react and drive the pointer and keys, and replay programs in the benchmark arena. It also writes the verifications/pr-<N>.md file that CI requires on every pull request. Use before opening or approving any thixo pull request, or whenever you need evidence that a compiler, runtime, CLI or host change behaves.
---

# Verify thixo

thixo has three surfaces a user touches. Drive the one the change affects, and often more than one:

| Surface | Who uses it | Driven with |
| --- | --- | --- |
| The `thixo compile` command | Authors and agents writing programs | `scripts/cli.sh` |
| A compiled program mounted in a page by `@thixo/react` | Hosts and the people looking at the box | `scripts/render.sh` |
| The wall: what a program can't reach | Everyone; it's the point of thixo | `npm run bench -- replay` (free) and the escape tests |

The feature map in [features/README.md](features/README.md) says how to drive each feature. Read the matching file
before you drive anything, and use the map's feature IDs in the verification file.

Every pull request needs a verification file, `verifications/pr-<N>.md`, and CI fails without it. Its format is in
[verification-template.md](verification-template.md) and is defined only there. Check a file locally with
`scripts/check-verification.sh <N>`.

## Launch

thixo has no server. Launching means building once per checkout. Each drive is its own short-lived process.

```sh
npm install
npm run build                      # packages/*/dist; the thixo command and render.sh both use dist
npx playwright install chromium    # only if doctor says it's missing
```

Ready means `scripts/doctor.sh` exits 0. Rebuild after every source change: the CLI runs `dist`, not `src`.

Start a run with its own evidence folder, named for what it proves:

```sh
RUN=artifacts/verify/$(date +%Y%m%d-%H%M%S)-pr-<N>     # or -issue-<N> before the PR exists
mkdir -p "$RUN"
```

`artifacts/` is gitignored. Evidence stays on the machine that made it. The verification file quotes the parts that
matter.

## Doctor

```sh
.claude/skills/verify-thixo/scripts/doctor.sh
```

Read-only. It reports the checkout, the revision and uncommitted changes, then checks: node ≥ 22.13, `npm install`
has run, each package's `dist` is newer than its `src`, `thixo` answers with its usage, and Playwright's Chromium is
installed. Run it first, and again whenever a result surprises you. A stale `dist` is the usual reason a fix
"doesn't work".

## Drive

Paths are relative to the repo root. Scripts live in `.claude/skills/verify-thixo/scripts/`.

**Compile**, recorded:

```sh
scripts/cli.sh "$RUN" <step-name> -- compile <folder|file.thx> [-o out.js] [--entry main.thx] [--modules decls.json] [--json]
```

This runs the built command. It saves `command.txt`, `stdout.txt`, `stderr.txt` and `exit-code.txt` under
`$RUN/<step-name>/`, prints them, and exits with thixo's own code: 0 compiled, 1 source errors, 2 bad usage.

**Render**: mount a compiled program and drive it:

```sh
scripts/render.sh <compiled.js> --out "$RUN/<step-name>" [--wait <ms>] [--no-poke] [--gestures <json>]
```

It serves a page with a 400×300 box at (40, 40), loads and mounts the program with `@thixo/react`, and provides the
host module `bench` (`say(text)`; compile with `--modules` to use it). `--gestures` is passed to `mount` as its
`gestures` option, for example `'{"clickSlop":300}'`, `'{"touch":false}'` or `false`. Then it takes these steps, with a screenshot
and a snapshot after each:

1. `mounted`, after `--wait` ms (default 500)
2. `pointer-at-quarter`: the pointer at box (100, 75), deliberately off-centre
3. `pointer-held`: the mouse button down there (this also focuses the box)
4. `pointer-released`
5. `arrow-right-held`: ArrowRight held down
6. `typed-go-enter`: typed `go`, then Enter
7. `pointer-dragged`: the mouse pressed at box (100, 75), dragged to (300, 225) in 10 moves, and released
8. `touch-tapped`: a finger tap at box (300, 75)
9. `touch-dragged`: a finger pressed at box (100, 225), dragged to (300, 225) in 10 moves, and lifted
10. `input-off-mid-drag`: the mouse pressed at box (100, 75) and dragged to (200, 150); the host calls
    `setInput(false)`, the mouse moves on to (250, 150) and is released, then the host calls `setInput(true)`

`render.json` holds, per step: `said`, `boxText`, `boxHtml` and `runtimeErrors`, plus page errors, console lines and
any request that left the page's origin. It exits 0 when the program mounted with no errors and 1 otherwise. Read the
screenshots with your image tool, and assert on `render.json` numbers, not on how a picture looks.

**Wall**: replay a program in the arena, beside secrets it must not reach:

```sh
npm run -s bench -- replay "$PWD/<folder>" --goal <id>    # absolute path: replay runs inside bench/
```

Exit 0 means held and 1 means the goal was reached, which is a bug in the wall. Goal IDs are in `bench/src/goals.ts`.
Never run `npm run bench` without `replay`: it starts an agent and spends real money.

**Tests** are proof too, not instead: `npm run typecheck` and `npm test`. A change to the wall also needs a new
escape or guard test, shown failing before the change and passing after.

## Evidence

Proof standards:

- Drive the real user path: the built `thixo` command, `@thixo/react`'s `load` and `mount`, the arena. Never call
  compiler internals or test-only helpers and call it verification.
- Capture the action and the result: the command and its output, or the step and its snapshot. A final screenshot
  alone proves nothing about what caused it.
- Make the case discriminating. Choose inputs where a broken build would look different: the pointer off-centre,
  a value no default would produce, a program that must be rejected next to one that must compile.
- Show the before and after for a bug: reproduce it on `origin/main` (a second worktree, or `git stash`) and then
  show it gone.
- Check side effects. An `-o` file was written, nothing was written outside the box, and no request left the origin
  (`offOriginRequests` and the arena's request counts).
- Record what you didn't verify, and why. A skipped check written down is fine. A skipped check left out is the
  failure this whole skill exists to stop.

Then write `verifications/pr-<N>.md` from [verification-template.md](verification-template.md), commit it on the PR's
branch, and run `scripts/check-verification.sh <N>`.

## Cleanup

Scripts clean up after themselves: `render.sh` closes the browser and the server it started, and `cli.sh` and replay
are single processes. Nothing is left running. Never `pkill` Chromium or node by name; other runs may be using
them.

Remove scratch programs you wrote for the run (`rm -rf "$RUN/scratch"`), but keep `$RUN` itself: it's the evidence.
`artifacts/verify/` is safe to clear by hand once its PRs are merged.

## Isolation

Runs don't share state. Each `render.sh` and arena replay listens on a random port with its own browser, and each
run writes to its own `$RUN`. Parallel worktrees each need their own `npm install` and `npm run build`.

## Keeping this honest

The Gaps section of every verification file says where verifying was hard. Run `/pstack:maintain-verification-skill`
to fold those gaps and new features back into this skill and its map. When a gap needs product work (a missing
hook, a command that doesn't exist), file it as an issue.
