# create-thixo-app

Starts a new Thixo app in a new folder. It copies the template, names the app and gives each default plugin a fresh
id, so two apps never share one.

```sh
npx create-thixo-app my-app
cd my-app
npm install
npm run dev
```

## Usage

```sh
create-thixo-app <name>
```

`<name>` is the new folder and the app's name. Use lower-case letters, digits and dashes. The folder must not exist,
or must be empty. If it has files in it, the command stops and writes nothing.

## What you get

- `api/`: one record, `Todo`, and four endpoints: `listTodos`, `getTodo`, `createTodo` and `updateTodo`. The data is
  in memory.
- `api/session.ts`: a stand-in login with two users, `ana` and `ben`. Pick one with the `thixo-user` cookie.
- `app/slots.ts`: one page slot, `main`, and one panel slot, `todo-detail`.
- `app/shell.tsx`: the base app.
- `plugins/todo-list/` and `plugins/todo-info/`: one default plugin for each slot.
- `thixo.config.ts`: `local()` adapters, `claudeCode()` as the model, and the default layout.
- `package.json`: `dev`, `build` and `start` scripts.

## Tests

`npm test` copies the template into a temp folder and checks the name, the plugin ids and the refusal of a non-empty
folder. It runs with `node --test`. It needs no install.
