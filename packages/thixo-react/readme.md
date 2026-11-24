# thixo-react

Runs a compiled thixo program in the browser with React. It is part of the wall: it builds the `thixo` module the
program imports and decides what the program's elements can reach, so a change here needs a test that tries to get
past it.

```ts
import { load, mount } from "thixo-react";

const handle = mount(element, await load(code), {
  modules: { "@host/palette": { colors: ["#f00", "#0f0"], pick: (i: number) => i % 2 } },
  onError: (e) => console.warn(e),
});
handle.unmount();
```

Mounts a program in a box that fills `element` and clips it. Builds the `thixo` module (hooks, frame clock, pointer,
size, keys) and wraps each host module: functions named with a capital are components, other functions are host
functions, anything else is copied in as frozen data. `load` needs the page to allow `blob:` scripts. React and
react-dom are peer dependencies.

Its tests are the arena's in [bench](../../bench): every goal's detector runs against a program mounted with it.
