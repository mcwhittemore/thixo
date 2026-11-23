# Thixo

A framework for building malleable SaaS products. See [readme.md](readme.md).

The requirements are still being settled, and a first build of the framework now exists beside them.

- `docs/02-requirements.md` is the source of truth. Every requirement in it is decided. What isn't settled goes in
  `docs/09-open-questions.md`, never in the requirements.
- `docs/08-decisions.md` is append-only. Don't add a requirement without an entry there, and don't add an entry for
  something the project's owner has not settled. Old entries keep the ids they were written with.
- `docs/01-concepts.md` defines the vocabulary. Use its words with its meanings.
- `docs/10-implementation.md` says how the build realises the docs and which lean it took where a doc is open. The
  code follows it. A choice there is not a requirement.
- `packages/thx/src/contract.ts` and `packages/core/src/contract.ts` are the contract between packages. Change one
  only with the packages on both sides of it.
- `packages/thx` is the wall that contains a plugin. A change there needs a test that tries to get past it.
- `examples/todo` and `examples/crm` run. Keep them in step with the requirements.
- `.claude/skills/verify-thixo/` is how behaviour is proved: launch, drive, evidence. Update a feature's file when
  the feature changes.
- Name files and folders in kebab-case.
- [contributing.md](contributing.md) says how a change is made.

## Commands

- `npm install`, then `npm run build` builds every package. `npm test` runs every package's tests.
- `npx thixo dev examples/todo` runs an app.
