# Plugin containment against the red team's findings

A user who runs someone else's plugin is protected the way the red team attacked: a `Url` the app hands a plugin
(an avatar field, a `t.url()` annotation another user seeded) can't make the page load from a host the app did not
list, even with the page's CSP turned off; a plugin that chooses among fixed addresses on a listed host is flagged
in its registry summary; a plugin's dialog and toasts always say which plugin and author they come from, in a line
the plugin can't reach; and a plugin can't be shared under a default's or another shared plugin's name, while the
plugin browser badges defaults.

## Sub-features

- `sec-load-hosts` the runtime refuses every load (`<img src>`, a style's `url()`) of an outside address whose host is not in `addressHosts`, written out or handed in; links still take any handed-in http(s) `Url`.
- `sec-app-hosts` `GET /_thixo/app` carries `addressHosts`; the shell passes them to each runtime.
- `sec-url-field` a `t.url()` field takes only what the runtime can hold: http(s) with a host, mailto, an app path, a `data:` image or font.
- `sec-choice-flag` the registry summary says "Can choose among N addresses on <host>: ..." when a manifest names more than one address on a host.
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

- **The whole attack path in a browser.** Run `node --test tests/e2e/security.e2e.mjs` (also part of `npm run e2e`). 3 pass. Test 1 bypasses the CSP (`bypassCSP: true`), proves the page can reach the listener (`GET /control` arrives), seeds a `Picture` plugin's `link` annotation with `http://127.0.0.1:<listener>/beacon?secret=1` (patch answers 204), opens `Write the quarterly report`, and sees an alert `... stopped: ... an outside address a plugin loads must be on one of the app's address hosts`, no `<img>` with the listener's address, and nothing at the listener. Test 2: ana's shared `Reminder` opens a dialog titled `Session expired` for ben; its accessible name is `Session expired From the plugin “Reminder”, by ana` and the line is not inside `.thixo-slot-box`. Test 3: ana's personal `Due dates` copy gets `Share failed: "Due dates" is already the name of a default plugin of this app...`; ben's search for `Due dates` lists one plugin, with a `Default` badge.
- **It failed before.** With `packages/thx/src` and `packages/core/src` checked out from the commit before this change and rebuilt, the same command gives `# fail 3`.
- **The runtime wall.** Run `cd packages/thx && node --import tsx --test test/escape.test.ts`. The `handed-in addresses that load` suite passes 7 cases: an unlisted handed-in Url as `<img>`, a secret-chosen pair, style and `css()` `url()`, a listed host loading, exact host match (`example.com` does not list `avatars.example.com`), a handed-in link still allowed, and a written-out load refused by a runtime given no hosts.
- **The server side.** Run `cd packages/core && npm test`. `# fail 0`; `server.test.ts` checks `addressHosts` in `/_thixo/app` (empty by default, `["cdn.example.com"]` when configured); `plugin-data.test.ts` refuses `data:text/html,...`, `data:application/javascript,1`, `tel:` and `https:evil.test/x` for a url field; `registry.test.ts` checks the `Can choose among 2 addresses on cdn.example.com` line in submit and search; `deploy-layout.test.ts` refuses share for `Due dates`, `due-dates`, `DUE  DATES.` and full-width `Ｄｕｅ ｄａｔｅｓ`, then a renamed version shares and a later rename back is `registry/name-taken`; `host-modules.test.ts` checks the source passed to `openModal` and `toast`.
- **The app reports its hosts.** `node .claude/skills/verify-thixo/bin/launch.mjs --run <id>`, `doctor.mjs --run <id>` prints `healthy`, `curl -s <url>/_thixo/app` has `"addressHosts":[]` for the todo example, then `cleanup.mjs --run <id>`.

## Gotchas

- The page's CSP (`img-src 'self' data: <addressHosts>`) would also block the outside image; test 1 turns it off on purpose so it proves the language. Without `bypassCSP` the test would pass even on the old code.
- A refused load stops the whole plugin (the slot shows an alert), the way every other runtime refusal does; it is not dropped silently.
- `thixo agent` has no `share` tool; share in the plugin browser as the author.
- Look-alike letters from other scripts are not folded, so a Cyrillic `а` still passes the name check; the badge is the signal there (open question in `docs/09-open-questions.md`).
