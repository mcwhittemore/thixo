# The todo app

The todo example run by `thixo dev`: a signed-in user sees the todo list drawn by the default `Todo list` plugin, each row carrying a `Done badge` drawn by another plugin in the row's child slot, adds and ticks todos, opens a todo to get the `Due dates` panel plugin, sets a due date that is still there after a reload, and can delete only when they hold `todos.delete`.

## Sub-features

- `todo-list` fills `main` with every todo from `listTodos`, a `Done` checkbox, the title as a button, the assignee for a user with `people.read`, and `Delete`.
- `todo-row` places the `main/todo-row` child slot in each row, filled by `Done badge`, which reads `Open` or `Done` and follows a tick made in the list.
- `todo-add` adds a todo from the `Add a todo` textbox on Enter and clears it.
- `todo-tick` toggles `done` through `updateTodo`; the tick and the badge survive a reload.
- `todo-detail` opens `Selected todo` with the `Due dates (todo-detail)` plugin for the clicked todo.
- `todo-due` patches a `dueOn` annotation (`POST /_thixo/data/patch`, 204) and reads it back after a reload. Annotations are shared within the todo's group (by design; `api/todos.ts` groups by the user's first group), so ben (same group as ana) sees ana's date, even from a plugin only ana has. A store is private to each user. cy (group `ops`) does not see it.
- `todo-delete` is disabled for ana and cy (P4) and enabled for ben; ben's delete answers 204, the row goes, and Thixo drops the todo's annotations (A13).
- `todo-refused` shows cy, who lacks `todos.write`, an alert in `main` instead of the list (`plg_todo_list stopped: Plugin Todo list needs the scope todos.write`).

## How to get to it (user POV)

- Run `npx thixo dev examples/todo` (or the skill's `launch.mjs`, which does the same on a copy) and open the printed address.
- Pick a user in `Signed in as` (ana, ben or cy). The choice is the `thixo-user` cookie; the page reloads.
- Type in `Add a todo` and press Enter; click a row's `Done` checkbox; click a todo's title to open its panel; press `Close` to close it.

## Driving it with drive.mjs (Playwright, headless Chromium)

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run todo` printed its state and `node .claude/skills/verify-thixo/bin/doctor.mjs --run todo` printed `healthy`.
- The run is fresh: the three seeded todos, no due dates.

- **List, badges, add, tick, due date, reload (ana).** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run todo --as ana --script .claude/skills/verify-thixo/journeys/todo-basics.mjs --name todo-app`. It prints `ok every row has a Done badge (main/todo-row)`, `ok added "Verify <n>"`, `ok ticked "Review the pull request" (false -> true)`, `ok its row's badge (another plugin, in main/todo-row) now reads Done`, `ok the due date patch answered 204`, then after the reload `ok the new todo is still listed after reload`, `ok the tick is kept after reload` and `ok the due date reads 2026-12-24 after reload`. `todo-app/requests.json` holds `POST /api/todos`, `PATCH /api/todos/todo-3` and `POST /_thixo/data/patch` with `"at":{"record":"todo","id":"todo-1"}`, each with its status.
- **Delete is per user.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run todo --as ana --name ana-delete` and `… --as ben --name ben-delete`. In `ana-delete/01-end.aria.txt` every `button "Delete"` is `[disabled]`; in `ben-delete/01-end.aria.txt` none is.
- **cy is refused.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run todo --as cy --name cy`. `cy/01-end.aria.txt` has `alert: "plg_todo_list stopped: Plugin Todo list needs the scope todos.write"` under `main`, and `cy/requests.json` has `GET /_thixo/plugins/plg_todo_list/1/load` with status 403.
- **Whole journey, automated.** Run `npm run e2e`. It ends with `# pass 9` and `# fail 0`, and covers ben deleting `Book flights for the offsite` (DELETE answered 204, the row gone).
- **Proof.** Keep `artifacts/verify/todo/todo-app/` (four screenshots and ARIA snapshots, `requests.json`, `console.txt`), the `ana-delete`, `ben-delete` and `cy` folders and `dev.log`. Run `node .claude/skills/verify-thixo/bin/cleanup.mjs --run todo`; the folders are still there after it.

## Gotchas

- The checkbox is controlled and changes only after the server answers. Click it and wait for the new state; Playwright's `check()` fails with `Clicking the checkbox did not change its state`.
- Todo titles repeat across runs on one instance (the app's data lives as long as the process). Use a unique title, and `exact: true` on the title button.
- The app's todos are in memory: they reset when `thixo dev` restarts or rebuilds `api/`. Due dates are plugin data in `.thixo/data.sqlite` and stay.
- A write through any plugin makes every `useQuery` on the page ask again. After a delete, the deleted row's badge can ask for its todo once more and log one `404` in the console before the list drops the row.
- The detail panel is only rendered while a todo is selected. Use the region `Selected todo`, not the slot name alone.
- The plugin in `todo-detail` depends on the user's layout. On a run where the agent or plugin browser changed it, `journeys/detail-panel.mjs` tells you which plugin is there.
