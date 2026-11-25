// What installing @thixo/core costs a host: no dependencies, a small bundle that needs nothing from Node, and a fast
// compile. A host that compiles on an edge worker relies on all three.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { buildSync } from "esbuild";

/** The budget. Raising a number here is a decision for the owner, not a fix. */
export const BUDGET = {
  /** The bundled, minified compiler, gzipped. */
  gzipBytes: 100_000,
  /** The readme's Spin, compiled again in a process that has already compiled it. */
  warmMs: 5,
  /** The readme's Spin, the first compile in a fresh process, after the module has loaded (and warmed itself). */
  coldMs: 5,
};

const SPIN = `import { useState, useFrame } from "thixo";

export default function Spin() {
  const [t, setT] = useState(0);
  useFrame((time) => setT(time));
  return (
    <svg width="200" height="200">
      <rect x="70" y="70" width="60" height="60" fill="teal" transform={\`rotate(\${t * 90} 100 100)\`} />
    </svg>
  );
}
`;

const entry = join(import.meta.dirname, "../src/index.ts");

function bundle(format: "esm" | "iife"): string {
  const r = buildSync({ entryPoints: [entry], bundle: true, minify: true, format, globalName: "thixo", platform: "neutral", write: false, logLevel: "silent" });
  return r.outputFiles[0].text;
}

describe("installing @thixo/core", () => {
  test("brings no dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.deepEqual(pkg.peerDependencies ?? {}, {});
    assert.deepEqual(pkg.optionalDependencies ?? {}, {});
  });

  test("bundles for any JavaScript host, and compiles there without Node", () => {
    const code = bundle("iife");
    const sandbox: Record<string, unknown> = { URL };
    vm.runInNewContext(code, sandbox);
    const { compile } = sandbox.thixo as typeof import("../src/index.js");
    const r = compile({ "main.thx": SPIN });
    assert.ok(r.ok, r.ok ? "" : r.errors.map((e) => e.message).join("\n"));
    assert.match(r.sourceHash, /^[0-9a-f]{64}$/);
  });

  test(`is under ${BUDGET.gzipBytes} bytes gzipped`, () => {
    const bytes = gzipSync(bundle("esm"), { level: 9 }).length;
    assert.ok(bytes <= BUDGET.gzipBytes, `${bytes} bytes`);
  });

  test(`compiles Spin warm in under ${BUDGET.warmMs} ms and cold in under ${BUDGET.coldMs} ms`, () => {
    const dir = mkdtempSync(join(tmpdir(), "thixo-budget-"));
    writeFileSync(join(dir, "thixo.mjs"), bundle("esm"));
    writeFileSync(
      join(dir, "time.mjs"),
      `const t0 = performance.now();
const { compile } = await import("./thixo.mjs");
const load = performance.now() - t0;
const src = ${JSON.stringify(SPIN)};
let t = performance.now();
const r = compile({ "main.thx": src });
const cold = performance.now() - t;
if (!r.ok) throw new Error("Spin does not compile");
const runs = [];
for (let i = 0; i < 50; i++) { t = performance.now(); compile({ "main.thx": src }); runs.push(performance.now() - t); }
runs.sort((a, b) => a - b);
console.log(JSON.stringify({ load, cold, warm: runs[25] }));`,
    );
    const samples = [0, 1, 2].map(() => JSON.parse(execFileSync(process.execPath, [join(dir, "time.mjs")], { encoding: "utf8" })) as { load: number; cold: number; warm: number });
    const cold = Math.min(...samples.map((s) => s.cold));
    const warm = Math.min(...samples.map((s) => s.warm));
    const load = Math.min(...samples.map((s) => s.load));
    console.log(`budget: load ${load.toFixed(1)} ms (not budgeted), cold ${cold.toFixed(2)} ms, warm ${warm.toFixed(2)} ms`);
    assert.ok(warm <= BUDGET.warmMs, `warm ${warm.toFixed(2)} ms`);
    assert.ok(cold <= BUDGET.coldMs, `cold ${cold.toFixed(2)} ms`);
  });
});
