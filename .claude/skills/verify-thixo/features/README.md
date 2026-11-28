# thixo verification map

This is the maintained source for verifying what thixo does for its users. Read this index, then use the matching
feature file as the recipe. Name its feature IDs in the verification file.

## Baseline preconditions

- `npm install` and `npm run build` have run in this checkout, and `scripts/doctor.sh` exits 0.
- `RUN=artifacts/verify/<timestamp>-<pr-or-issue>` exists, and every step writes under it.
- Scratch programs go in `$RUN/scratch/`, never in `packages/` or the fixtures.
- The fixtures `packages/core/test/fixtures/orbit` (pointer, frame clock, size, `css`, a relative import) and
  `packages/core/test/fixtures/todo-list` are the stock programs to start from.

## Driving conventions

- `scripts/` means `.claude/skills/verify-thixo/scripts/`.
- Compile with `scripts/cli.sh`, never by importing the compiler. It's the user's path, and it records itself.
- Mount with `scripts/render.sh` and assert on `render.json`. Open the demo site with `scripts/site.sh` and assert
  on `site.json`. Screenshots are for a person to look at; numbers are
  the proof.
- Replay with an absolute folder path.
- Pick inputs where a broken build would give a different answer.

## Proof and skip reporting

- CLI proof: the command, the exit code, and the stdout or stderr line that matters.
- Render proof: the step name and the `render.json` values that change because of the change.
- Site proof: the step name and the `site.json` values (`boxes`, `text`, `errorText`, `boxesChanged`) that change
  because of the change.
- Wall proof: the replay's exit code and its report lines, plus the escape test failing before and passing after.
- A feature you couldn't drive goes under Not verified, with the command you tried and why it failed. Never report
  one entry point as verified through another.

## Feature entry contract

Each feature file has an H1 title and one paragraph, then four H2s in order: `Sub-features`, `How to get to it (user
POV)`, `Driving it with verify-thixo`, `Gotchas`. Keep implementation details out; name user paths, commands,
required state and observable proof.

## Features

- [Compile a program](./compile.md): `thixo compile` on a folder or file, `-o`, `--entry`, `--json`.
- [Reject what's out of the language](./compile-errors.md): diagnostics, hints, exit codes, `--json` errors.
- [Host modules](./host-modules.md): `--modules` declarations at compile, values at mount.
- [Run in a page](./render.md): mount with @thixo/react; draw, animate, and respond to pointer, keys and size.
- [The wall holds](./wall.md): arena replay per goal, and the escape and guard tests.
- [The demo site](./site.md): `packages/site` built, served under `/thixo/` and driven. Any change to `packages/site`
  is verified here.
