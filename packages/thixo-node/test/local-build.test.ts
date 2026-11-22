import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompileEnv } from "thixo/contract";
import { localBuild } from "../src/local-build.js";

const env: CompileEnv = { modules: {}, endpoints: {}, records: {}, slots: {}, services: [], libraries: [], addressHosts: [] };
const okResult = { ok: true as const, code: "export default function (rt) {}", manifest: {} as never, meta: {} as never, sourceHash: "h" };

test("a compile result passes through when the output verifies", async () => {
  const seen: string[] = [];
  const build = localBuild({ compile: () => okResult, verifyOutput: (code) => (seen.push(code), { ok: true }) });
  assert.deepEqual(await build.build({ "plugin.thx": "" }, env), okResult);
  assert.deepEqual(seen, [okResult.code]);
});

test("compile errors are returned and the output is never verified", async () => {
  const errors = [{ file: "plugin.thx", line: 1, column: 2, code: "thx/no-global", message: "no window" }];
  let verified = false;
  const build = localBuild({ compile: () => ({ ok: false, errors }), verifyOutput: () => ((verified = true), { ok: true }) });
  assert.deepEqual(await build.build({}, env), { ok: false, errors });
  assert.equal(verified, false);
});

test("a verifyOutput failure becomes build errors", async () => {
  const build = localBuild({ compile: () => okResult, verifyOutput: () => ({ ok: false, errors: ["names fetch", "names window"] }) });
  const result = await build.build({}, env);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.errors.map((e) => e.message), ["names fetch", "names window"]);
    assert.ok(result.errors.every((e) => e.code === "thx/output-rejected" && e.file === "(output)"));
  }
});

test("the default compiler is thixo-thx", async () => {
  const thx = await import("thixo-thx");
  const result = await localBuild().build({ "plugin.thx": "" }, env);
  assert.equal(typeof thx.compile, "function");
  assert.equal(typeof result.ok, "boolean");
});

test("verify runs the compiler's verifyOutput on stored code, for the plugin route", async () => {
  const seen: string[] = [];
  const build = localBuild({
    compile: () => ({ ok: false, errors: [] }),
    verifyOutput: (code) => (seen.push(code), code === "good" ? { ok: true } : { ok: false, errors: ["names globalThis"] }),
  });
  assert.deepEqual(await build.verify!("good"), { ok: true });
  assert.deepEqual(await build.verify!("globalThis.fetch('/x')"), { ok: false, errors: ["names globalThis"] });
  assert.deepEqual(seen, ["good", "globalThis.fetch('/x')"]);
  assert.equal((await localBuild().verify!("globalThis.fetch('/x')")).ok, false);
});
