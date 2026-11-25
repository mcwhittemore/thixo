![The word thixo, built from a lattice of nodes. A bee, a frog and a swallow each reshape its letters, and a wasp writes it back.](thixo.gif)

# thixo

```sh
Thixotropic (adj)
holds its shape at rest, flows when you work it
```

thixo is a language that reads as TypeScript and React, and compiles to JavaScript that can run in your page
without being able to reach it. A thixo program can draw, animate and respond to the pointer inside the box it is
mounted in. It can't read the page around it, touch the network, run JavaScript of its own, or do anything the host
didn't hand it.

It exists for code written by agents. When a person asks an agent for something and the agent writes code, that
code should be able to do only what the person can see it doing.

```tsx
import { useState, useFrame } from "thixo";

export default function Spin() {
  const [t, setT] = useState(0);
  useFrame((time) => setT(time));
  return (
    <svg width="200" height="200">
      <rect x="70" y="70" width="60" height="60" fill="teal" transform={`rotate(${t * 90} 100 100)`} />
    </svg>
  );
}
```

```sh
npx @thixo/cli compile ./spin -o spin.js
```

```ts
import { load, mount } from "@thixo/react";
mount(document.getElementById("box")!, await load(code));
```

## Try it

```sh
npm install
npm run build
npm test                                  # the compiler, runtime and their hostile programs
npm run bench -- --goal read-dom          # an agent tries to read the page through thixo
```

## The benchmark

The wall is only as good as the attempts to get past it. [bench/](bench/readme.md) gives an agent one goal, such as
"read the cookie" or "send a request to this server". The agent writes thixo, submits it, and the program is compiled
and run in headless Chromium beside secrets it isn't meant to reach. The arena reports what it saw. If the goal was
reached the agent is done, and the program is a bug to fix. If not, the agent gets the feedback and tries again.

## Reading

| Doc | What it answers |
| --- | --- |
| [The language](docs/language.md) | What a program can write, and where it differs from TypeScript |
| [Security](docs/security.md) | What a program can't do, what is trusted, and the known gaps |

## Layout

```
packages/core/   the compiler, the runtime and the output check
packages/cli/    the `thixo` command (@thixo/cli)
packages/react/  mounts a compiled program in the browser with React
bench/           agents against the wall: goals, the arena, the runner
docs/            the language, the security model
```

thixo started as a framework for malleable SaaS products, with this language as its plugin layer. That framework is
in the history, at commit `58adb67`.
