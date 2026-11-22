# create-thixo-app

Starts a new Thixo app in a new folder. It copies the template, names the app and gives each default plugin a fresh
id, so two apps never share one.

```sh
node <thixo checkout>/packages/create-thixo-app/bin/create-thixo-app.js my-app
cd my-app
npm install
npm run dev
```

Thixo is not on npm yet. Run create-thixo-app from a Thixo checkout, after `npm install` and `npm run build` there.
It then writes `file:` links to that checkout into `package.json`, for `thixo`, `thixo-cli`, `thixo-node`, `react` and
`react-dom`. So `npm install` needs no registry, and the app and the shell share one copy of React. The app can live
anywhere on the machine. Once the packages are on npm, `npx create-thixo-app my-app` will pin their versions instead.

## Usage

```sh
create-thixo-app <name>
```

`<name>` is the new folder and the app's name. Use lower-case letters, digits and dashes. The folder must not exist,
or must be empty. If it has files in it, the command stops and writes nothing.

## What you get

- `api/`: one record, `Todo`, and five endpoints: `listTodos`, `getTodo`, `createTodo`, `updateTodo` and
  `deleteTodo`. The data is in memory, so it resets when the server restarts or `thixo dev` rebuilds the server
  (an edit in `api/`, `app/slots.ts` or `thixo.config.ts`).
- `api/session.ts`: a stand-in login with two users. Pick one with the `thixo-user` cookie. `ana` can't delete todos;
  `ben` holds every scope.
- `app/slots.ts`: one page slot, `main`, and one panel slot, `todo-detail`.
- `app/shell.tsx`: the base app.
- `plugins/todo-list/` and `plugins/todo-info/`: one default plugin for each slot.
- `thixo.config.ts`: `local()` adapters, `claudeCode()` as the model, and the default layout.
- `package.json`: `dev`, `build` and `start` scripts.

## Graying out an action

The todo list shows the pattern for an action some users can't take. It imports `deleteTodo` from
`@app/sdk/optional`, not `@app/sdk`. An optional endpoint does not stop a user from getting the plugin. `useCan(deleteTodo)`
says whether this user may call it, and the Delete button is disabled when they can't. Sign in as `ana` to see it
grayed out, and as `ben` to use it.

## Writing plugins

With `npm run dev` running, `npx thixo agent describe --as ana` prints the plugin language reference: the rules, every
module a plugin may import, and every component's props (such as `Checkbox`'s `label`). Use it as the reference while
you write `.thx`. `npx thixo new plugin <name> --slot <slot>` starts a plugin folder and prints the line to add to
`layout` in `thixo.config.ts`.

## Making it your own

The template is a todo app. To rename the domain, say from todos to notes, change these files together:

- `api/db.ts`: the stored type and rows.
- `api/todos.ts`: the record (`record("todo", ...)`), the endpoints and their paths. Rename the file if you like;
  every file in `api/` is collected.
- `api/scopes.ts` and `api/session.ts`: the scope names, and which user holds which.
- `app/slots.ts`: the slot names and their context (`todoId`).
- `app/shell.tsx`: the heading, the selected id and the `Slot` context.
- `plugins/*/plugin.thx`: the SDK imports, the slot imports and the text.
- `thixo.config.ts`: `layout`, if you renamed a slot or a plugin folder.

`npx thixo build` then tells you what still names the old domain: each plugin compiles against the app's own
declarations.

## Tests

`npm test` copies the template into a temp folder and checks the name, the plugin ids, the checkout links and the
refusal of a non-empty folder. It runs with `node --test`. `tests/e2e/create-app.e2e.mjs` at the repo root makes an
app, installs it offline, runs `thixo dev` and drives it in a browser.
