---
name: verify-thixo
description: "Prove Thixo behaviour the way a user meets it: start `thixo dev` on a disposable copy of examples/todo, examples/crm or an app create-thixo-app made, drive it in headless Chromium as one of its users (todo: ana, ben, cy; crm: rita, ravi, mia, sam, ada), run the `thixo` command (compile, new plugin, agent) against it, and keep screenshots, ARIA snapshots, request logs and CLI transcripts as evidence. Use it after changing any package (thx, core, adapters, CLI, shell) or an example, before saying a feature works."
---

# Verify Thixo

Thixo is a framework; its user surface is an app built on it. The app this skill drives is `examples/todo` (or `examples/crm`, or any app folder such as one create-thixo-app made, see Launch), run by
the `thixo` command from `packages/cli`. A person uses it in a browser (the todo list, the detail panel, the plugin
browser, the authoring chat). An outside coding agent uses it through `thixo agent <tool> --as <user>`. The
implementor uses `thixo dev`, `thixo build`, `thixo start`, `thixo compile` and `thixo new plugin`.

Every helper is in `.claude/skills/verify-thixo/bin/` and runs from the repository root. A run has an id
(`--run <id>`, default `default`); its state and evidence live in `artifacts/verify/<id>/`, which git ignores. The folder is the id itself: if a task names `artifacts/verify/chat/`, run with `--run chat`.

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

`--example crm` launches `examples/crm` instead, the CRM example, and the doctor then signs in as `rita` (a sales
rep) rather than `ana`. Its users are `rita` and `ravi` (reps), `mia` (manager), `sam` (support) and `ada` (admin); its
feature is `features/crm-app.md`. `--dir <app folder>` launches any other app the same way, such as one
`create-thixo-app` made (`--dir examples-tmp/notes-app`); the doctor signs in as `ana`, the template's user, and
`--as <user>` on launch or doctor picks another. Its feature is `features/create-app.md`.

The copy's folder is always named `thixo-<name>-…` in the OS temp folder. `cleanup.mjs` deletes only a folder with
`thixo-` in its name, so a hand-written `state.json` can't point it at a real folder; for any other path it says it
left the folder in place.

Two runs with different ids run side by side: each has its own copy, port and database. Never point a helper at a
`thixo dev` you did not launch, and never launch into `examples/todo` itself (a promote writes into `plugins/`).

## Doctor

```sh
node .claude/skills/verify-thixo/bin/doctor.mjs --run <id> [--as <user>]
```

Read-only. Checks the recorded pid is alive, that the copy's `.thixo/dev.json` names the same pid and url (the port
is ours), that the copy is outside the repo, `GET /_thixo/app` lists the slots, `POST /_thixo/token` signs in the run's example user (`ana` for todo, `rita` for crm, read from the run's state),
`GET /_thixo/layout` has the default plugins (three for todo, ten in nine slots for crm), `/` is the shell page and its CSP has `script-src 'self'`. It
prints each check and `healthy`, or exits 1 naming the first failure. Run it first, and again whenever a drive
behaves oddly.

## Drive

Browser, as one user:

```sh
node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/todo-basics.mjs --name todo-app
```

`--as` is one of the app's own users: `ana`, `ben` or `cy` for todo; `rita`, `ravi`, `mia`, `sam` or `ada` for crm;
`ana` or `ben` for a created app. `drive.mjs` opens the app in headless Chromium with the user's cookie, waits for the header, runs the script, and
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
  a `status` after an action (`Forked <name> as <id>. …`, `Asked to promote <name>: wrote plugins/<folder>/ …`).
  Each caption also has `id <plugin id>`, and `(the default is v<n>)` when a default serves an older version.
- chat: region `Authoring chat`, log `Chat messages`, form `Send a message` with textbox `Message` and button `Send`
  (`Working…`, disabled, while the agent runs). Enter in `Message` sends. A `status` reads `The agent is working…`
  during a turn; the log has a `Using <tool>` line per tool call (`data-kind="tool"`) and ends with `Done`
  (`data-kind="done"`). `journeys/chat.mjs` sends one message (it spends model usage).
- a slot path names a child slot with its parent in front (`main/todo-row`). `thixo agent describe` lists each slot
  with its path (`todo-row (export todoRow, widget; path main/todo-row)`); `agent use --slot todo-row` stores it as
  `main/todo-row`, and a path no slot reads is refused.
