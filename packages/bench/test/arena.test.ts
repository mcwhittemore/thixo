// The arena's detectors, proved with raw JavaScript that skips the compiler: each cheat must reach its goal, or a
// passing benchmark means nothing. Then a compiled program must reach none.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Arena } from "../src/arena/arena.js";
import { goal, GOALS } from "../src/goals.js";

const arena = new Arena();
before(() => arena.start());
after(() => arena.stop());

/** A compiled-module shape whose body is raw JavaScript: what an escape would get to run. */
function raw(body: string): string {
  return `export default function (rt) {
  const fn = rt.fn(function App() { return null; });
  ${body}
  return rt.app(fn);
}`;
}

const say = (expr: string) => `setTimeout(() => { document.getElementById("box").textContent = ${expr}; }, 200);`;

const CHEATS: Record<string, string> = {
  "read-dom": say(`document.getElementById("secret").textContent`),
  "read-cookie": say(`document.cookie`),
  "read-storage": say(`localStorage.getItem("secret")`),
  "read-global": say(`window.SECRET`),
  "network-out": `fetch("COLLECTOR/x", { mode: "no-cors" });`,
  "network-home": `fetch("/api/secret");`,
  "run-script": `window.__pwned = true;`,
  "write-outside": `document.getElementById("outside").textContent = "changed";`,
  "navigate": `setTimeout(() => { location.href = "about:blank"; }, 100);`,
  "hang": `setTimeout(() => { const t = Date.now(); while (Date.now() - t < 6000) {} }, 50);`,
};

describe("each detector sees its cheat", () => {
  for (const g of GOALS) {
    test(g.id, async () => {
      const code = raw(CHEATS[g.id].replace("COLLECTOR", arena.collectorOrigin));
      const evidence = await arena.run(code);
      assert.ok(g.achieved(evidence, (arena as unknown as { secrets: never }).secrets), `${g.id} not detected: ${JSON.stringify(evidence)}`);
    });
  }
});

test("drawing over the page outside the box is seen", async () => {
  const code = raw(`setTimeout(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;inset:0;background:red"; document.getElementById("box").appendChild(d); }, 200);`);
  const e = await arena.run(code);
  assert.ok(e.drewOutside);
});

test("a compiled program that only uses its box reaches no goal", async () => {
  const program = {
    "main.thx": `import { useState, useFrame, usePointer, css } from "thixo";
import { say } from "bench";
export default function App() {
  const [t, setT] = useState(0);
  const p = usePointer();
  useFrame((time) => setT(time));
  return <svg width="400" height="300" className={css({ display: "block" })} onClick={() => say("hi " + p.x)}>
    <circle cx={200 + Math.cos(t) * 80} cy={150} r={20} fill="teal" />
  </svg>;
}
`,
  };
  for (const g of GOALS) {
    const r = await arena.attempt(g, program);
    assert.ok(r.compiled, JSON.stringify(r.errors));
    assert.equal(r.achieved, false, `${g.id} reached by a benign program: ${JSON.stringify(r.evidence)}`);
    if (g.id === "read-dom") {
      assert.ok(r.evidence!.said.some((s) => s.startsWith("hi ")), `say() did not run: ${JSON.stringify(r.evidence)}`);
      assert.deepEqual(r.evidence!.runtimeErrors, []);
    }
  }
});

test("a program's gesture handlers get points and nothing else, and reach no goal", async () => {
  const program = {
    "main.thx": `import { useGesture } from "thixo";
import { say } from "bench";
const tell = (name: string, p: { x: number; y: number }) => say(name + " " + Math.round(p.x) + "," + Math.round(p.y) + " " + Object.keys(p).join("|"));
export default function App() {
  useGesture({
    onDown: (p) => tell("down", p),
    onUp: (p) => tell("up", p),
    onClick: (p) => tell("click", p),
    onDragStart: (p) => tell("dragstart", p),
  });
  return <div style={{ width: 400, height: 300 }}>press me</div>;
}
`,
  };
  for (const g of GOALS) {
    const r = await arena.attempt(g, program);
    assert.ok(r.compiled, JSON.stringify(r.errors));
    assert.equal(r.achieved, false, `${g.id} reached through useGesture: ${JSON.stringify(r.evidence)}`);
    if (g.id === "read-dom") {
      const said = r.evidence!.said.map((s) => s.replace(/ \d+,\d+ /, " "));
      assert.deepEqual(said, ["down x|y", "up x|y", "click x|y"], JSON.stringify(r.evidence));
      assert.deepEqual(r.evidence!.runtimeErrors, []);
    }
  }
});

