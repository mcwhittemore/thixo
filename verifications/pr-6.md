# Verification: PR #6

Addresses: none
Revision: 206347c

## Verified

- **The published packages work from a clean install: `npx thixo` compiles and `@thixo/core` embeds.**
  `npm pack -w @thixo/core -w thixo -w @thixo/react`, `npm i` the three tarballs plus react and react-dom into an
  empty folder, then `npx --no-install thixo compile p -o out.js` and `npx --no-install thixo compile bad`
  Saw: exit 0 and a 236-byte `out.js`. On a program that names `document`: exit 1 and
  `main.thx:1:46 thixo/no-global \`document\` does not exist in the language.` with `hint: Render elements with JSX instead.`
  In the same folder, `node api.mjs` calls `compile` from `@thixo/core` on a good program and on one that names `fetch`.
  Saw: `ok: true [] | bad: false [ 'thixo/no-global' ]`. `import("@thixo/react")` exports `load,mount,thixoModule,wrapModule`.
  Before the change: the same install of `thixo` packed from origin/main, then `npx --no-install thixo compile p -o out.js`.
  Saw: exit 1, `npm error could not determine executable to run`. The bin was in `thixo-cli`.
- **The publish targets are the new names, and the scoped packages publish publicly.**
  `npm publish --dry-run -w @thixo/core`, the same for `-w thixo` and `-w @thixo/react`
  Saw: `name: @thixo/core` (38 files) `with tag latest and public access`, `name: thixo` (6 files) `default access`,
  and `name: @thixo/react` (5 files) `public access`.
- **Doctor passes on the renamed folders.**
  `.claude/skills/verify-thixo/scripts/doctor.sh` in a fresh worktree after `npm install` and `npm run build`
  Saw: exit 0, with `ok` for `packages/core/dist`, `packages/cli/dist` and `packages/react/dist`, and
  `thixo command answers (usage, exit 2)`. `npm install` succeeds. With the lockfile from origin/main, `npm install`
  after the folder renames failed with `404 Not Found - GET https://registry.npmjs.org/thixo-node`, because of its
  stale `extraneous` entries at `packages/cli` and `packages/core`. A fresh origin/main checkout, without the renames,
  installs fine.
- **The build and the tests.**
  `npm run typecheck`, `npm test`
  Saw: typecheck exit 0. Core 314/314, CLI 5/5, arena 13/13, and 0 failures.
- **compile-folder, compile-json: the built command compiles the stock fixture from its new path.**
  `scripts/cli.sh "$RUN" 01-compile-orbit -- compile packages/core/test/fixtures/orbit -o "$RUN/orbit.js" --json`
  Saw: exit 0, `"ok": true`, and `orbit.js` written (2242 bytes).
- **render-draw, render-pointer, render-frame: the program mounts through `@thixo/react`.**
  `scripts/render.sh "$RUN/orbit.js" --out "$RUN/02-render-orbit"`
  Saw: exit 0, `ok: true`, six steps with 0 runtime errors, and no page errors. The circle moves from (226, 164) at
  `mounted` to (118, 98) at `pointer-at-quarter`. `r` goes 4 → 6 at `pointer-held` and back to 4 at `pointer-released`,
  then keeps drifting with no input: (97, 104), then (89, 103).
- **wall-replay: the arena bundles `@thixo/react` from its new path and holds.**
  `npm run -s bench -- replay "$PWD/packages/core/test/fixtures/orbit" --goal read-dom`
  Saw: exit 0, `requests to the page's origin: none`, `changes outside the box: 0; drew outside the box: false`,
  `window.__pwned: false`, and `runtime errors: none`.
- **No old name is left in a live file.**
  `git ls-files | grep -v -e package-lock -e '^verifications/' | xargs grep -nE "thixo-cli|thixo-react|packages/thixo"`
  Saw: only `tmpdir(), "thixo-cli-"`, a temp-folder prefix in `packages/cli/test/cli.test.ts`.

## Not verified

- A new escape or guard test. The change to `packages/core` and `packages/react` covers only package names, import
  specifiers, `publishConfig` and one comment in `thixo-dts.ts`. No compiler or runtime code changed, so there's
  nothing for a hostile program to get through that it couldn't before. The existing escape and guard tests pass
  (core 314/314 above).
- A real `npm publish`. It's outward-facing and the owner hasn't asked for it yet. The dry runs above show what would
  go up.
- The bots and the CI check running on this PR. loopway's MCP endpoint wasn't reachable (ENDPOINT_NOT_FOUND), so this
  PR was opened with `gh` from the owner's account, not as loopway-bot. GitHub had an open incident that degraded pull
  requests and Actions when it was opened.
- `todo-list`, `--entry`, host modules and `render-keys`. Nothing in how they're driven changed except the path they
  load from, and the paths are checked above.

## Gaps

- `render.sh` reports the blob URL `load` imports the program from as an off-origin request
  (`GET blob:http://127.0.0.1:…`). origin/main does the same (checked by rendering orbit in an origin/main worktree),
  so it's not from this change. Because of it, `offOriginRequests` is never empty, and a real off-origin request is
  easy to miss. `render.ts` should skip `blob:` URLs from its own origin.
- verify-thixo has no feature for packaging. "Install the packed tarballs and run `npx thixo`" was driven by hand. An
  `install` feature with a `scripts/pack.sh` would make it repeatable.
- The pstack skills the dev bot names (`unslop`, `blast-radius`, `prove-it-works`) weren't installed in this session.
  Blast radius was checked with the grep above.

## Evidence

Local evidence folder: `artifacts/verify/20261125-110020-npm-names/` (not committed; rerun the commands above to
reproduce). The origin/main baseline is in `artifacts/verify/base/` in the `.worktrees/base-main` worktree.
