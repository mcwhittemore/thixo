# Isolation spike

Throwaway tests of the browser behaviour the [security model](../../docs/04-security-model.md#the-spike) rests on.
The answers are written up there. This folder is the evidence, not framework code.

| Folder | What it tests | Results |
| --- | --- | --- |
| `runtime/` | Freezing, loading a bundle, rendering, the message channel, frame cost | `runtime/results.md` |
| `escape/` | Child frames, navigation, side channels, the session | `escape/results.md`, and `escape/results-webkit.md` for WebKit |
| `real-browsers/` | Freezing, in the installed Safari, Chrome and Firefox | `real-browsers/freeze-results.json` |

## Running it

```bash
npm install && npx playwright install
```

```bash
cd runtime && npm install && node run.mjs
```

```bash
cd escape && node run.mjs --browser chromium,chrome,firefox
```

```bash
cd escape && node --import ../runtime/webkit-compat.mjs run.mjs --browser webkit --out results-webkit
```

```bash
cd real-browsers && node freeze-check.mjs
```

`freeze-check.mjs` serves a page on port 4301. Open it in each browser and it posts its numbers back.

## Things to know

- Everything runs on localhost. The "outside server" is a collector on ports 4102 and 4103.
- Playwright's WebKit is not Safari. It also needs `runtime/webkit-compat.mjs`, which drops one call the installed
  WebKit build doesn't know. Without it the WebKit run hangs.
- Playwright's default headless Chromium has no site isolation, so the tests use the full Chromium build.
- Background Safari and Firefox windows slow timers down. `freeze-check.mjs` measures with a message loop, which
  they don't slow.
