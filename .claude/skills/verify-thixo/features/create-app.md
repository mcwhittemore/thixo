# Starting a new app with create-thixo-app

`create-thixo-app <name>` makes a new folder with a working Thixo app in it: a todo app with one record and five endpoints, a stand-in login with two users (`ana`, who can't delete, and `ben`, who can), one page slot, one panel slot and one default plugin for each. Run from a Thixo checkout, it links the Thixo packages and React from that checkout with `file:` deps, so `npm install` works with no registry. It gives each default plugin a fresh `plg_` id, refuses a folder that already has files, and prints the next steps. The app it makes runs under `thixo dev`, and the skill launches, doctors and drives it like an example.

## Sub-features

- `create-copies` copies `packages/create-thixo-app/template/` into `./<name>`, with the name in `package.json` and in the shell's heading, and `gitignore` written as `.gitignore`.
- `create-links` writes `file:<checkout>/packages/core`, `.../packages/cli`, `.../packages/thixo-node`, `.../node_modules/react` and `.../node_modules/react-dom` into `package.json` when create-thixo-app runs from a checkout. From npm it keeps the pinned `0.0.1` versions.
- `create-ids` gives each file `plugins/<folder>/plugin.thx` its own `plg_` plus 18 random hex characters, replacing the placeholder id.
- `create-refuse` stops with `<name> already exists and is not empty` and writes nothing when the folder has files. An empty folder is used.
- `create-name` refuses a name that is not lower-case letters, digits and dashes, such as `My App` or `../x`, with `is not an app name`.
- `create-next` prints `Created <name>.`, the checkout it linked, the three next steps (`cd`, `npm install`, `npm run dev`), the two users, and `thixo agent describe` as the language reference.
- `create-optional` is the template's grayed-out action: the todo list imports `deleteTodo` from `@app/sdk/optional` and disables Delete when `useCan(deleteTodo)` is false.
- `create-run` makes an app that `thixo dev` serves and the skill drives: `launch.mjs --dir`, `doctor.mjs`, `drive.mjs`.

## How to get to it (user POV)

- In a checkout, after `npm install` and `npm run build`, run `node <checkout>/packages/create-thixo-app/bin/create-thixo-app.js my-app` in any folder. It makes `./my-app`.
- Then `cd my-app`, `npm install` and `npm run dev`. Open the address dev prints and pick `ana` or `ben` in **Signed in as**.
- Run it a second time with the same name: it stops with `my-app already exists and is not empty.` and does not touch the folder.
- Run it with no name for the usage (exit `1`), or with `--help` (exit `0`).
- To rename the domain, the readme (`packages/create-thixo-app/readme.md`, "Making it your own") lists the files to change together.

## Driving it with a terminal, launch.mjs and drive.mjs

Preconditions:

- `npm install` and `npm run build` have run in the repo root. Node is 22.13 or later.
- `examples-tmp/` at the repo root exists and is git-ignored. Make it with `mkdir -p examples-tmp`. Any other folder works too, outside the repo included.
- `D` below stands for `node ../packages/create-thixo-app/bin/create-thixo-app.js`, run in `examples-tmp/`.

- **Generate.** Run `D notes-app`. Exit `0`; stdout starts `Created notes-app.`, says `thixo, thixo-cli and thixo-node are not on npm yet, so package.json links them, and React, from the Thixo checkout at <repo>`, and lists `cd notes-app`, `npm install`, `npm run dev`. `grep '"thixo"' notes-app/package.json` prints `"thixo": "file:<repo>/packages/core"`. `grep -h 'id: "plg_' notes-app/plugins/*/plugin.thx` prints two different `id: "plg_<18 hex>"` lines.
- **Install with no registry.** In `examples-tmp/notes-app`, run `npm install --offline --no-audit --no-fund`. Exit `0`, `added 5 packages`. `node_modules/thixo` is a link to the checkout's `packages/core`.
- **Refuse.** Run `D notes-app` again. Exit `1`; stderr says `create-thixo-app: notes-app already exists and is not empty.`. Run `D "My App"`: exit `1`, `"My App" is not an app name.`.
- **Build.** In `examples-tmp/notes-app`, run `npx thixo build`. Exit `0`; the output lists `ok  todo-info (Todo info)` and `ok  todo-list (Todo list)`, each followed by its summary lines (`Fills the slot ...`, `Needs the endpoints ...`, and for the list `Can use deleteTodo when the user is allowed.`), then `Built.`.
- **Launch and doctor.** From the repo root, run `node .claude/skills/verify-thixo/bin/launch.mjs --run <id> --dir examples-tmp/notes-app`. It copies the app to a `thixo-notes-app-*` temp folder and prints the state with `"signInAs": "ana"`. `doctor.mjs --run <id>` prints `ok   app info: slots main, todo-detail`, `ok   sign-in as ana: scopes 6`, `ok   default plugins deployed: main=plg_…@1, todo-detail=plg_…@1` and `healthy`.
- **Grayed out for ana.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/created-app.mjs --name created-ana`. It prints `ok ana's Delete is grayed out: she lacks todos.delete, an optional scope of the list`.
- **Delete works for ben.** Run the same with `--as ben --name created-ben`. It prints `ok ben's Delete is enabled` and `ok ben deleted the todo they added`. `created-ben/requests.json` has `DELETE /api/todos/<id>` with status `204`.
- **A new plugin's layout line.** Run `node .claude/skills/verify-thixo/bin/cli.mjs --run <id> --save new-plugin -- new plugin notes --slot todo-detail`. It prints `Created plugins/notes/plugin.thx` and `Add it to the layout in thixo.config.ts to make it a default: "todo-detail": "notes"`, the real slot path. Delete `plugins/notes` from the copy after.
- **Same words as the registry.** Run `node .claude/skills/verify-thixo/bin/cli.mjs --run <id> -- compile plugins/todo-list`. Its `Summary` reads `Reads todos`, `Creates and changes todos` and `If you can, deletes todos`, then `Scopes` `needs: todos.read, todos.write` and `uses if the user holds them: todos.delete`.
- **Stop and clean.** Run `node .claude/skills/verify-thixo/bin/cleanup.mjs --run <id>` (it stops the recorded pid and deletes the temp copy), then `rm -rf examples-tmp/notes-app`.
- **Automated.** `node --test tests/e2e/create-app.e2e.mjs` (part of `npm run e2e`): 4 pass. It creates an app in the OS temp folder, installs it offline, runs `thixo dev`, checks ana's grayed-out Delete and ben's delete (204), the `new plugin` layout line, and the `not deployed` line for a broken default.
- **Package tests.** Run `npm test -w create-thixo-app`: `# pass 12`, `# fail 0`.

## Gotchas

- The `file:` links are absolute paths to the checkout. Moving or deleting the checkout breaks the app's install; run `npm install` again after moving it.
- Without the links (`createApp({ checkout: null })`, or a copy from npm) the template pins `thixo@0.0.1`, which is not on npm: `npm install` fails with `E404`.
- The checkout must be built: create-thixo-app says `Build it first` when `packages/core/dist` and the others are missing.
- `launch.mjs --dir` copies the app and links the repo's own `node_modules` into the copy, as it does for an example. The doctor's `copy is disposable` check needs the copy outside the repo, so drive the launched copy, not `examples-tmp/<app>` itself.
- The app's todos are in memory. `thixo dev` rebuilds the server bundle on an edit in `api/`, `app/slots.ts` or `thixo.config.ts`, and that resets them. Two drives in one run share them: use unique titles.
- The name has to be lower-case with dashes. `My App` is refused rather than turned into a folder name.
