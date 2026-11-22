# The shell, slots and plugin host

The browser half of Thixo: `<Shell>` signs in with the page's own session and keeps the token in memory, `<Slot>` loads whichever plugin version the user's layout puts in a slot and renders it inside a contained box, and the broker holds every call a plugin makes to its manifest and its author's scopes. `<PluginBrowser />` is the registry UI and `<AuthoringChat />` the chat panel. This file covers `thixo/shell` (`packages/core/src/shell/`), the plugin host modules (`packages/core/src/plugin-host/`), and the todo example's `app/shell.tsx` and `plugins/` (`todo-list`, `due-dates`, `done-badge`, written as `.thx`).

## Sub-features

- `shell-session` trades the page's session for a token at `POST /_thixo/token` (same-origin credentials), keeps it in a module-private `WeakMap`, refreshes it a minute before expiry, and retries a request once after a 401. `useThixo()` gives the implementor's code `{ user, api }`.
- `shell-slot` resolves a slot path (`main`, `main/todo-row`), loads `PluginLoad` and the compiled module (fetched with the token, imported through a blob address), makes a runtime, builds the host modules and renders the component with `{ context, emit }`.
- `shell-box` renders each plugin in a box with `contain: layout paint style; overflow: auto; isolation: isolate; position: relative` plus the slot's size, and puts its `css()` rules in a `<style data-thixo-plugin>` element, every rule under the plugin version's `thx-p-<id>-<n>` class.
- `shell-errors` replaces a plugin that throws while rendering, or that the runtime stops (`onError`, such as running out of budget), with `<name> stopped: <reason>` in its own slot. Every other slot keeps running.
- `shell-stop` stops a plugin when its slot unmounts (P7): pending calls are aborted and later SDK, data and service calls reject with `the plugin has stopped`, without a request.
- `broker-manifest` refuses an endpoint that is not in the version's manifest (P1) or not in `authorCan` (P3), and an optional endpoint the user can't call (P4), with a `ThixoRefused` naming the endpoint and the reason. None of these touch the network.
- `broker-convert` validates a plugin's input against the endpoint's input schema, sends a `Url` as its address and refuses a plain string in a url field (L7), and turns url fields of a reply into `Url`s and ISO dates into `Date`s. Plugin data crosses `/_thixo/data/*` with urls as `{ "$url": "..." }`.
- `emit` checks each event's payload against the slot's `emits` before the shell's handler sees it (S11). A child slot's events reach the parent plugin's `on` handler the same way.
- `services` refuses every shell service the manifest does not list (S8). `navigate` takes only a same-origin path, `download` a sanitised file name and a text type, and `openModal` renders the plugin's content in a shell-owned dialog.
- `plugin-browser` lists each slot path with the version that fills it, searches, shows a plugin's summary and scopes before use, and offers Use, Fork, Share, Promote and Reset, each disabled with the reason when the user can't. While it is open, an empty slot shows `Empty slot: <path>`.
- `authoring-chat` posts to `/_thixo/authoring/chat`, renders the newline-delimited events (text, tool, done), and loads the layout again when the agent is done.
- `example-shell` is the todo app's real `app/shell.tsx`: a header with the `Signed in as` user switcher (sets the `thixo-user` cookie to `ana`, `ben` or `cy` and reloads), the main slot, the detail slot for the selected todo, and `Plugins` and `Ask for a plugin` toggles.

## How to get to it (user POV)

- As an implementor, render `<Shell>` around the app and place `<Slot is={main} on={{ select }} />`. The CLI's browser entry is `import App from "<project>/app/shell.tsx"; import { mount } from "thixo/shell"; mount(App)`.
- As a user of the todo example, pick a user in `Signed in as`, click a todo's title to open the detail panel, press `Plugins` for the plugin browser, and press `Ask for a plugin` for the chat.
- As a plugin, import from `thixo/plugin`, `thixo/ui`, `thixo/data`, `thixo/schema`, `thixo/services`, `@app/sdk`, `@app/sdk/optional` and `@app/slots`. Those values are the host modules built in `packages/core/src/plugin-host/host-modules.tsx`.
- As a developer of this repo, run the DOM tests or the Chromium drive below. `npx thixo dev examples/todo` will be the real entry once the CLI, the registry routes and the thx runtime are merged.

## Driving it with drive-shell and Playwright

Preconditions:

- Run from the repository root, after `npm install`. Playwright's Chromium is installed (`npx playwright install chromium` if `chromium.launch` fails).
- `npm run build -w thixo` has succeeded. The example and the drive import `thixo/*` from `packages/core/dist`.
- The drive starts its own server on a free port (`127.0.0.1:0`), so two runs can go side by side. It writes nothing outside the artifacts folder you name.

