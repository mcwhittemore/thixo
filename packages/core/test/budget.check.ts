// What installing @thixo/core costs a host: no dependencies, a small bundle that needs nothing from Node, and a fast
// compile. A host that compiles on an edge worker relies on all three. `npm test` runs this file on its own, after
// the other suites, so their work doesn't land in the timings.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { buildSync } from "esbuild";
import type { CompileOptions, SourceFiles } from "../src/contract.js";
import { WARM_UP_FILES } from "../src/compiler/warm-up.js";
import { readProgram, testOptions } from "./fixtures/env.js";

/** The budget. Raising a number here is a decision for the owner, not a fix. */
export const BUDGET = {
  /** The bundled, minified compiler, gzipped. */
  gzipBytes: 100_000,
  /** A program compiled again in a process that has already compiled it. */
  warmMs: 5,
  /** A program's first compile in a fresh process, after the module has loaded (and warmed itself up). */
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

  // Each program is timed in a fresh process: the first compile there is cold. None of them is the program the module
  // compiles to warm itself up, so a cold path the warm-up misses shows up here.
  const programs: Record<string, { files: SourceFiles; options: CompileOptions }> = {
    "the readme's Spin": { files: { "main.thx": SPIN }, options: {} },
    "the orbit fixture": { files: readProgram("orbit"), options: {} },
    "the todo-list fixture, over host modules": { files: readProgram("todo-list"), options: testOptions() },
  };

  for (const [name, { files, options }] of Object.entries(programs))
    test(`compiles ${name} in under ${BUDGET.coldMs} ms cold and ${BUDGET.warmMs} ms warm`, () => {
      assert.notDeepEqual(files, WARM_UP_FILES);
      const dir = mkdtempSync(join(tmpdir(), "thixo-budget-"));
      writeFileSync(join(dir, "thixo.mjs"), bundle("esm"));
      writeFileSync(
        join(dir, "time.mjs"),
        `const t0 = performance.now();
const { compile } = await import("./thixo.mjs");
const load = performance.now() - t0;
const files = ${JSON.stringify(files)};
const options = ${JSON.stringify(options)};
let t = performance.now();
const r = compile(files, options);
const cold = performance.now() - t;
if (!r.ok) throw new Error("it does not compile: " + r.errors.map((e) => e.message).join("; "));
const runs = [];
for (let i = 0; i < 30; i++) { t = performance.now(); compile(files, options); runs.push(performance.now() - t); }
runs.sort((a, b) => a - b);
console.log(JSON.stringify({ load, cold, warm: runs[15] }));`,
      );
      const samples = [0, 1, 2].map(() => JSON.parse(execFileSync(process.execPath, [join(dir, "time.mjs")], { encoding: "utf8" })) as { load: number; cold: number; warm: number });
      const cold = Math.min(...samples.map((x) => x.cold));
      const warm = Math.min(...samples.map((x) => x.warm));
      const load = Math.min(...samples.map((x) => x.load));
      console.log(`budget, ${name}: load ${load.toFixed(1)} ms (not budgeted), cold ${cold.toFixed(2)} ms, warm ${warm.toFixed(2)} ms`);
      assert.ok(cold <= BUDGET.coldMs, `cold ${cold.toFixed(2)} ms`);
      assert.ok(warm <= BUDGET.warmMs, `warm ${warm.toFixed(2)} ms`);
    });
});
