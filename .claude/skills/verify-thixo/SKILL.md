---
name: verify-thixo
description: "Prove Thixo behaviour the way a user meets it: start `thixo dev` on a disposable copy of examples/todo, drive the todo app in headless Chromium as ana, ben or cy, run the `thixo` command (compile, new plugin, agent) against it, and keep screenshots, ARIA snapshots, request logs and CLI transcripts as evidence. Use it after changing any package (thx, core, adapters, CLI, shell) or an example, before saying a feature works."
---

# Verify Thixo

Thixo is a framework; its user surface is an app built on it. The app this skill drives is `examples/todo` (or `examples/crm`, see Launch), run by
the `thixo` command from `packages/cli`. A person uses it in a browser (the todo list, the detail panel, the plugin
browser, the authoring chat). An outside coding agent uses it through `thixo agent <tool> --as <user>`. The
implementor uses `thixo dev`, `thixo build`, `thixo start`, `thixo compile` and `thixo new plugin`.

Every helper is in `.claude/skills/verify-thixo/bin/` and runs from the repository root. A run has an id
(`--run <id>`, default `default`); its state and evidence live in `artifacts/verify/<id>/`, which git ignores.

## Launch

Build once, then launch:

```sh
npm install
npm run build                                   # tsc -b over thx, core, thixo-sql, thixo-node, thixo-anthropic, cli
node .claude/skills/verify-thixo/bin/launch.mjs --run <id>
```

`launch.mjs` copies `examples/todo` (without `.thixo/`) to a fresh temp folder, links the repo's `node_modules`
into it, and starts `node packages/cli/bin/thixo.js dev <copy> --port 0` detached, with its output in
`artifacts/verify/<id>/dev.log`. It returns when the log says `thixo dev  ready on http://127.0.0.1:<port>` and
prints the state: `{ run, dir, url, pid, log }`. Before that line the log shows `server rebuilt`, `client rebuilt`
and `deployed  release rel_… (3 plugins; main -> plg_todo_list@1, main/todo-row -> plg_done_badge@1, todo-detail ->
plg_due_dates@1)`, so ready means built, migrated (a fresh `.thixo/data.sqlite`) and deployed.

The app's own data (`api/db.ts`) is in memory and seeded with three todos: `Write the quarterly report` (open,
Ana), `Book flights for the offsite` (done) and `Review the pull request` (open, Ben). Plugin data, the registry and
layouts are in the copy's `.thixo/data.sqlite`. Users are chosen by the `thixo-user` cookie:

| User | Holds | What it shows |
| --- | --- | --- |
| `ana` | todos.read/write, people.read, data read/write, plugins.author/share | Delete disabled, can author and share |
| `ben` | everything, including todos.delete and plugins.promote | Delete enabled, can promote |
| `cy` | todos.read, thixo.data.read | The default list is refused (it needs todos.write) |

`--example crm` launches `examples/crm` instead, the CRM example, and the doctor and drive then sign in as `rita`
(a sales rep) rather than `ana`. Its feature is `features/crm-app.md`. `create-thixo-app <name>` makes a new app from
the template; it is not copied by `launch.mjs` (that copies `examples/<name>` only), so `features/create-app.md` runs
it on its own folder with `npx`, `thixo dev` and curl.

Two runs with different ids run side by side: each has its own copy, port and database. Never point a helper at a
`thixo dev` you did not launch, and never launch into `examples/todo` itself (a promote writes into `plugins/`).

## Doctor

```sh
node .claude/skills/verify-thixo/bin/doctor.mjs --run <id>
```

Read-only. Checks the recorded pid is alive, that the copy's `.thixo/dev.json` names the same pid and url (the port
is ours), that the copy is outside the repo, `GET /_thixo/app` lists the slots, `POST /_thixo/token` signs in the run's example user (`ana` for todo, `rita` for crm, read from the run's state),
`GET /_thixo/layout` has the three default plugins, `/` is the shell page and its CSP has `script-src 'self'`. It
prints each check and `healthy`, or exits 1 naming the first failure. Run it first, and again whenever a drive
behaves oddly.

## Drive

Browser, as one user:

```sh
node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/todo-basics.mjs --name todo-app
```

`drive.mjs` opens the app in headless Chromium with the user's cookie, waits for the header, runs the script, and
saves a screenshot and ARIA snapshot at each `step(label)` and at the end. A script's default export gets
`{ page, url, as, step, expect, dir }` (`dir` is the app copy). Without `--script` it only opens the app and
snapshots it. Ready-made journeys are in `journeys/`; each feature file says which to run.

Stable handles (ARIA roles and names):

- header: banner; combobox `Signed in as`; buttons `Plugins` and `Ask for a plugin`.
- slots: region `<plugin name> (<slot path>)`, such as `Todo list (main)`, `Done badge (main/todo-row)`,
  `Due dates (todo-detail)`. The box also has `data-slot="<path>"` and `data-plugin="<id>@<n>"`. A stopped or
  refused plugin is an `alert` in its slot reading `<plugin id> stopped: <reason>`.