- **Whole suite.** Run `npm test -w thixo`. The final lines read `# pass 60` and `# fail 0` (the count grows; `fail` must be 0).
- **Broker.** Run `node --import tsx --test packages/core/test/broker.test.ts`. 8 pass: a refusal for an endpoint outside the manifest and for one outside `authorCan`, both with no request recorded; an optional endpoint the user can't call refused with no request; `href: expected a Url, got string`; a reply's `href` is a `Url` and `seenAt` a `Date`; data patches carry `{ "$url": ... }`; a pending call rejects with `the plugin has stopped` after abort; and a 403 from the real todo server for `cy` creating a todo.
- **Host modules.** Run `node --import tsx --test packages/core/test/host-modules.test.ts`. 7 pass, including `the token is unreachable from every value handed to a plugin (P5)`, which walks every value the plugin saw and finds neither the token string nor the session, and `navigate goes only to a path inside the app`.
- **Shell in a DOM.** Run `node --import tsx --test packages/core/test/shell.test.ts` (happy-dom). 9 pass: rows filled by the `main/todo-row` child slot, the box's styles, the scoped stylesheet with no `evil.test`, adding a todo through the plugin, `Broken stopped: kaboom` in the detail slot while the list keeps running, the plugin browser's disabled reasons and Use/Reset, `Empty slot main/todo-row`, the chat's streamed lines, stopping on unmount, and `Done badge stopped: ran out of budget`.
- **Example plugins type-check.** Run `node --import tsx --test packages/core/test/example-plugins.test.ts`. 3 pass: the three folders are `.thx`, each with an `id`, and each type-checks against the app's generated declarations.
- **The real example shell in Chromium.** Run `node --import tsx packages/core/test/drive-shell.ts artifacts/shell-and-plugins`. It bundles `examples/todo/app/shell.tsx` with esbuild and drives it. Expected lines, in order:
  - `no cookie: Not signed in`
  - `ana: signed in as ana`, then `main slot: plg_todo_list@1`
  - `row badges (main/todo-row): Open, Done, Open`
  - `main box: contain=content overflow=auto isolation=isolate position=relative`
  - `ana Delete buttons disabled: true,true,true`
  - `due date patch: {"plugin":"plg_due_dates","version":1,"at":{"record":"todo","id":"todo-1"},"fields":{"dueOn":"2026-12-01T..."}}` (the hour depends on the machine's time zone)
  - `layout main: Todo list v1`, `layout main/todo-row: Done badge v1`, `layout todo-detail: Due dates v1`
  - `Due dates summary: Reads todos; Adds a due date to todos`
  - `Promote Due dates: disabled=true (Already a default)` and `Use Todo list: disabled=true (Already in use in main)`
  - `ben Delete buttons disabled: false,false,false`
  - `page errors: none`
- **Drive it by hand.** Run `PORT=4317 node --import tsx packages/core/test/drive-shell.ts --serve` and open `http://127.0.0.1:4317`. Stable handles: combobox `Signed in as`; regions `Todo list (main)`, `Due dates (todo-detail)`, `Plugin browser`, `Authoring chat`; buttons `Plugins`, `Ask for a plugin`, `Use <plugin>`, `Fork <plugin>`, `Share <plugin>`, `Promote <plugin>`, `Reset <slot path> to default`; listitem `<plugin name>` in list `Search results`; textbox `Message` in form `Send a message`; log `Chat messages`; `[data-slot="<path>"][data-plugin="<id>@<n>"]` on each filled box. Stop it with Ctrl-C, or kill the PID you started.
- **Proof.** The drive saves `ana-list.png`, `ana-detail.png`, `ana-plugin-browser.png`, `ben-list.png` and `requests.json` (every request per user) in the folder named. Also save `npm test -w thixo > artifacts/shell-and-plugins/tests.txt`. After cleanup both exist, and `tests.txt` ends with `# fail 0`.

## Gotchas

- The thx runtime and compiler are not merged in this branch. Every test and the drive use the fake runtime in `packages/core/test/helpers/fake-runtime.ts` and hand-written "compiled" modules in `helpers/plugins.ts`, so they prove the shell, broker and host modules, not the wall. The `.thx` plugins in `examples/todo/plugins/` are only type-checked. Without the real runtime the shell bundle needs `thixo-thx/runtime` aliased, as the drive does.
- Layout, plugin load and code, registry, data and authoring routes are stand-ins in `helpers/todo-server.ts` (another part of the build writes the real ones). The token, `/_thixo/app` and `/api` are the real server. If a real route answers differently, the drive is the place to look.
- A plugin's module is fetched with the token and imported from a `blob:` address. A content security policy on the page has to allow `blob:` in `script-src`.
- `useStore` keeps the user's one record of a store under the id `default`.
- `contain: layout paint style` reads back as `contain: content` from `getComputedStyle` in Chromium. Both mean the same.
- happy-dom runs without React's `act()`; the DOM tests poll with `waitFor`. Unmounting stops a plugin only once React runs the effect cleanups, so a test checks for `the plugin has stopped` by polling.
- The drive's compiled-module text is a function's source under tsx, which adds an `__name` helper; the drive defines it. A `__name is not defined` message in a slot means that line was lost.
- Do not report the absent `thixo dev` command as a failure of this feature: it belongs to the CLI.
