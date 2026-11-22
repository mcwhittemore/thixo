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
| `new plugin <name> --slot <slot>` | Creates `plugins/<name>/plugin.thx` with a fresh id, and prints the `layout` line to add, with the slot's path. | `npx thixo new plugin my-notes --slot todo-detail` |
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

A fork is a new plugin with its own id. To change a fork, submit with `--plugin <fork id>`. The plugin browser shows
each plugin's id, and `thixo registry list` lists them all.

## Files it writes

- `.thixo/build/`: `server.mjs`, `client/` and `manifest.json`, from `build`.
- `.thixo/agent-key` and `.thixo/dev.json`, from `dev`. The key turns on `thixo agent`.
- `.thixo/signing-key`, from `start` and `dev`.

Delete `.thixo/` to start over. It holds the plugin data and the registry.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
