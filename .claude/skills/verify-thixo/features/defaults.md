# Updating the default plugins

The implementor changes what every user gets by default without touching anyone's own choices: edit a folder in `plugins/` under `thixo dev` and it deploys as a new version; change `layout` in `thixo.config.ts` and the release changes; promote a user's plugin and it lands as a folder, which becomes a default once the layout names it; put a folder back as it was and the deploy finds its old version by hash (a rollback). A user who never changed a slot follows each new release; one who did keeps their choice.

## Sub-features

- `defaults-edit` deploys a changed default folder as the next version (`todo-detail -> plg_due_dates@2`) with no restart.
- `defaults-rollback` finds the old version by source hash when the folder is put back, and serves it (`@1`) without storing anything new. The plugin browser then reads `v2 (the default is v1)`.
- `defaults-layout` checks each layout key against the app's slot paths. A child slot's bare name is refused with the path to write (`Write "main/todo-row"`).
- `defaults-broken` keeps the last release when a folder the layout names stops compiling, and says `not deployed: the layout names plugins/<folder>, which did not compile`.
- `defaults-promote` writes the promoted plugin into `plugins/<slug>/` and the status says the folder and the layout edit that makes it a default.
- `defaults-remove` drops a folder from the release when it is deleted and the layout no longer names it. The registry keeps the plugin (`shared`, by `implementor`); the plugin browser's `Default` badge goes and it reads `From implementor`.
- `defaults-follow` moves a user who never changed the slot to the new default and leaves one who did where they were.

## How to get to it (user POV)

- Run `npx thixo dev` in the app. Edit `plugins/<folder>/*.thx`, or `layout` in `thixo.config.ts`. Watch the `deployed  release …` lines.
- Run `npx thixo release` for the current release and `npx thixo registry list` for every plugin and its versions.
- Open `Plugins` in the app to see the badges and the version a default serves.

## Driving it with cli.mjs, drive.mjs and the copy's files

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run <id>` printed its state and `doctor.mjs --run <id>` printed `healthy`. `F` is `<copy>/plugins/due-dates/plugin.thx`, where `<copy>` is the `dir` launch printed.

- **Edit a default.** Save a copy of `F`, then change the text of its `description`. `dev.log` gains `deployed  release rel_… (… todo-detail -> plg_due_dates@2)`.
- **Roll back.** Copy the saved file back over `F`. `dev.log` gains `deployed  release rel_… (… todo-detail -> plg_due_dates@1)`, and `C registry list` shows `plg_due_dates` with versions `1,2`: nothing new was stored.
- **The browser after the rollback.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/default-version.mjs --name default-version`. It prints `ok Due dates reads v2 (the default is v1)` and the scope line `Needs: thixo.data.read (read the plugin's own saved data), thixo.data.write (save the plugin's own data), todos.read`.
- **A layout key that is not a slot.** In `<copy>/thixo.config.ts`, change `"main/todo-row":` to `"todo-row":`. `dev.log`: `deploy failed: … The layout names the slot "todo-row", which no part of the app shows. Write "main/todo-row": a child slot's path has its parent in front.` The app stays on the last release. Change it back: `deployed  release`.
- **A broken default.** Change `useQuery(getTodo` to `window.fetch(getTodo` in `F`. `dev.log`: `FAILED  due-dates`, the `thx/no-global` error, then `not deployed: the layout names plugins/due-dates, which did not compile (see above). The app keeps the last release until it compiles.` The browser shows the old version. Put `F` back.
- **Promote, then name it.** Run the agent recipe up to ben's promote (`authoring.md`, `use-fork-promote.mjs`). The status names `plugins/todo-summary/` and says to name `"todo-summary"` in `layout`. Then set `"todo-detail": "todo-summary"` in `<copy>/thixo.config.ts`: `dev.log` gains `server    rebuilt` and `deployed  release … todo-detail -> <ID>@1`, and the plugin browser shows `Todo summary` with the `Default` badge.
- **Who follows.** Before the layout edit, press `Reset todo-detail to default` in `Plugins` as ana. After it, `EXPECT_DETAIL="Todo summary" node .claude/skills/verify-thixo/bin/drive.mjs --run <id> --as ana --script .claude/skills/verify-thixo/journeys/detail-panel.mjs --name ana-follows` passes: she follows the new default. A user who kept their own choice in that slot does not, and proves nothing about the default.
- **Remove a folder.** Point `todo-detail` back at `due-dates`, then delete `<copy>/plugins/todo-summary`. `dev.log` gains a release without it. `C registry list` still lists it (`shared`, `implementor`); the plugin browser drops its `Default` badge.
- **Automated.** `npm test -w thixo`: `deploy-layout.test.ts` has `a changed folder is a new version, and rolling back finds the old one by hash` (with `defaultVersion` 1 after the rollback) and `a folder without an id, a build error, a wrong slot or a missing folder fails the deploy and stores nothing` (with the `todo-row` key refused). `tests/e2e/create-app.e2e.mjs` checks the `not deployed` line.
- The promote-then-name, who-follows and remove steps were run on the CRM example in the defaults-crm verification; repair-r1 re-ran the edit, rollback, browser caption, layout-key and broken-default steps on the todo example.
- **Proof.** Keep `dev.log`, `cli/*.txt` and the drive folders. Run `cleanup.mjs --run <id>`.

## Gotchas

- Editing `thixo.config.ts` rebuilds the server bundle, which resets the app's in-memory data (todos, deals). Editing `plugins/` does not.
- The deployment id names the code (the git sha, or the build hash of the plugin sources). A layout-only change makes a new release with the same deployment id.
- Moving a folder can show a release for the half-done state; read the last `deployed  release` line.
- A default the layout names stays a `shared` plugin by `implementor` in the registry after its folder is removed. Only the release, and so the badge, changes.
- Removing or renaming a folder the layout still names gives `deploy failed: … The layout puts "<folder>" in "<slot>", but there is no plugins/<folder>.` in `dev.log` only. The server stays on the old release and the browser shows nothing new. Change the layout in the same edit.
- Promote does not make a default by itself. The promoted plugin reads `From <author>` with Promote enabled until the layout names its folder and the app deploys.