- prefer roles over `getByLabel`: a `Card` title names a region, so a label word can match a Card and an input.

Terminal, against the same instance:

```sh
node .claude/skills/verify-thixo/bin/cli.mjs --run <id> --save <label> -- <thixo arguments>
```

It runs `packages/cli/bin/thixo.js` in the app copy (so `thixo agent` finds `.thixo/agent-key` and the port in
`.thixo/dev.json`) and saves the command, exit code, stdout and stderr. `--cwd <dir>` (before `--`) runs it in another
folder, relative to the repo root, such as `--cwd examples/todo` to compile after the copy is gone. `thixo agent`
exits 1 on a reply with `ok: false`, so a failed check shows as `exit 1`. Examples that were run:
`-- agent describe --as ana`, `-- agent check --as ana --dir $PWD/.claude/skills/verify-thixo/journeys/todo-summary`,
`-- agent submit --as ana --dir … --raw` (a new plugin), `-- agent submit --as ana --dir … --plugin <id>` (a new
version of your own), `-- agent use --as ana <plugin id>@1 --slot todo-detail`, `-- agent read --as ana <id>@1`
(or `read_plugin`, the tool's name), `-- agent fork --as ben <id>@1`,
`-- compile plugins/due-dates`, `-- new plugin my-notes --slot todo-detail`, `-- registry list`, `-- release`.
Give `--dir` an absolute path: the command runs in the copy.

The whole todo journey is also an automated test: `npm run e2e` (`tests/e2e/todo.e2e.mjs`) launches its own copy on
a free port, drives ana, ben and cy plus the agent path, and cleans up. `tests/e2e/create-app.e2e.mjs` does the same
for an app create-thixo-app made, and `crm.e2e.mjs` for the CRM.

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

Stops only the pid recorded for the run (SIGTERM, then SIGKILL after 5 s), deletes the temp copy (only a folder with
`thixo-` in its name, as launch makes) and the run's `state.json`, and keeps every other file in `artifacts/verify/<id>/`. Run it after every attempt, failed ones too.
`launch.mjs` refuses to start a run whose recorded pid is still alive.

## Helpers

| Script | Use |
| --- | --- |
| `bin/launch.mjs [--run id] [--example todo\|crm \| --dir <app>] [--as user] [--port 0]` | Disposable copy of `examples/<example>` or of any app folder, `thixo dev` in the background, prints state when ready |
| `bin/doctor.mjs [--run id] [--as user]` | Read-only health check of that instance; signs in as `ana` for todo and a created app, `rita` for crm |
| `bin/drive.mjs [--run id] --as <user> [--script file] [--name label]` | Chromium as a user; screenshots, ARIA snapshots, requests, console |
| `bin/cli.mjs [--run id] [--save label] [--cwd dir] -- <args>` | The `thixo` command in the copy (or `--cwd`), transcript saved |
| `bin/cleanup.mjs [--run id]` | Stop what launch started, remove the copy, keep evidence |
| `journeys/todo-basics.mjs` | ana: list, child-slot badges, add, tick, due date, reload |
| `journeys/plugin-browser.mjs` | Opens `Plugins` and snapshots the layout and search results |
| `journeys/detail-panel.mjs` | Which plugin fills `todo-detail` (`EXPECT_DETAIL=<name>` to assert) |
| `journeys/share.mjs` | ana shares `Todo summary` (`PLUGIN=<name>` for another of hers) |
| `journeys/use-fork-promote.mjs` | ben uses, forks and promotes `Todo summary` (`PLUGIN`, `AUTHOR`, `SLOT`, `OPEN` for another) |
| `journeys/row-plugin.mjs` | `PLUGIN=<name>` fills `main/todo-row` in every row |
| `journeys/default-version.mjs` | After a rollback, the browser reads `v2 (the default is v1)` |
| `journeys/due-date-day.mjs` | A due date reads back as the same day in any `TZ` |
| `journeys/created-app.mjs` | A created app: Delete grayed out for ana, working for ben |
| `journeys/chat.mjs` | `ASK=<message>`: one real chat turn, sent with Enter (spends model usage) |
| `journeys/todo-summary/plugin.thx` | A small `todo-detail` plugin for the agent path |

`bin/launch.mjs` and `bin/cleanup.mjs` share their copy and teardown code with `tests/e2e/support.mjs`.

## Features

`features/README.md` indexes one file per feature, each with the recipe and the end state that proves it.
