# Todo example

A basic todo app written the way a Thixo app should read.

It runs. From the repository root:

```sh
npm install
npm run build
npx thixo dev examples/todo --port 4310
```

Open http://127.0.0.1:4310 and pick a user in **Signed in as**. The login is a stand-in (`api/session.ts`): the
`thixo-user` cookie names the user.

| User | Holds | Sees |
| --- | --- | --- |
| `ana` | `todos.read`, `todos.write`, `people.read`, plugin data, `thixo.plugins.author`, `thixo.plugins.share` | The list, Delete grayed out, can ask for and share plugins |
| `ben` | everything, including `todos.delete` and `thixo.plugins.promote` | The list with Delete, can promote |
| `cy` | `todos.read`, `thixo.data.read` | A message in place of the list, which needs `todos.write` |

Click a todo's title for the detail panel (due dates), press **Plugins** for the plugin browser, and **Ask for a
plugin** for the authoring chat. The chat's model is `claudeCode()`, which runs your local `claude` command.

`thixo dev` keeps plugin data, the registry and the layout in `.thixo/` here (git-ignored); delete it to start over.
The todos themselves are in memory (`api/db.ts`) and reset when the server restarts or `api/` changes.

An outside coding agent can write a plugin while `thixo dev` runs:

```sh
cd examples/todo
npx thixo agent describe --as ana                       # the SDK, slots and language reference
npx thixo agent check --as ana --dir /path/to/my-plugin # build without storing
npx thixo agent submit --as ana --dir /path/to/my-plugin
npx thixo agent use --as ana <plugin id>@1 --slot todo-detail
```

`npm run e2e` at the root drives all of this in headless Chromium on a throwaway copy of this folder.

## The files

```
api/
  scopes.ts        the app's scopes, in words
  todos.ts         the endpoints, each with its scopes, and the Todo record
  session.ts       the app's own login (stand-in)
  db.ts            the app's own storage (stand-in, in memory)
app/
  slots.ts         where plugins go: main, its child todo-row, and todo-detail
  shell.tsx        the base app
plugins/
  todo-list/       a default plugin: the list itself, placing a todo-row slot in each row
  done-badge/      a default plugin for todo-row: Open or Done
  due-dates/       a plugin of the kind a user would ask for: an annotation and a private store
thixo.config.ts   identity, adapters, the model and the default layout
```

## What each file shows

| File | Shows | Requirements |
| --- | --- | --- |
| [api/todos.ts](api/todos.ts) | Endpoints with their scopes. Endpoints needing two scopes. A record, with `canRead` and a group. Data that needs another scope as its own endpoint. Telling Thixo a record was deleted. | A2, A3, A10, A11, A12, A13 |
| [app/slots.ts](app/slots.ts) | Slots with contracts: context in, events out, and a child slot. One plugin fills each. | S5, S10, S12, S13 |
| [app/shell.tsx](app/shell.tsx) | An ordinary React app. No code to wire up plugins. | S1, S7 |
| [plugins/todo-list/plugin.thx](plugins/todo-list/plugin.thx) | Scopes derived from imports. Required and optional endpoints. A grayed-out action. A child slot per row. | P2, P4, S13 |
| [plugins/done-badge/plugin.thx](plugins/done-badge/plugin.thx) | A plugin for a slot inside a slot, and `css()`. | S13 |
| [plugins/due-dates/data.thx](plugins/due-dates/data.thx) | An annotation and a private store, declared as literals. | D1, D2, D3, U7 |
| [plugins/due-dates/plugin.thx](plugins/due-dates/plugin.thx) | Reading and patching plugin data. | D6 |
| [thixo.config.ts](thixo.config.ts) | The implementor's own identity adapter. Adapters in one place. | A8, X4, U6, S9 |

## What the build derives

Nobody writes these. `npx thixo compile examples/todo/plugins/<folder>` prints them, and the registry records them.

**todo-list**

