# Run in a page

A compiled program, mounted by `@thixo/react` in an element on a host page, draws inside that box, animates on the
frame clock, and responds to the pointer, keys and the box's size. It touches nothing outside the box.

## Sub-features

- `render-draw` draws its HTML or SVG into the box on mount.
- `render-frame` advances on `useFrame(time, delta)`: the output changes between steps without input.
- `render-pointer` reads `usePointer()` (`x`, `y`, `down` and `inside`, relative to the box).
- `render-keys` reads `useKeys()`, the keys held while the box has focus.
- `render-size` reads `useSize()`, the box's `width` and `height`.
- `render-css` styles with `css({...})`, which becomes a generated class (`thx1-…`).
- `render-contained` gives the box `contain: strict`. Nothing outside it changes, and no request leaves the origin.
- `render-errors` reports a program's run-time error to the host's `onError`, not the page.

## How to get to it (user POV)

- `mount(document.getElementById("box"), await load(code))` from `@thixo/react`, as in the README.

## Driving it with verify-thixo

Preconditions:

- Doctor passes.
- `$RUN/orbit.js` compiled from `packages/core/test/fixtures/orbit` (see [compile.md](./compile.md)).

- **Mount.** Run `scripts/render.sh "$RUN/orbit.js" --out "$RUN/render-orbit"`. Exit 0. `render.json` has `ok: true`, six steps, and no `runtimeErrors`, `pageErrors` or `offOriginRequests`.
- **Draw and size.** At step `mounted`, `boxHtml` has an `<svg width="400" height="300">` with five `<circle>`s, and the box's wrapper style includes `contain: strict`.
- **Pointer.** Read the centroid of the circles' `cx`, `cy` per step. At `mounted` it's near (200, 150), the box's centre. At `pointer-at-quarter` it's near (100, 75). At `pointer-held` the circles' `r` is `6`, and it's `4` at the others. Proven in the first run: centroids (199, 149) and then (99, 74), with r 4, 6, 4.
- **Frame.** The `cx` values differ between two steps where the pointer didn't move (`arrow-right-held` and `typed-go-enter`).
- **Keys.** A program that renders `useKeys().join(" ")` shows `boxText` `"ArrowRight"` at `arrow-right-held` and `"no keys"` (or your empty text) at the steps before.
- **Contained.** `outside` stays `"host page text"` in every step, and `offOriginRequests` is empty.

## Gotchas

- `useKeys` sees keys only while the box has focus. The `pointer-held` step's mouse-down focuses it. With
  `--no-poke`, no keys reach the program.
- Assert pointer behavior off-centre. orbit centres itself when the pointer is outside, so a pointer stuck at the
  centre looks correct.
- `boxText` is empty for SVG-only programs; use `boxHtml`.
- Screenshots are 480×380 with the box at (40, 40). Box coordinates are page coordinates minus 40 (plus the 1px
  border).
- Timing values (`cx` under `useFrame`) differ every run. Assert on relations, not exact numbers.
