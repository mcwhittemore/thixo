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
    const r = await arena.attempt(g, program, { gestures: false });
    assert.ok(r.compiled, JSON.stringify(r.errors));
    assert.equal(r.achieved, false, `${g.id} reached: ${JSON.stringify(r.evidence)}`);
    if (g.id === "read-dom") {
      assert.deepEqual(r.evidence!.said, ["pointer down"], JSON.stringify(r.evidence));
      assert.deepEqual(r.evidence!.runtimeErrors, []);
    }
  }
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
  const right = await arena.attempt(goal("read-dom"), program, { gestures: { buttons: [2] } });
  assert.deepEqual(right.evidence!.said, [], JSON.stringify(right.evidence));
  const main = await arena.attempt(goal("read-dom"), program, { gestures: { buttons: [0] } });
  assert.deepEqual(main.evidence!.said, ["down", "click"], JSON.stringify(main.evidence));
});

test("a compile error is reported with its place", async () => {
  const r = await arena.attempt(goal("read-dom"), { "main.thx": `export default function App() { return <div>{document.cookie}</div>; }` });
  assert.equal(r.compiled, false);
  assert.ok(r.errors.some((e) => e.code === "thixo/no-global"));
});