- todo list: textbox `Add a todo` (Enter adds); per row a checkbox `Done`, a button with the todo's title (opens
  the detail panel), the row's `Done badge (main/todo-row)` region, the assignee text and a button `Delete`.
- detail: region `Selected todo` with button `Close`; due dates: textbox `Due` (a date input), spinbutton
  `Warn me this many days before`.
- plugin browser: region `Plugin browser`; list `Your layout` with listitems `Slot <path>` and buttons
  `Reset <path> to default`; search `Search plugins` (textbox `Search plugins`, combobox `Slot`, button `Search`);
  list `Search results` with a listitem per plugin named by the plugin, holding `v<n> · fills <slot> · <visibility> ·
  by <author>` and buttons `Use|Fork|Share|Promote <plugin name>` (a disabled one has its reason as text beside it);
  a `status` after an action (`Forked <name>`, `Asked to promote <name>`).
- chat: region `Authoring chat`, log `Chat messages`, form `Send a message` with textbox `Message`.

Terminal, against the same instance:

```sh
node .claude/skills/verify-thixo/bin/cli.mjs --run <id> --save <label> -- <thixo arguments>
```

It runs `packages/cli/bin/thixo.js` in the app copy (so `thixo agent` finds `.thixo/agent-key` and the port in
`.thixo/dev.json`) and saves the command, exit code, stdout and stderr. Examples that were run:
`-- agent describe --as ana`, `-- agent check --as ana --dir $PWD/.claude/skills/verify-thixo/journeys/todo-summary`,
`-- agent submit --as ana --dir … --raw`, `-- agent use --as ana <plugin id>@1 --slot todo-detail`,
`-- compile plugins/due-dates`, `-- new plugin my-notes --slot todo-detail`, `-- registry list`, `-- release`.
Give `--dir` an absolute path: the command runs in the copy.

The whole todo journey is also an automated test: `npm run e2e` (`tests/e2e/todo.e2e.mjs`) launches its own copy on
a free port, drives ana, ben and cy plus the agent path, and cleans up.

## Evidence

Everything goes under `artifacts/verify/<id>/` at the repository root:

- `<name>/NN-<label>.png` and `NN-<label>.aria.txt` per `step`, `requests.json` (every `/_thixo` and `/api` request
  with method, path, body and status) and `console.txt` from each drive.
- `cli/<label>.txt` per CLI call.
- `dev.log`, the server's output for the run.

Proof standards: drive the real user path (the browser, or the `thixo` command), never a test-only route or a
stand-in server. Capture the action and the resulting state (a `step` before and after), and check side effects
beside what is visible: the request and its status in `requests.json` (a due date is a `POST /_thixo/data/patch`
answered 204), a reload showing the value kept, a file written into the copy (a promote writes
`plugins/<folder>/plugin.thx`), a row in `thixo registry list`. Package tests (`npm test`) back a claim up; they do
not replace the drive for user-facing behaviour. The authoring chat with a real model costs usage and is not part
of a routine run: say so rather than reporting it verified.

## Cleanup

```sh
node .claude/skills/verify-thixo/bin/cleanup.mjs --run <id>
```

Stops only the pid recorded for the run (SIGTERM, then SIGKILL after 5 s), deletes the temp copy and the run's
`state.json`, and keeps every other file in `artifacts/verify/<id>/`. Run it after every attempt, failed ones too.
`launch.mjs` refuses to start a run whose recorded pid is still alive.

## Helpers

| Script | Use |
| --- | --- |
| `bin/launch.mjs [--run id] [--example todo\|crm] [--port 0]` | Disposable copy of `examples/<example>`, `thixo dev` in the background, prints state when ready |
| `bin/doctor.mjs [--run id]` | Read-only health check of that instance; signs in as `ana` for todo and `rita` for crm |
| `bin/drive.mjs [--run id] --as <user> [--script file] [--name label]` | Chromium as a user; screenshots, ARIA snapshots, requests, console |
| `bin/cli.mjs [--run id] [--save label] -- <args>` | The `thixo` command in the copy, transcript saved |
| `bin/cleanup.mjs [--run id]` | Stop what launch started, remove the copy, keep evidence |
| `journeys/todo-basics.mjs` | ana: list, child-slot badges, add, tick, due date, reload |
| `journeys/plugin-browser.mjs` | Opens `Plugins` and snapshots the layout and search results |
| `journeys/detail-panel.mjs` | Which plugin fills `todo-detail` (`EXPECT_DETAIL=<name>` to assert) |
| `journeys/share.mjs` | ana shares `Todo summary` |
| `journeys/use-fork-promote.mjs` | ben uses, forks and promotes `Todo summary` |
| `journeys/todo-summary/plugin.thx` | A small `todo-detail` plugin for the agent path |

`bin/launch.mjs` and `bin/cleanup.mjs` share their copy and teardown code with `tests/e2e/support.mjs`.

## Features

`features/README.md` indexes one file per feature, each with the recipe and the end state that proves it.
