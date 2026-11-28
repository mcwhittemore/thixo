# Contributing

## How a change is made

1. **Find what it touches.** The language is [docs/language.md](docs/language.md), what a program can't do is
   [docs/security.md](docs/security.md).
2. **Change the wall with an attack.** Any change to `packages/core` or `packages/react` that lets more
   through comes with a hostile program showing that what it lets through is still inert.
3. **Run it.** `npm test`. For changes to the runtime or `@thixo/react`, also run the benchmark on the goals the
   change could open.
4. **Record what was settled.** When the owner settles a question, turn the matching lean in the docs into a plain
   statement.

## Versions and releases

Every merge to `main` publishes to npm. `.github/workflows/release.yml` publishes each package in `packages/` whose
version isn't on npm yet, `@thixo/core` first, and tags the commit `<name>@<version>`. So a pull request that changes
what a package ships raises that package's version, and `.github/workflows/versions.yml` fails it if it doesn't
(`npm run check-versions -- origin/main` runs the same check).

- **What counts as a change:** anything in the package's folder except `test/`, including `package.json` fields
  other than `version`.
- **Pick the bump by [semver](https://semver.org).** From 1.0.0: major for a breaking change, minor for a new
  feature, patch for a fix. While a package is 0.x: minor for a breaking change, patch for everything else.
  A breaking change is one that can make a working program, host or build stop working: a public type in
  `contract.ts`, an export, a CLI flag or exit code, or the language rejecting a program it accepted. A tighter wall
  that rejects what was a hole is a fix.
- **Bump once per pull request,** from the version on `main`, not once per commit.
- **Pins move with it.** `@thixo/react`, `@thixo/cli` and `@thixo/bench` pin `@thixo/core` to an exact version, and
  `@thixo/bench` pins `@thixo/react` too: its arena page bundles it. Raising a pinned package means updating every
  pin on it, which is a change to each of those packages, so they need a new version too (patch, unless they change
  in some other way).

## Rules for the documents

- What is not settled is written down as a lean or as open. Nothing is left implied.
- File and folder names are kebab-case.
