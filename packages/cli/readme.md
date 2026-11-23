# thixo-cli

The `thixo` command. It builds an app from its folders and runs it, the way `next` does. Run it inside an app folder,
the one with `thixo.config.ts`. Every command that takes `[dir]` uses the current folder when you leave it out.

```sh
npx thixo dev            # build, deploy, serve and rebuild on change (port 3000)
npx thixo build          # build into .thixo/build/ and fail on any plugin error
npx thixo start          # serve what `thixo build` made
```

## Commands

| Command | What it does | Example |
| --- | --- | --- |
| `dev [dir]` | Builds, deploys, serves, and rebuilds on change. Options: `--port`. | `npx thixo dev --port 4310` |
| `build [dir]` | Writes `.thixo/build/` and exits 1 if a plugin fails. Option: `--no-minify`. | `npx thixo build` |
| `start [dir]` | Serves the build in `.thixo/build/`. Option: `--port`. | `npx thixo start --port 8080` |
| `compile <path>` | Compiles a plugin folder or `.thx` file and prints its summary, scopes and manifest. Outside an app, pass `--project <app>`. Options: `--out`, `--json`, `--project`. | `npx thixo compile plugins/due-dates` |
| `new plugin <name> --slot <slot>` | Creates `plugins/<name>/plugin.thx` with a fresh id, and prints the `layout` line to add, with the slot's path. It refuses a slot the app does not have and lists the ones it has. With `--personal <folder>`, it writes the plugin there instead, outside `plugins/` and with no id, for `thixo agent submit`. | `npx thixo new plugin my-notes --slot todo-detail` |
| `agent <tool> --as <user>` | Calls an authoring tool on a running `thixo dev`. | `npx thixo agent describe --as ana` |
| `registry list [dir]` | Lists the plugins in the local registry. | `npx thixo registry list` |
| `release [dir]` | Shows the current release and its layout. | `npx thixo release` |

`thixo agent` has shortcuts: `submit`, `check`, `search`, `read`, `fork`, `use` and `describe`. A tool's own name
(`read_plugin`, `search_registry`, `describe_app`) takes the same arguments. Any other tool name is sent as
`--json '<input>'`. It exits 1 when the tool refuses, and when the reply is `ok: false`, such as a check that fails.

```sh
npx thixo agent describe --as ana                          # the language reference and the app's slots, with their paths
npx thixo agent check --as ana --dir ./my-plugin           # build without storing
npx thixo agent submit --as ana --dir ./my-plugin          # a new plugin; prints its id
npx thixo agent submit --as ana --dir ./my-plugin --plugin <id>   # a new version of your plugin
npx thixo agent use --as ana <id>@1 --slot main/todo-row   # a slot path; a child's bare name works too
```

A failed check prints each error once, as `file:line:col code message`, and exits 1.

Every command that compiles a plugin (`build`, `compile`, `dev` and `start`) prints its errors the same way: the path
is relative to where you ran the command, then `line:column`, the code, the message, and the hint on its own line.
`thixo compile` with `--json` gives the same paths in `errors[].file`.

A fork is a new plugin with its own id. Forking does not put it in your layout: `use` does that, so a fork never
changes what you see by itself. To change a fork, write its files to a folder, edit them, and submit them as its next
version:

```sh
npx thixo agent fork --as ben <id>@2                       # prints the fork's id
npx thixo agent read --as ben <fork id> --out ./my-fork    # writes plugin.thx and the rest; never overwrites
npx thixo agent check --as ben --dir ./my-fork
npx thixo agent submit --as ben --dir ./my-fork --plugin <fork id>
npx thixo agent use --as ben <fork id>@2 --slot todo-detail
```

The plugin browser shows each plugin's id, and `thixo registry list` lists them all, with the slot path each fills.

## Default plugins and personal plugins

A folder in `plugins/` is a default plugin. `thixo dev` deploys every folder, and `layout` in `thixo.config.ts` says
which folder fills which slot path. Only a default plugin's folder has an `id` in its `definePlugin`, so a deploy
finds the same plugin each time. A personal plugin has no id in its source: the registry gives it one when it is
submitted, and drops any id the source has. `thixo new plugin --personal <folder>` starts one.

When a deploy fails, `thixo dev` prints why once and keeps the last release. A layout entry that names a folder not
in `plugins/` reads `layout in thixo.config.ts: "todo-detail": "due-datez" names a folder that is not in plugins/`,
with the folders there are. A default plugin that does not compile prints its errors, then `not deployed: the layout
names plugins/<folder>, which did not compile`.

Promote copies a shared plugin into `plugins/<folder>/`, with its id. It fills no slot until `layout` names the
folder; the reply and the plugin browser say so and give the line to add.

`thixo build`, `thixo compile`, the registry and the plugin browser say what a plugin does in the same words: the
scopes' words from `defineScopes`, and `Reads its own data` and `Writes its own data` for plugin data.

## Files it writes

- `.thixo/build/`: `server.mjs`, `client/` and `manifest.json`, from `build`.
- `.thixo/agent-key` and `.thixo/dev.json`, from `dev`. The key turns on `thixo agent`.
- `.thixo/signing-key`, from `start` and `dev`.

Delete `.thixo/` to start over. It holds the plugin data and the registry. `thixo dev` and `thixo start` in one app
share `.thixo/data.sqlite`, so they see the same registry, versions and layouts. The app's own data is the app's
code: in the examples it is in memory and resets when a change to `api/`, `app/slots.ts` or `thixo.config.ts`
rebuilds the server.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
