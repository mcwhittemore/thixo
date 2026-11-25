# Verification: PR #5

Addresses: none
Revision: evidence taken at 39e69f5 plus the uncommitted verify-thixo skill, rerun after the skill's last edit

## Verified

- **The bot files load in loopway.**
  `node -e "import('<loopway>/dist/bots.js').then(m => m.loadBots('.'))"` with loopway 2.1.0's own parser.
  Saw: `dev ['issue']`, `epic ['issue']`, `review ['pull_request']`, and no parse errors.
- **Doctor answers on a built checkout.**
  `.claude/skills/verify-thixo/scripts/doctor.sh`
  Saw: exit 0. Seven `ok` lines: node 22.13.0, npm install, dist built for thixo, thixo-cli and thixo-react, thixo
  answers with usage and exit 2, Chromium installed.
- **compile-folder, compile-json: the CLI compiles a real program.**
  `scripts/cli.sh "$RUN" 01-compile-orbit -- compile packages/thixo/test/fixtures/orbit -o "$RUN/orbit.js" --json`
  Saw: exit 0, `"ok": true`, `"imports": ["thixo"]`, a sourceHash, and `orbit.js` written.
- **render-draw, render-pointer, render-frame: the compiled program mounts with thixo-react and follows the pointer.**
  `scripts/render.sh "$RUN/orbit.js" --out "$RUN/02-render-orbit"`
  Saw: exit 0, `ok: true`, six steps, no runtime errors. The circle centroid moves from (199, 149) at `mounted` to
  (99, 74) at `pointer-at-quarter`, the radius goes 4, 6, 4 across `pointer-held`, and `cx` drifts between steps with
  no input. The screenshots show five dots in the box.
  Before the change: the first version of `render.sh` put the pointer at the box's centre, where orbit sits anyway,
  so the pointer step proved nothing. The fix moved it to the quarter point.
- **reject-global: a program that names `document` is rejected.**
  `scripts/cli.sh "$RUN" 03-compile-rejects-document -- compile "$RUN/bad-global"`
  Saw: exit 1, `main.thx:2:14 thixo/no-global \`document\` does not exist in the language.` and
  `hint: Render elements with JSX instead.`
- **wall-replay: the arena replay runs free and reports held.**
  `npm run -s bench -- replay "$PWD/packages/thixo/test/fixtures/orbit" --goal read-dom`
  Saw: exit 0, `It compiled and ran, and the goal was not reached.`, collector requests 0, outside changes 0.
  With a relative path it failed with ENOENT under `bench/`. That's recorded as a gotcha in `features/wall.md`.
- **host-declare, host-call, render-keys: a host module and useKeys work through the real path.**
  `scripts/cli.sh "$RUN" 05-compile-host-module -- compile <say-keys> --modules bench-modules.json -o say-keys.js`, then
  `scripts/render.sh say-keys.js --out "$RUN/06-render-keys"`
  Saw: exit 0 both times. `boxText` is `"no keys"` until `arrow-right-held`, where it's `"ArrowRight"`. `said` records
  `keys: ArrowRight`.
- **host-undeclared: the same program without `--modules` is rejected.**
  `scripts/cli.sh "$RUN" 07-compile-unknown-module -- compile <say-keys>`
  Saw: exit 1, `thixo/unknown-import \`bench\` can't be imported.`
- **Cleanup leaves the evidence and nothing running.**
  `rm -rf "$RUN/scratch"`, then `pgrep -fl "Chrome for Testing|render.ts"`
  Saw: no processes; all 33 evidence files are still under `$RUN`.
- **The CI check fails without this file and passes with it.**
  `.claude/skills/verify-thixo/scripts/check-verification.sh 5`
  Saw: before this file existed, exit 1 and `verifications/pr-5.md is missing`. With it, exit 0 and `ok`.

- **The epic bot's small-change check works on a real PR.**
  `gh pr view 5 --json additions,deletions,files`
  Saw: `additions=988 deletions=0 files=19`. This PR touches `.github/`, `.loopway/` and
  `.claude/skills/verify-thixo/`, so under the new rules it's **owner review**, which is correct for a change to the gates.
- **The bot files still load after the small-change edits.**
  The same `loadBots` call as above.
  Saw: `dev ['issue'] 4190`, `epic ['issue'] 7036`, `review ['pull_request'] 3705` (prompt lengths), no errors.

## Not verified

- The workflow on GitHub itself. Only its script ran, locally. The first push of this PR is its first real run.
- Making the check required for merging. That's a branch protection setting, not something this PR can change.
- `npm test` and `npm run typecheck`. This PR changes no package code. `render.ts` isn't covered by the repo's
  typecheck (it runs through tsx), so type errors in it would show up only at run time.
- The bots running under loopway on a real issue. Nothing here starts loopway. The prompts are checked for parsing,
  not behavior.
- The `todo-list` fixture, `--entry`, the `compile-usage` path through `cli.sh`, and `render-size` with a box of
  another size.

- That the bots apply the small-change limits and P1/P2/P3 grading as written. Both are prompt rules, and no bot has
  run on a real epic yet.

## Gaps

- The small-change limits are prose the epic bot applies, not a CI check humans can't edit, which is how the article
  enforces them. A `small-change` check computed from the diff would make them binding.

- `render.sh` mounts only the `bench` host module. Verifying another host module means editing `render.ts`; a
  `--host <module.js>` flag would fix that.
- The render box is always 400×300, so `useSize` is checked at one size only. A `--size WxH` flag would let
  `render-size` be checked properly.
- No way to typecheck `.claude/skills/verify-thixo/scripts/render.ts` with the repo's `tsc` setup.
- loopway can't open a draft PR, so a PR exists for a moment without its verification file, and CI is red until the
  follow-up push.

## Evidence

Local evidence folder: `artifacts/verify/20261125-095125-skill-proof/` (not committed; rerun the commands above to
reproduce)
