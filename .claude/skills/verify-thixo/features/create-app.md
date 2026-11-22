# Starting a new app with create-thixo-app

`create-thixo-app <name>` makes a new folder with a working Thixo app in it: a todo app with one record and four endpoints, a stand-in login with two users (`ana` and `ben`), one page slot, one panel slot and one default plugin for each. It gives each default plugin a fresh `plg_` id, so two apps never share one. It refuses a folder that already has files, and it prints the next steps. The app it makes builds with `thixo build` and serves the same API as `examples/todo`.

## Sub-features

- `create-copies` copies `packages/create-thixo-app/template/` into `./<name>`, with the name in `package.json` and in the shell's heading, and `gitignore` written as `.gitignore`.
- `create-ids` gives each file `plugins/<folder>/plugin.thx` its own `plg_` plus 18 random hex characters, replacing the placeholder id.
- `create-refuse` stops with `<name> already exists and is not empty` and writes nothing when the folder has files. An empty folder is used.
- `create-name` refuses a name that is not lower-case letters, digits and dashes, such as `My App` or `../x`, with `is not an app name`.
- `create-next` prints `Created <name>.` and the three next steps (`cd`, `npm install`, `npm run dev`).
- `create-build` makes an app that `thixo build` compiles with both plugins (`todo-info`, `todo-list`) and exits 0.

## How to get to it (user POV)

- Run `npx create-thixo-app my-app` in a folder where you want the new app. It makes `./my-app`.
- Then `cd my-app`, `npm install` and `npm run dev`. The dev server prints its address; open it and pick `ana` or `ben` in **Signed in as**.
- Run `npx create-thixo-app my-app` a second time: it stops with `my-app already exists and is not empty.` and does not touch the folder.
- Run `npx create-thixo-app` with no name for the usage (exit `1`), or with `--help` (exit `0`).

## Driving it with a terminal and curl

Preconditions:

- `npm install` and `npm run build` have run in the repo root, so `packages/create-thixo-app` is linked in `node_modules` and every package has its `dist`. Node is 22.13 or later.
- `examples-tmp/` at the repo root exists and is git-ignored, so the generated app resolves the workspace packages. Make it with `mkdir -p examples-tmp`.
- `D` below stands for `cd examples-tmp && node ../packages/create-thixo-app/bin/create-thixo-app.js`, run in the repo's `examples-tmp/` folder.

- **Generate.** Run `D smoke-app`. Exit `0`; stdout starts `Created smoke-app.` and lists `cd smoke-app`, `npm install`, `npm run dev`. `examples-tmp/smoke-app/` holds `package.json`, `thixo.config.ts`, `api/`, `app/`, `plugins/` and `.gitignore`. `grep '"name"' smoke-app/package.json` prints `"name": "smoke-app"`, and `grep -h 'id: "plg_' smoke-app/plugins/*/plugin.thx` prints two different `id: "plg_<18 hex>"` lines.
- **Refuse.** Run `D smoke-app` again. Exit `1`; stderr says `create-thixo-app: smoke-app already exists and is not empty.` followed by the advice to pick another name or an empty folder. `ls smoke-app` lists the same files as before.
- **Refuse a bad name.** Run `D "My App"`. Exit `1`; stderr says `"My App" is not an app name.`. Nothing is created in `examples-tmp/`.
- **Build.** In `examples-tmp/smoke-app`, run `npx thixo build`. Exit `0`; the output lists `ok  todo-info (Todo info)` and `ok  todo-list (Todo list)`, then `Built.`. `.thixo/build/server.mjs`, `.thixo/build/client/index.html` and `.thixo/build/manifest.json` exist.
- **Serve and sign in.** Run `npx thixo start . --port 4319` in the background, then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4319/` prints `200`. `curl -s -X POST -H 'cookie: thixo-user=ana' http://127.0.0.1:4319/_thixo/token` returns JSON with a `token` and `user.id` `ana`.
- **The API.** With the token in `$T`, `curl -s -H "authorization: Bearer $T" http://127.0.0.1:4319/api/todos` returns the two seeded todos (`Write the first page`, open; `Try the todo list`, done). `curl -s -X POST -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"title":"Smoke todo"}' .../api/todos` returns the new todo with `done: false`. A `PATCH /api/todos/<id>` with `{"done":true}` answers `200` and the todo with `done: true`. Without the header, `/api/todos` answers `401`.
- **Stop and clean.** Stop the server by its pid (`pkill -f "thixo.js start . --port 4319"` or the `thixo start` process you started), then `rm -rf examples-tmp/smoke-app`. The folder `examples-tmp/` is then empty.
- **Package tests.** Run `npm test -w create-thixo-app`: `# pass 9`, `# fail 0`. The tests copy the template into a temp folder under the OS temp directory, not into the repo.

## Gotchas

- The template's `package.json` depends on `thixo`, `thixo-cli` and `thixo-node` at `0.0.1`. Inside this repo npm links them to the workspace. An app generated outside the repo needs those packages on npm at that version; that was not run here, so it is unverified.
- A plugin id is generated once per copy. Running the generator again on the same name is refused, not merged, so ids never repeat across two apps made from the template.
- `thixo build` writes `.thixo/` (the local data file included) into the new app. The `.gitignore` the generator writes keeps it out of git.
- The API answers `401` to a plain cookie. Send the token from `POST /_thixo/token` as `Authorization: Bearer`, as the example above does.
- The seeded todos live in memory in `api/db.ts`, so a restart of `thixo start` resets them.
- The name has to be lower-case with dashes. `My App` is refused rather than turned into a folder name.
