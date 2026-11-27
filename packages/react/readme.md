# @thixo/react

Runs a compiled thixo program in the browser with React. It is part of the wall: it builds the `thixo` module the
program imports and decides what the program's elements can reach, so a change here needs a test that tries to get
past it.

```ts
import { load, mount } from "@thixo/react";

const handle = mount(element, await load(code), {
  modules: { "@host/palette": { colors: ["#f00", "#0f0"], pick: (i: number) => i % 2 } },
  gestures: { clickSlop: 8, buttons: [0], touch: true },
  onError: (e) => console.warn(e),
});
handle.unmount();
```

Mounts a program in a box that fills `element` and clips it. Builds the `thixo` module (hooks, frame clock, pointer,
size, keys) and wraps each host module: functions named with a capital are components, other functions are host
functions, anything else is copied in as frozen data. `gestures` sets how the program's `useGesture` works: how far a click may
move (`clickSlop`, default 4px), which `buttons` start a gesture (default `[0]`) and whether `touch` counts. `false`
turns gestures off. The program only receives the calls, so it can't change any of this. `load` needs the page to allow `blob:` scripts. React and
react-dom are peer dependencies.

### The clock and input

The host, not the program, decides when the program moves and whether it hears input:

```ts
const card = mount(element, module, { clock: "host", input: false });
card.step(1.5);                 // one frame of 1.5 seconds, rendered before step returns: a still
element.onmouseenter = () => card.play();
element.onmouseleave = () => card.pause();
```

- `clock: "auto"` (the default) runs the clock from the start; `"host"` starts it paused at time 0.
- `play()` and `pause()` work on any mount. Time picks up where it stopped. While paused, no frame runs and the
  program's state changes wait until the clock moves, so a program can't animate itself with effects that set state.
- `step(seconds)` moves a paused clock on by one frame. It throws while the clock is playing.
- `input: false`, or `setInput(false)` later, makes the box `inert`: no pointer, key, focus or element event reaches
  the program, `usePointer()` is `{ x: 0, y: 0, down: false, inside: false }` and `useKeys()` is `[]`. Events go to
  the host's element, so the host still sees the hover. No `useGesture` call comes while input is off. A press in
  progress when `setInput(false)` runs gets its `onUp`, and `onDragEnd` if it was a drag, at its last point first.

Its tests are the arena's in [bench](../../bench): every goal's detector runs against a program mounted with it.
