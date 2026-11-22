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
| `compile <path>` | Compiles a plugin folder or `.thx` file and prints its manifest. Options: `--out`, `--json`, `--project`. | `npx thixo compile plugins/due-dates` |
| `new plugin <name> --slot <slot>` | Creates `plugins/<name>/plugin.thx` with a fresh id. | `npx thixo new plugin my-notes --slot todo-detail` |
| `agent <tool> --as <user>` | Calls an authoring tool on a running `thixo dev`. | `npx thixo agent describe --as ana` |
| `registry list [dir]` | Lists the plugins in the local registry. | `npx thixo registry list` |
| `release [dir]` | Shows the current release and its layout. | `npx thixo release` |

`thixo agent` has shortcuts: `submit`, `check`, `search`, `read`, `fork`, `use` and `describe`. Any other tool name is
sent as `--json '<input>'`.

```sh
npx thixo agent check --as ana --dir ./my-plugin
```

## Files it writes

- `.thixo/build/`: `server.mjs`, `client/` and `manifest.json`, from `build`.
- `.thixo/agent-key` and `.thixo/dev.json`, from `dev`. The key turns on `thixo agent`.
- `.thixo/signing-key`, from `start` and `dev`.

Delete `.thixo/` to start over. It holds the plugin data and the registry.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
