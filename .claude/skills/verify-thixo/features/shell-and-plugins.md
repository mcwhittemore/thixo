# The shell, slots and plugin host

The browser half of Thixo: `<Shell>` signs in with the page's own session and keeps the token in memory, `<Slot>` loads whichever plugin version the user's layout puts in a slot and renders it inside a contained box, and the broker holds every call a plugin makes to its manifest and its author's scopes. `<PluginBrowser />` is the registry UI and `<AuthoringChat />` the chat panel. This file covers `thixo/shell` (`packages/core/src/shell/`), the plugin host modules (`packages/core/src/plugin-host/`), and the todo example's `app/shell.tsx` and `plugins/` (`todo-list`, `due-dates`, `done-badge`, written as `.thx`).

## Sub-features

- `shell-session` trades the page's session for a token at `POST /_thixo/token` (same-origin credentials), keeps it in a module-private `WeakMap`, refreshes it a minute before expiry, and retries a request once after a 401. `useThixo()` gives the implementor's code `{ user, api }`.
- `shell-slot` resolves a slot path (`main`, `main/todo-row`), loads `PluginLoad`, imports the compiled module by the address in its `code` (a five-minute ticket bound to the user and version, so the page CSP stays `script-src 'self'`), makes a runtime, builds the host modules and renders the component with `{ context, emit }`.
- `shell-box` renders each plugin in a box with `contain: layout paint style; overflow: auto; isolation: isolate; position: relative` plus the slot's size, and puts its `css()` rules (handed over by the runtime's `insertStyle`) in a `<style data-thixo-plugin>` element, every rule under the plugin version's `thx-p-<id>-<n>` class.
- `shell-errors` replaces a plugin that throws while rendering, or that the runtime stops (`onError`, such as running out of budget), with `<name> stopped: <reason>` in its own slot. Every other slot keeps running.
- `shell-stop` stops a plugin when its slot unmounts (P7): pending calls are aborted and later SDK, data and service calls reject with `the plugin has stopped`, without a request.
- `broker-manifest` refuses an endpoint that is not in the version's manifest (P1) or not in `authorCan` (P3), and an optional endpoint the user can't call (P4), with a `ThixoRefused` naming the endpoint and the reason. None of these touch the network.
- `broker-convert` validates a plugin's input against the endpoint's input schema, sends a `Url` as its address and refuses a plain string in a url field (L7), and turns url fields of a reply into `Url`s and ISO dates into `Date`s. Plugin data crosses `/_thixo/data/*` with urls as `{ "$url": "..." }`.
- `query-refresh` makes every `useQuery` on the page ask again after any plugin's write (a non-GET endpoint call), so the `Done badge` in a row follows a tick made by the list.
- `emit` checks each event's payload against the slot's `emits` before the shell's handler sees it (S11). A child slot's events reach the parent plugin's `on` handler the same way.
- `services` refuses every shell service the manifest does not list (S8). `navigate` takes only a same-origin path, `download` a sanitised file name and a text type, and `openModal` renders the plugin's content in a shell-owned dialog.
- `plugin-browser` lists each slot path with the version that fills it, searches, shows a plugin's summary and scopes before use, and offers Use, Fork, Share, Promote and Reset, each disabled with the reason when the user can't. While it is open, an empty slot shows `Empty slot: <path>`. Each caption reads `v<latest> · fills <slot> · <visibility> · by <author> · id <plugin id>`, with `(the default is v<n>)` after the version when a default serves an older one. Thixo's own scopes carry words: `thixo.data.read (read the plugin's own saved data)`. The status after Fork names the copy's id and says it is not in the layout yet; after Promote it names the folder written and the layout edit that makes it a default.
- `authoring-chat` posts to `/_thixo/authoring/chat`, renders the newline-delimited events (text, tool, done), and loads the layout again when the agent is done. Enter in `Message` sends; Shift+Enter is a new line. While it works the button reads `Working…` and is disabled, and a `status` reads `The agent is working: using <tool>…`.
- `example-shell` is the todo app's real `app/shell.tsx`: a header with the `Signed in as` user switcher (sets the `thixo-user` cookie to `ana`, `ben` or `cy` and reloads), the main slot, the detail slot for the selected todo, and `Plugins` and `Ask for a plugin` toggles.

## How to get to it (user POV)

- As a user of the todo example, open the app `thixo dev` serves, pick a user in `Signed in as`, click a todo's title to open the detail panel, press `Plugins` for the plugin browser, and press `Ask for a plugin` for the chat.
- As an implementor, render `<Shell>` around the app and place `<Slot is={main} on={{ select }} />`. The CLI's browser entry is `import App from "<project>/app/shell.tsx"; import { mount } from "thixo/shell"; mount(App)`, or `mount(App, { libraries })` when the config exposes libraries.
- As a plugin, import from `thixo/plugin`, `thixo/ui`, `thixo/data`, `thixo/schema`, `thixo/services`, `@app/sdk`, `@app/sdk/optional` and `@app/slots`.

## Driving it with drive.mjs (Playwright, headless Chromium)

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run shell` printed its state and `doctor.mjs --run shell` printed `healthy`.

