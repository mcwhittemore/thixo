# Thixo verification map

This directory is the maintained source for verifying Thixo's user-facing behaviour. Thixo is a framework, so its users are three: a person using an app built on it (the browser), the implementor building the app (the `thixo` command), and a coding agent writing plugins (`thixo agent`). The app most recipes drive is `examples/todo`; `features/crm-app.md` drives `examples/crm` and `features/create-app.md` an app create-thixo-app made (`launch.mjs --dir`). Read `../SKILL.md` for launch, doctor, drive, evidence and cleanup, then use the matching feature file as the recipe.

## Baseline preconditions

- `npm install` and `npm run build` have run at the repo root. Node 22.13 or later. Playwright's Chromium is in the local cache.
- Launch with `node .claude/skills/verify-thixo/bin/launch.mjs --run <id>`: a disposable copy of `examples/todo`, `thixo dev` on a free port, a fresh `.thixo/`.
- `node .claude/skills/verify-thixo/bin/doctor.mjs --run <id>` prints `healthy`.
- Seed state: three todos (`Write the quarterly report` open, `Book flights for the offsite` done, `Review the pull request` open), users `ana`, `ben` and `cy`, and the default layout `main -> Todo list`, `main/todo-row -> Done badge`, `todo-detail -> Due dates`. The crm users are `rita`, `ravi`, `mia`, `sam` and `ada`; a created app's are `ana` and `ben`.
- The app's own data is in memory and shared by every drive of the run. Only a restart resets it (a new run, or an edit that rebuilds the server bundle: `api/`, `app/slots.ts`, `thixo.config.ts`).
- Never drive an instance this run did not launch, and never run `thixo dev` on `examples/todo` itself for a verification (a promote writes into its `plugins/`).

## Driving conventions

- Browser actions go through `bin/drive.mjs --as <user> --script <journey>`; terminal actions through `bin/cli.mjs -- <thixo args>`, which runs in the app copy.
- Prefer ARIA roles and accessible names (listed in `../SKILL.md`) over CSS selectors. Slots are regions named `<plugin name> (<slot path>)`.
- Use unique titles for new todos and `exact: true` on title buttons: the app's data lives as long as the process.
- Start from the baseline unless a recipe says otherwise; the agent recipe changes layouts and the registry for the rest of its run.

## Proof and skip reporting

- Evidence goes in `artifacts/verify/<id>/` (git-ignored) and survives `cleanup.mjs`. The folder is named by the run id exactly: a task that names `artifacts/verify/chat/` means `--run chat`.
- UI proof: the ARIA snapshot and screenshot at each step, plus `requests.json` for the requests and statuses behind the action.
- CLI proof: the transcript `cli.mjs` saves (command, exit code, stdout, stderr).
- Mutation proof: a second, read-only view of the stored value (a reload, `thixo registry list`, a file in the copy).
- Package test suites support a claim; they do not stand in for the user path a feature file names.
- Report what you could not reach with the command you ran and the precondition that was missing. The authoring chat with a real model is not driven routinely: say so rather than reporting it verified.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behaviour, then exactly four H2 sections in this order: `Sub-features` (short ids, one line each), `How to get to it (user POV)`, `Driving it with <harness>` (starting with `Preconditions:`, then labeled bullets pairing an action, an exact command and an observable result), and `Gotchas`.

## Features

- [The todo app](./todo-app.md): the list, child-slot badges, add, tick, due dates kept across reloads, delete by scope, a refused plugin. Browser.
- [The CRM app](./crm-app.md): the CRM example's routes, deals pipeline, finance gating, notes, lead score and dashboard widgets as a rep. Browser.
- [Starting a new app with create-thixo-app](./create-app.md): the template copy, checkout links, fresh plugin ids, refusals, the next steps, and the created app launched, doctored and driven (Delete grayed out by `useCan`). Terminal and browser.
- [The shell, slots and plugin host](./shell-and-plugins.md): slot loading and boxes, plugin code by address, refusals in a slot, the plugin browser, query refresh across plugins. Browser.
- [Authoring agent](./authoring.md): `thixo agent` describe, check, submit (a new plugin, or a version with `--plugin`) and use (by slot path, a child's bare name resolved), then share, use, fork and promote in the plugin browser; the chat, scripted and for real. CLI and browser.
- [Updating the default plugins](./defaults.md): edit a default under `thixo dev`, roll back by hash, the browser's `v2 (the default is v1)`, layout keys checked against slot paths, a broken default not deployed, promote then name, remove a folder. CLI, files and browser.
- [The thixo command](./cli.md): dev, build, start, compile, new plugin, registry list, release, redeploy on change. CLI.
- [Registry, plugin route, plugin data, layouts and deploys](./registry-and-data.md): the server side of the above, in the browser and against the fetch handler.
- [The app's API, token and SDK](./app-api.md): token from the session, scope checks, `/_thixo/app`, `/_thixo/sdk.js`. curl.
- [Plugin language (thx)](./plugin-language.md): compiling and refusing plugins, the wall, the budget. CLI and the thx suites.
- [Local adapters](./local-adapters.md): `.thixo/` state, SQLite data, file code store, streaming `serve()`, `claudeCode()`. `thixo dev` and node.
- [Plugin containment against the red team](./security.md): handed-in Urls can't load from unlisted hosts (no CSP needed), the choose-among-addresses summary flag, attributed dialogs and toasts, unique shared names. Browser e2e and the suites.
- [Model adapters](./model-adapters.md): `anthropic()` against a local fake of the Messages stream. node.
