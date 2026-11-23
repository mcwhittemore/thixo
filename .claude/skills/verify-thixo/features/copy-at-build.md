# Outside addresses: copy at build, Urls from data, links

An image a plugin's source writes out (`<img src="https://...">`) is fetched once when the plugin is built, stored with the version by its content hash, and served from the app at `/_thixo/plugins/<id>/<n>/assets/<sha256>.<ext>` under the same rule as the plugin's code. The page never asks the outside host for it. The fetch is the server's, so it is https only and refuses hosts inside the network; a failed copy is a build error the agent can act on. A `Url` the app hands a plugin (an endpoint result, a `t.url()` field) loads and links whatever its host. A written-out link may go to any https host, and the registry summary names the hosts. There are no `addressHosts` or `linkHosts`.

## Sub-features

- `copy-build` `thixo compile`, `thixo build`, `thixo dev`'s deploy and `thixo agent check`/`submit` all copy a written-out load; `compile --out` writes `assets/`.
- `copy-manifest` the manifest keeps `addresses` and `loads`, and adds `assets` (address to `<sha256>.<ext>`) and `links`.
- `copy-summary` the summary says `Copied N file(s) from <host> when it was built: ... loads from this app, never from <host>` and `Links to <hosts>`; more than one link to a host adds `Can choose among N links to <host>: ...`.
- `copy-guard` the fetch refuses http, ports other than 443, credentials, loopback, private, link-local and metadata addresses (also after a redirect, at most 3), non-image/font types, over 2 MiB a file or 8 MiB a plugin, and over 10 seconds; an SVG with script is refused.
- `copy-route` `GET /_thixo/plugins/:id/:n/assets/:file` takes a token or the ticket in `PluginLoad.assets.query` (12 hours), serves only that version's copies, applies the author-only rule for a personal plugin, and sends `nosniff`, a sandboxing CSP and, for SVG, `attachment`.
- `copy-runtime` an uncopied outside load in compiled code stops the plugin at render; a copied one renders as the app path.
- `url-from-data` a handed-in `Url` is an image, a style `url()` and a link on any http(s) host; `javascript:` and other schemes are still refused.

## How to get to it (user POV)

- A coding agent (or the implementor) writes `<img src="https://...">` in a plugin and runs `thixo agent check` / `submit`, `thixo compile`, or saves it under `plugins/` with `thixo dev` running.
- A user opens a page with that plugin and sees the image; DevTools shows it came from `/_thixo/plugins/.../assets/`.
- A user sees an avatar or a url field's picture from wherever the app's data points.

## Driving it with the CLI, the browser and the package suites

Preconditions:

- `npm install` and `npm run build` at the repo root exit 0.
- `node .claude/skills/verify-thixo/bin/launch.mjs --run <id>` and `doctor.mjs --run <id>` prints `healthy`.
- A public https image the machine can reach, such as `https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png`, for the steps that copy for real. Without network, say so and use the e2e and suites below for that part.

- **A copy that would reach inside the network fails the build.** In an empty scratch folder write a `plugin.thx` for `todoDetail` that returns `<img src="https://127.0.0.1/x.png" alt="x" />`, then `node .claude/skills/verify-thixo/bin/cli.mjs --run <id> -- compile <folder>`. Exit 1; `plugin.thx:<line>:<col> build/copy-failed Could not copy https://127.0.0.1/x.png into the app: 127.0.0.1 is not an address on the public internet.` and a hint about copying at build. The same with `https://localhost/x.png` (`localhost is not a public host`), `https://169.254.169.254/latest/meta-data/`, and `https://example.com:8443/x.png` (`port 8443`). `http://...` is `thx/address` (`must be https://`).
- **A public image is copied.** The same folder with the public image: `compile <folder> --out <out>` exits 0, prints `Copied 1 file from upload.wikimedia.org when it was built: it loads from this app, never from upload.wikimedia.org`, the manifest has `"loads"` and `"assets": { "<address>": "<sha256>.png" }`, `<out>/plugin.js` contains `rt.asset(` and not the host, and `<out>/assets/<sha256>.png` is the image.
- **The page loads the copy.** `cli.mjs --run <id> -- agent submit --as ana --dir <folder>` then `agent use --as ana <plg>@1 --slot todo-detail`. `drive.mjs --as ana` opens `Write the quarterly report`: the `<img>` in the plugin's region has `src` `/_thixo/plugins/<plg>/1/assets/<sha256>.png?u=ana&e=...&k=...`, and `requests.json` has a 200 for that path and no request to the image's host. `curl -si <url>/_thixo/plugins/<plg>/1/assets/<sha256>.png` (no ticket) answers 401; with the ticket it answers 200 with `content-type: image/png`, `x-content-type-options: nosniff` and `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. As `ben`, the personal plugin's file answers 404.
- **Links and the summary.** A plugin with `<a href="https://docs.example.com/a">` and `<a href="https://docs.example.com/b">` chosen by a todo's `done`: `agent check` passes and its summary has `Links to docs.example.com` and `Can choose among 2 links to docs.example.com: which one you click tells docs.example.com something about what it read`.
- **The whole path, with an outside listener.** `node --test tests/e2e/security.e2e.mjs` (part of `npm run e2e`): an image written as `https://outside.test/bit0.gif` / `bit1.gif` is fetched by the build only (`GET /bit0.gif`, `GET /bit1.gif` at the listener), the page shows the `/_thixo/.../assets/` copy with the CSP bypassed and the listener hears nothing more; written-out `https://127.0.0.1/...`, `https://localhost/...`, the metadata address and the listener's own port are refused at build and the listener hears nothing; a `t.url()` field seeded with the listener's address loads and links from it (`GET /beacon?seen=1`).
- **The suites.** `cd packages/thx && npm test` (`outside addresses written in the source` and `handed-in addresses that load` in `escape.test.ts`), `cd packages/core && npm test` (`copy-at-build.test.ts`, `shell-assets.test.ts`, the summary tests in `registry.test.ts`), `cd packages/thixo-node && npm test` (`guarded-fetch.test.ts`, which injects the resolver and the transport), `cd packages/cli && npm test` (compile and build through the build step).

## Gotchas

- `packages/thx/scripts/thxc.ts` is the bare compiler: it lists an outside load in `loads` and copies nothing. Use `thixo compile` to see the copy.
- Copies are cached per process by address, so `thixo dev` fetches an image once; a changed outside image shows up in a new process, and only in a new version (a stored version keeps its copy).
- The page's CSP is `img-src 'self' data: https:` so a handed-in `Url` can load; an http one (like the e2e listener) is blocked by the CSP, which is why the e2e bypasses it.
- A `Url` saved as data acts as a tracking pixel for whoever opens the page. That is the accepted risk, not a bug.
