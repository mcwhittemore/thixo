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

A small app that shows each part once, with nothing in it you will have to delete first.

- `api/hello.ts`: one endpoint, `hello`, that needs the scope `hello.read`. Thixo turns it into the SDK plugins import.
- `api/session.ts`: a stand-in login with two dev users. Pick one with the `thixo-user` cookie, or with **Signed in
  as** in the page. Both can use the hello plugin and author their own; `ben` holds every scope Thixo defines.
- `api/scopes.ts`: the app's scopes, in the words the plugin browser uses.
- `app/slots.ts`: one page slot, `main`.
- `app/shell.tsx`: the base app. It has one `<Slot is={main} />`, the plugin browser and the authoring chat.
- `plugins/hello/`: the default plugin for `main`. It calls `hello` and keeps a nickname as plugin data (`data.thx`),
  private to each user.
- `thixo.config.ts`: `local()` adapters, `anthropic()` from `thixo-anthropic/node` as the model (the Claude API with a
  key, your local `claude` login without one, in development), and the layout (`main` is `hello`).
- `package.json`: `dev`, `build` and `start` scripts.

## Try these next

With `npm run dev` running and the page open:

1. Type a nickname in the hello plugin and save it. Reload: it is still there. Switch to `ben`: he does not see it,
   because a plugin's data belongs to the user who wrote it.
2. Add an endpoint. Copy `hello` in `api/hello.ts` under a new name and path, with a scope in `api/scopes.ts` that
   `api/session.ts` gives a user. Dev rebuilds the server. Then import it in `plugins/hello/plugin.thx` from `@app/sdk`
   and call it with `useQuery`. `npx thixo build` says what you got wrong.
3. Ask for a plugin. Press **Ask for a plugin** and describe what you want in the authoring chat, or run
   `npx thixo agent describe --as ana` for the plugin language and write one yourself. `npx thixo new plugin <name>
   --slot main` starts a folder in `plugins/` and prints the line to add to `layout`.

## Writing plugins

`npx thixo agent describe --as ana` prints the plugin language reference: the rules, every module a plugin may import,
and every component's props. Use it while you write `.thx`. For a personal plugin, one you store with
`npx thixo agent submit`, add `--personal <folder>` to `thixo new plugin`: it goes outside `plugins/` and has no id.
Only a default plugin's folder has an id.

## Making it your own

The starter has no domain. To add yours:

- Put your data behind `api/`. Thixo has no opinion about storage. Only plugin data goes through its data adapter.
- Add endpoints in `api/` and their scopes in `api/scopes.ts`, and say who holds them in `api/session.ts`.
- Add slots in `app/slots.ts` and place them with `<Slot>` in `app/shell.tsx`, with the context the plugins need.
- Add a `record(...)` for a thing plugins can attach their own fields to. See `examples/todo/api/todos.ts`.
- `examples/todo` and `examples/crm` in the Thixo checkout show records, annotations, child slots and an action that is
  grayed out for a user who lacks a scope (`useCan`).

## Tests

`npm test` copies the template into a temp folder and checks the name, the plugin ids, the checkout links and the
refusal of a non-empty folder. It runs with `node --test`. `tests/e2e/create-app.e2e.mjs` at the repo root makes an
app, installs it offline, runs `thixo dev` and drives it in a browser.
