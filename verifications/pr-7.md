# Verification: PR #7

Addresses: none
Revision: the license commit on mit-license, on top of 4df3f68

## Verified

- **Each published package packs the license and declares it.**
  `npm publish --dry-run -w @thixo/core` (and `-w thixo`, `-w @thixo/react`), then `npm pkg get license repository.directory -w <pkg>`
  Saw: `1.1kB LICENSE` in each tarball (39, 7 and 6 files, up from 38, 6 and 5), and
  `{"@thixo/core":{"license":"MIT","repository.directory":"packages/core"}}`, the same with `packages/cli` for `thixo`
  and `packages/react` for `@thixo/react`.
- **The build and the tests are unchanged.**
  `npm run build`, `npm test`
  Saw: core 314/314, CLI 5/5, arena 13/13, and 0 failures.
- **The lockfile moves only by the license fields.**
  `git diff origin/main -- package-lock.json`
  Saw: three added lines, each `"license": "MIT"`.

## Not verified

- The render, CLI and replay drives. No code changed, only package metadata and new LICENSE files.
- The real npm publish. That comes after this merges.

## Gaps

- None.

## Evidence

Local evidence folder: none. The commands above print everything quoted here.
