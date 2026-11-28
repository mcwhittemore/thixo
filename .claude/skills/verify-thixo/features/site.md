# The demo site

`@thixo/site` (`packages/site`) is the static demo site. It builds to `packages/site/dist` and is served from a
subpath, `/thixo/`, as GitHub Pages serves it. Its sections compile thx programs in the browser with `@thixo/core`,
mount them with `@thixo/react`, and show how to install thixo.

## Sub-features

- `site-build` builds with `npm run build -w @thixo/site` into `packages/site/dist`.
- `site-subpath` loads under `/thixo/`: every asset is relative, and nothing 404s.
- `site-live` compiles a program in the page and mounts it in a `[data-testid="box"]` element, which animates.
- `site-errors` shows a program's compile or run-time error in a `.error` element, not the console.
- `site-install` shows the install, compile and mount steps (`#install`).
- `site-sections` links each section from the nav, by its `#id`.

## How to get to it (user POV)

- Open the site's URL (`/thixo/` on GitHub Pages) and read, scroll, and use what each section offers.

## Driving it with verify-thixo

Preconditions:

- Doctor passes. The site bundles `@thixo/core` and `@thixo/react` from source, so it doesn't need their `dist`.

- **Load and animate.** Run `scripts/site.sh --out "$RUN/site"`. It builds the site, serves `dist` under
  `/thixo/` on a random port, opens it in a 1024×768 page, and by default takes three shots: `loaded`, then
  `frame-1` after going to `#live`, and `frame-2` 300 ms later. Exit 0. `site.json` has `ok: true`, empty
  `pageErrors`, `consoleErrors`, `failedRequests` and `errorText`, and `boxesChanged: [true]`: the spinner's box
  HTML differs between shots. Proven in #31: the `rect`'s `transform` was `rotate(46.49…)`, `rotate(55.48…)`,
  `rotate(85.49…)` at the three shots.
- **Page text.** `page.txt` is the page's text at the end of the run, and each step in `site.json` has its own
  `text`. Assert on lines in it, such as `npm i @thixo/core @thixo/react` for `site-install`.
- **Drive it.** `--do '<json>'` or `--do @actions.json` replaces the default steps with a list of actions, run in
  order:
  - `{"goto": "#live"}` sets the hash and scrolls the element into view.
  - `{"click": "<selector>"}`, and `{"type": {"into": "<selector>", "text": "go"}}`, which clicks and then types.
  - `{"pointer": {"x": 37, "y": 61, "in": "<selector>"}}` moves the mouse, relative to the element when `in` is
    given and to the page when not. `{"down": true}` and `{"up": true}` press and release it.
  - `{"press": "Enter"}`, `{"keyDown": "ArrowLeft"}`, `{"keyUp": "ArrowLeft"}`.
  - `{"wait": 300}` waits milliseconds; `{"frames": 3}` waits for that many animation frames.
  - `{"shot": "<name>"}` saves `NN-<name>.png` and a step in `site.json`: `url`, `text`, `boxes` (each box's
    HTML) and `errorText`.
  Proven in #31 with a probe program that renders its `usePointer()` and `useKeys()`: `pointer` at (37, 61) in the
  box gave `at 36,60 … inside true`, then `down` and `keyDown ArrowLeft` gave `down true … keys ArrowLeft`.
- **Errors.** Show that a broken site is reported. A bad program path in `sections.tsx` makes the build fail:
  exit 1, `FAILED: the site didn't build`, and `build.txt` has esbuild's `Could not resolve "../programs/…"`. A
  program that doesn't compile gives exit 1 and its diagnostic in `errorText`, for example
  ``main.thx:2:14 `document` does not exist in the language``. An action on a missing element gives exit 1 and
  `actionError`, after a 5 s timeout.
- **Contained.** `offOriginRequests` holds one `GET blob:…` per mounted program: that's `load` importing the
  compiled code. Anything else is real.

## Gotchas

- `--no-build` serves whatever `packages/site/dist` holds, which may be a build of different source. Use it only
  right after a run that built.
- `ok` is false when the page logs a console error, a request fails (status 400 or more), or any `.error` element
  has text. A section that shows an error on purpose (a compile error a reader is meant to see) makes `errorText`
  non-empty: assert on its content rather than on `ok`.
- `type` clicks the element's centre first, so the pointer moves there.
- Box coordinates from `pointer` with `in` count from the element's border edge; the program sees them 1 px less
  inside the box's border.
- Timing values differ every run. Assert that frames differ, not on the angles.
- `--out` and `@file` paths are relative to where you run the script.