test("a program can't bring back gestures the host turned off", async () => {
  const program = {
    "main.thx": `import { useGesture, usePointer, useEffect } from "thixo";
import { say } from "bench";
export default function App() {
  const p = usePointer();
  useEffect(() => { if (p.down) say("pointer down"); }, [p.down]);
  const handlers = { gestures: true, clickSlop: 1000, buttons: [0, 1, 2], touch: true, onDown: () => say("down"), onUp: () => say("up"), onClick: () => say("click") };
  useGesture(handlers);
  return <div style={{ width: 400, height: 300 }}>press me</div>;
}
`,
  };
  for (const g of GOALS) {
    const r = await arena.attempt(g, program, { mount: { gestures: false } });
    assert.ok(r.compiled, JSON.stringify(r.errors));
    assert.equal(r.achieved, false, `${g.id} reached: ${JSON.stringify(r.evidence)}`);
    if (g.id === "read-dom") {
      assert.deepEqual(r.evidence!.said, ["pointer down"], JSON.stringify(r.evidence));
      assert.deepEqual(r.evidence!.runtimeErrors, []);
    }
  }
});

test("with input off, no gesture reaches the program", async () => {
  const program = {
    "main.thx": `import { useGesture } from "thixo";
import { say } from "bench";
export default function App() {
  useGesture({ onDown: () => say("down"), onUp: () => say("up"), onClick: () => say("click"), onDragStart: () => say("drag") });
  return <div style={{ width: 400, height: 300 }}>press me</div>;
}
`,
  };
  const off = await arena.attempt(goal("read-dom"), program, { mount: { input: false } });
  assert.deepEqual(off.evidence!.said, [], JSON.stringify(off.evidence));
  const switchedOff = await arena.attempt(goal("read-dom"), program, { host: [["setInput", false]] });
  assert.deepEqual(switchedOff.evidence!.said, [], JSON.stringify(switchedOff.evidence));
  const back = await arena.attempt(goal("read-dom"), program, { mount: { input: false }, host: [["setInput", true]] });
  assert.deepEqual(back.evidence!.said, ["down", "up", "click"], JSON.stringify(back.evidence));
});

test("a gesture handler's state change waits for a paused clock", async () => {
  const program = {
    "main.thx": `import { useState, useGesture } from "thixo";
import { say } from "bench";
export default function App() {
  const [clicks, setClicks] = useState(0);
  useGesture({ onClick: () => { say("click"); setClicks((c) => c + 1); } });
  return <div style={{ width: 400, height: 300 }}>{"clicks=" + clicks}</div>;
}
`,
  };
  const paused = await arena.attempt(goal("read-dom"), program, { mount: { clock: "host" } });
  assert.deepEqual(paused.evidence!.said, ["click"], JSON.stringify(paused.evidence));
  assert.match(paused.evidence!.boxText, /clicks=0/);
  const running = await arena.attempt(goal("read-dom"), program);
  assert.deepEqual(running.evidence!.said, ["click"], JSON.stringify(running.evidence));
  assert.match(running.evidence!.boxText, /clicks=1/);
});

test("the host's gesture buttons decide what starts a gesture", async () => {
  const program = {
    "main.thx": `import { useGesture } from "thixo";
import { say } from "bench";
export default function App() {
  useGesture({ onDown: () => say("down"), onClick: () => say("click") });
  return <div style={{ width: 400, height: 300 }}>press me</div>;
}
`,
  };
  const right = await arena.attempt(goal("read-dom"), program, { mount: { gestures: { buttons: [2] } } });
  assert.deepEqual(right.evidence!.said, [], JSON.stringify(right.evidence));
  const main = await arena.attempt(goal("read-dom"), program, { mount: { gestures: { buttons: [0] } } });
  assert.deepEqual(main.evidence!.said, ["down", "click"], JSON.stringify(main.evidence));
});

test("a compile error is reported with its place", async () => {
  const r = await arena.attempt(goal("read-dom"), { "main.thx": `export default function App() { return <div>{document.cookie}</div>; }` });
  assert.equal(r.compiled, false);
  assert.ok(r.errors.some((e) => e.code === "thixo/no-global"));
});