| | |
| --- | --- |
| Slot | `main` |
| Required endpoints | `createTodo`, `listTodos`, `updateTodo` (scopes `todos.read`, `todos.write`) |
| Optional endpoints | `deleteTodo`, `listAssignees` (scopes `todos.delete`, `people.read`) |
| Data | none |
| Summary | Reads todos. Creates and changes todos. If you can, deletes todos. If you can, sees who a todo is assigned to. |

**done-badge**

| | |
| --- | --- |
| Slot | `todo-row` (placed at `main/todo-row`) |
| Required endpoints | `getTodo` (scope `todos.read`) |
| Data | none |

**due-dates**

| | |
| --- | --- |
| Slot | `todo-detail` |
| Required endpoints | `getTodo` (scope `todos.read`) |
| Optional endpoints | none |
| Data | Annotation on `todo`: `dueOn` (date). Private store `prefs`: `warnDaysBefore` (number). Needs `thixo.data.read` and `thixo.data.write`. |
| Summary | Reads todos. Adds 1 field to todo: dueOn (date). Keeps a private store: prefs. |

## A walk through a fork

What happens when a user changes someone else's plugin. The plugin browser and the agent's tools do each step; the
chat-driven version below has not been run with a real model.

1. Ana uses due-dates, which Ben wrote and shared. She asks the chat: "also let me set a reminder time".
2. The agent searches the registry, finds due-dates and forks its current version.
3. It adds `remindAt` to the annotation in `data.thx` and a field to the panel.
4. The build passes. The registry reports: one field added, nothing hidden. Scopes unchanged.
5. Ana's fork reads through to the data of Ben's plugin. Every due date already set is there.
6. Ben, still on his own version, never sees `remindAt` and can't overwrite it.
7. Ana shares her fork. Ben can switch to it and lose nothing.

## What writing this surfaced

Things the example needed that the requirements had not said. Each is now a requirement or an open
question.

1. **Slots need events out.** The list has to tell the shell which todo was picked so the panel can open. A slot's
   contract is context in and events out, and the shell passes information between plugins. (S10)
2. **The API has to name its records.** An annotation attaches to "a todo", so the app must say what a todo is and
   which scopes read one. (A10, D12)
3. **Data declarations carry scopes too.** Annotating a todo requires being able to read todos, so the build derives
   scopes from `data.ts` as well as from endpoint imports.
4. **Plugins import the slot definitions.** A plugin gets its typed context from `@app/slots`, so that module is
   generated and allowed like the SDK. (L2)
5. **A slot holds one plugin.** The main area has one, and so does the detail panel. (S12)
6. **One thing is still written by hand: the description.** Search needs words about what a plugin is for. The agent
   can write them, and the build can't derive them.
7. **Scopes need words.** The plain summary shown at submission comes from a description on each scope.
8. **Plugins need React helpers.** `useQuery`, `useCan`, `useAnnotation` and `useStore` are assumed here. Which
   helpers Thixo ships, and how they report loading and errors, is not designed.
9. **Scopes are about calls, not data.** An earlier draft had each handler strip `assignee` for callers without
   `people.read`, and two of the five forgot. Field-level permission is not Thixo's job. Assignees are now their own
   endpoint with their own scope. (A12)

## What a second test surfaced

A separate attempt to write a third plugin from the docs alone: "put tags on todos, show them in the list, filter by
tag". It could be written only as a fork of the whole todo list, and it exposed the limits below. They are now the
[second question to answer first](../../docs/09-open-questions.md#2-how-do-two-plugins-share-data).

1. **A tags editor in the panel and tags in the list can't be two plugins.** They could not share the `tags` field.
2. **Adding anything to a row means forking the list.** The fork then stops getting the implementor's updates.
3. **Annotations are read one record at a time.** Fifty todos means fifty calls.
4. **Filtering happens in the plugin.** The API knows nothing about annotations, so the plugin loads everything and
   hides rows.
5. **A fork is not expressed anywhere in the source.** Nor is switching a user's layout to the new fork.
6. **A patch replaces a whole list.** Two people tagging the same todo can overwrite each other.
