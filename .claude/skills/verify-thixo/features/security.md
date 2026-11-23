# Plugin containment against the red team's findings

A user who runs someone else's plugin is protected the way the red team attacked: an image written in a plugin's
source never loads from the outside host, because the build copied it into the app, even with the page's CSP turned
off; the build's fetch refuses hosts inside the network; a plugin that chooses among fixed links to one host is
flagged in its registry summary; a plugin's dialog and toasts always say which plugin and author they come from, in
a line the plugin can't reach; and a plugin can't be shared under a default's or another shared plugin's name, while
the plugin browser badges defaults. A `Url` the app hands a plugin (an avatar field, a `t.url()` annotation another
user seeded) loads whatever its host: the owner accepts that, and it is the risk that remains (a saved `Url` is a
tracking pixel). See `copy-at-build.md` for copy at build itself.

## Sub-features

- `sec-copied-loads` a written-out outside load is fetched by the build and served from the app; the runtime refuses an uncopied one; the page never asks the outside host.
- `sec-build-fetch` the build's fetch refuses loopback, private, link-local and metadata addresses, other ports, and http.
- `sec-handed-in` a handed-in `Url` loads and links from any http(s) host; `javascript:` is refused as data and by the runtime.
- `sec-url-field` a `t.url()` field takes only what the runtime can hold: http(s) with a host, mailto, an app path, a `data:` image or font.
- `sec-choice-flag` the registry summary says "Links to <hosts>" and "Can choose among N links to <host>: ..." when a manifest links more than once to a host.
- `sec-attribution` `openModal` dialogs and toasts carry "From the plugin “<name>”, by <author>" outside the plugin's box, and in the dialog's accessible name.
- `sec-unique-names` sharing (or a new version of a shared plugin) is refused when its folded name matches a default's or another shared plugin's; the browser shows `Default` and `From <author>` badges.

## How to get to it (user POV)

- An attacker with a normal account submits a plugin with `thixo agent submit`, seeds data over `POST /_thixo/data/patch`, shares it from the plugin browser, and waits for another user to use it.
- The victim opens a todo, sees the plugin in `todo-detail`, clicks its buttons, and searches the plugin browser.
- The implementor reads a plugin's summary in the plugin browser or in `thixo agent submit`'s reply.

## Driving it with node, the package suites and the security e2e

Preconditions:

- `npm install` and `npm run build` at the repo root exit 0; Playwright's Chromium is cached.
- No instance is needed for the e2e: it launches its own copy of `examples/todo` and an outside HTTP listener on another port, and cleans both up.

- **The whole attack path in a browser.** Run `node --test tests/e2e/security.e2e.mjs` (also part of `npm run e2e`). 5 pass. The test rewrites its copy's config so `local({ fetchAsset })` fetches `https://outside.test/...` from the outside listener and sends everything else to the real `guardedFetch()`. Test 1: ana submits `Signal`, which shows `https://outside.test/bit1.gif` or `bit0.gif` by a todo's `done`; the submit's summary says `Copied 2 files from outside.test when it was built: ...` and the listener hears `GET /bit0.gif` and `GET /bit1.gif` once, from the build. With the CSP bypassed (`bypassCSP: true`, and `GET /control` proves the page can reach the listener), opening `Write the quarterly report` shows an image whose `src` is `/_thixo/plugins/<id>/<n>/assets/<sha256>.gif?u=ana&...`, it loads, and the listener hears nothing more; the path without its ticket answers 401. Test 2: submits writing `https://127.0.0.1/x.gif`, `https://localhost/x.gif`, `https://169.254.169.254/latest/meta-data/` and `https://127.0.0.1:<listener port>/x.gif` exit 1 with `build/copy-failed` and the reason, and the listener hears nothing. Test 3: a `Picture` plugin's `link` annotation seeded with `http://127.0.0.1:<listener>/beacon?seen=1` (patch 204) renders as the image's `src` and the link's `href`, no alert, and the listener hears `GET /beacon?seen=1`; seeding `javascript:alert(1)` answers 400. Test 4: ana's shared `Reminder` opens a dialog titled `Session expired` for ben; its accessible name is `Session expired From the plugin “Reminder”, by ana` and the line is not inside `.thixo-slot-box`. Test 5: ana's personal `Due dates` copy gets `Share failed: "Due dates" is already the name of a default plugin of this app...`; ben's search for `Due dates` lists one plugin, with a `Default` badge.
- **The runtime wall.** Run `cd packages/thx && node --import tsx --test test/escape.test.ts`. `outside addresses written in the source`: an outside load compiles into `loads`; uncopied, it stops at render (`loads https://cdn.example.com/logo.png from outside the app`); copied, it renders `/_thixo/.../assets/<file>` and the code names no outside host; a host `assetAddress` off the app is refused; a secret-chosen pair of images loads only copies; `http:` loads are `thx/address`. `handed-in addresses that load`: a handed-in Url on any host is an image, a style and `css()` `url()`, and a link; `javascript:`, `data:text/html`, `vbscript:` and `//host` can't be minted. In `elements`, a written-out link to any https host compiles and the secret-chosen `bit0`/`bit1` links compile with both in `links`; `http:` and `mailto:` links are refused.
- **The server side.** Run `cd packages/core && npm test`. `# fail 0`; `server.test.ts` checks `/_thixo/app` has no `addressHosts`; `copy-at-build.test.ts` covers the copy, the asset route's rule and headers, SVG, failures and caps; `plugin-data.test.ts` refuses `data:text/html,...`, `data:application/javascript,1`, `tel:` and `https:evil.test/x` for a url field; `registry.test.ts` checks `Links to evil.example` and `Can choose among 2 links to evil.example` in submit and search, and that copied images are not flagged; `deploy-layout.test.ts` refuses share for `Due dates`, `due-dates`, `DUE  DATES.` and full-width `Ｄｕｅ ｄａｔｅｓ`, then a renamed version shares and a later rename back is `registry/name-taken`; `host-modules.test.ts` checks the source passed to `openModal` and `toast`.
- **The build's fetch.** Run `cd packages/thixo-node && node --import tsx --test test/guarded-fetch.test.ts`: the address classes, the refusals before connecting, redirects re-checked and capped at 3, type, size and time caps, all with an injected resolver and transport.

## Gotchas

- The page's CSP is `img-src 'self' data: https:`, so it does not stop an https load; the runtime does. Test 1 bypasses the CSP anyway so an http listener is reachable and silence means the language.
- The e2e's `thixo agent submit` for a copying plugin must not be a synchronous spawn: the listener the build fetches from runs in the test process, and a blocked process can't answer it.
- A refused load stops the whole plugin (the slot shows an alert), the way every other runtime refusal does; it is not dropped silently.
- `thixo agent` has no `share` tool; share in the plugin browser as the author.
- Look-alike letters from other scripts are not folded, so a Cyrillic `а` still passes the name check; the badge is the signal there (open question in `docs/09-open-questions.md`).