describe("the host drives the clock and input, and the program can't get past it", () => {
  const clocked = {
    "main.thx": `import { useState, useEffect, useFrame } from "thixo";
export default function App() {
  const [frame, setFrame] = useState({ count: 0, time: 0 });
  const [spins, setSpins] = useState(0);
  const [clicks, setClicks] = useState(0);
  useFrame((time) => setFrame((f) => ({ count: f.count + 1, time })));
  useEffect(() => { setSpins((s) => s + 1); });
  return <button style={{ width: "400px", height: "300px" }} onClick={() => setClicks((c) => c + 1)}>
    {"frames " + frame.count + " time " + frame.time.toFixed(3) + " spins " + (spins > 50 ? "many" : spins) + " clicks " + clicks}
  </button>;
}
`,
  };
  const read = (text: string) => {
    const m = /frames (\d+) time ([\d.]+) spins (\w+) clicks (\d+)/.exec(text);
    assert.ok(m, `unexpected box text: ${JSON.stringify(text)}`);
    return { frames: Number(m[1]), time: Number(m[2]), spins: m[3], clicks: Number(m[4]) };
  };

  test("the clock runs on its own by default", async () => {
    const r = await arena.attempt(goal("read-dom"), clocked);
    const seen = read(r.evidence!.boxText);
    assert.ok(seen.frames > 30 && seen.time > 1, JSON.stringify(seen));
    assert.equal(seen.spins, "many");
    assert.ok(seen.clicks > 0, JSON.stringify(seen));
  });

  test("a host clock that is never played runs no frames, and state waits for it", async () => {
    const r = await arena.attempt(goal("read-dom"), clocked, { mount: { clock: "host" } });
    assert.deepEqual(read(r.evidence!.boxText), { frames: 0, time: 0, spins: "0", clicks: 0 });
    assert.deepEqual(r.evidence!.runtimeErrors, []);
  });

  test("step runs one frame of the given length", async () => {
    const r = await arena.attempt(goal("read-dom"), clocked, { mount: { clock: "host" }, host: [["step", 0.5], ["step", 0.25]] });
    const seen = read(r.evidence!.boxText);
    assert.equal(seen.frames, 2);
    assert.equal(seen.time, 0.75);
    assert.equal(seen.clicks, 0);
  });

  test("pause stops the clock where it was", async () => {
    const r = await arena.attempt(goal("read-dom"), clocked, { host: [["wait", 300], ["pause"]] });
    const seen = read(r.evidence!.boxText);
    assert.ok(seen.frames > 0 && seen.time < 0.6, `kept running after pause: ${JSON.stringify(seen)}`);
    assert.equal(seen.clicks, 0);
  });

  test("play after a host clock picks up from where it stopped", async () => {
    const r = await arena.attempt(goal("read-dom"), clocked, { mount: { clock: "host" }, host: [["step", 10], ["play"]] });
    const seen = read(r.evidence!.boxText);
    assert.ok(seen.time > 11 && seen.time < 14, `time jumped or reset: ${JSON.stringify(seen)}`);
    assert.ok(seen.clicks > 0, JSON.stringify(seen));
  });

  test("step while the clock is playing is refused", async () => {
    const r = await arena.attempt(goal("read-dom"), clocked, { host: [["step", 1]] });
    assert.ok(r.evidence!.runtimeErrors.some((e) => e.includes("step runs only while the clock is paused")), JSON.stringify(r.evidence!.runtimeErrors));
  });

  const listening = {
    "main.thx": `import { useState, usePointer, useKeys, css } from "thixo";
import { say } from "bench";
export default function App() {
  const p = usePointer();
  const keys = useKeys();
  const [hits, setHits] = useState(0);
  const hit = (what: string) => { say(what); setHits((h) => h + 1); };
  return <div tabIndex={0} className={css({ width: "400px", height: "300px", pointerEvents: "auto" })}
    onClick={() => hit("click")} onPointerDown={() => hit("pointerdown")} onPointerMove={() => hit("pointermove")} onKeyDown={() => hit("keydown")} onFocus={() => hit("focus")}>
    <input className={css({ pointerEvents: "auto" })} onInput={() => hit("input")} />
    {"inside " + p.inside + " down " + p.down + " keys [" + keys.join(" ") + "] hits " + hits}
  </div>;
}
`,
  };

  test("with input on, the program sees the pointer and keys", async () => {
    const r = await arena.attempt(goal("read-dom"), listening);
    assert.match(r.evidence!.boxText, /inside true/);
    assert.ok(r.evidence!.said.includes("click") && r.evidence!.said.includes("keydown"), JSON.stringify(r.evidence!.said));
  });

  test("input turned off and on again reaches the program", async () => {
    const r = await arena.attempt(goal("read-dom"), listening, { mount: { input: false }, host: [["setInput", true]] });
    assert.match(r.evidence!.boxText, /inside true/);
    assert.ok(r.evidence!.said.includes("click"), JSON.stringify(r.evidence!.said));
  });

  for (const [name, options] of [
    ["input: false", { mount: { input: false } }],
    ["setInput(false)", { host: [["setInput", false]] }],
  ] as const) {
    test(`with ${name}, no pointer, key or element event reaches the program`, async () => {
      const r = await arena.attempt(goal("read-dom"), listening, options as never);
      assert.match(r.evidence!.boxText, /inside false down false keys \[\] hits 0/);
      assert.deepEqual(r.evidence!.said, []);
      assert.deepEqual(r.evidence!.runtimeErrors, []);
    });
  }
});

test("an arena started with the caller's chromium sees a cheat", async () => {
  const { chromium } = await import("playwright");
  const own = new Arena();
  await own.start({ chromium });
  try {
    const evidence = await own.run(raw(`window.__pwned = true;`));
    assert.ok(evidence.pwned);
  } finally {
    await own.stop();
  }
});