- **Slots and boxes.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run shell --as ana --name ana`. `ana/01-end.aria.txt` has `region "Todo list (main)"` with one `region "Done badge (main/todo-row)"` per row. `ana/requests.json` has `GET /_thixo/layout`, `GET /_thixo/plugins/plg_todo_list/1/load`, `GET /_thixo/plugins/plg_todo_list/1.js` and the same for `plg_done_badge`, all 200, and no `blob:` address. `console.txt` has no error.
- **Child slot follows a write, detail panel, plugin data.** Run the `todo-basics` journey (see `todo-app.md`). The badge line `ok its row's badge (another plugin, in main/todo-row) now reads Done` proves `query-refresh` and `emit`/`ChildSlot`; the `POST /_thixo/data/patch` in its `requests.json` has `"at":{"record":"todo","id":"todo-1"}` and a `dueOn` ISO string, answered 204.
- **Refusal shown in the slot.** Run `drive.mjs --run shell --as cy --name cy`: `main` holds `alert: "plg_todo_list stopped: Plugin Todo list needs the scope todos.write"`, and the header still works.
- **Plugin browser.** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run shell --as ana --name browser --script .claude/skills/verify-thixo/journeys/plugin-browser.mjs`. `browser/01-open.aria.txt` has the list `Your layout` (`Slot main`, `Slot main/todo-row`, `Slot todo-detail`, each with `Reset … to default` disabled, `This slot already has its default`) and `Search results` with `Done badge`, `Due dates` and `Todo list`, each `Promote` disabled with `Already a default`, and `Due dates` listing `Reads todos`, `Adds 1 field to todo: dueOn (date)` and `Keeps a private store: prefs`. Share, use, fork and promote are driven in `authoring.md`.
- **Package suites.** `npm test -w thixo` ends `# fail 0` (113 tests). Of those, `broker.test.ts`, `host-modules.test.ts` and `shell.test.ts` use a fake runtime in happy-dom; `real-runtime.test.ts` runs the example's plugins through the real compiler and runtime inside `<Shell>`.
- **Proof.** Keep `artifacts/verify/shell/` (the drives' screenshots, ARIA snapshots, `requests.json`, `console.txt`), then `node .claude/skills/verify-thixo/bin/cleanup.mjs --run shell`.

## Gotchas

- The real runtime implements `definePlugin` and `css` itself, so the shell's own `definePlugin` and `css` in the `thixo/plugin` host module only run under the fake runtime in the DOM tests.
- The code address in a `PluginLoad` reply carries a ticket that expires after five minutes. A page that loads a version later asks for a new `load` first; a stale address answers `401 ticket_invalid`.
- `useStore` keeps the user's one record of a store under the id `default`; `useStoreList.create` makes an id with `crypto.randomUUID` and patches it.
- `contain: layout paint style` reads back as `contain: content` from `getComputedStyle` in Chromium. Both mean the same.
- A plugin whose required scopes the user lacks is refused at `load` with 403 (G1). That is the shell working, not a broken plugin.
- happy-dom runs without React's `act()`; the DOM tests poll with `waitFor`.
- A `Card` with a `title` is a region named by that title. A plugin whose Card title starts with a word its own `Select` is labelled with (`Priority: <todo>` beside a `Priority` select) makes `getByLabel("Priority")` match both. Use roles: `getByRole("combobox", { name: "Priority" })`.
- The DOM test `the authoring chat streams the agent's events …` sends with an Enter keydown, which proves Enter sends.
- The authoring chat needs a model. The todo config uses `claudeCode()`, which runs the local `claude` command and spends usage; a routine run does not send chat messages.
