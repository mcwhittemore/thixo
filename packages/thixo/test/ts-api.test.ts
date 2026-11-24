import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "../src/compiler/ts-api.js";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("only ts-api.ts imports TypeScript's JS API", () => {
  const offenders = files(join(import.meta.dirname, "../src")).filter(
    (f) => !f.endsWith("ts-api.ts") && /from\s+["'](typescript|typescript-js-api)["']/.test(readFileSync(f, "utf8")),
  );
  assert.deepEqual(offenders, []);
});

test("the JS API is a 6.x release (7.x has none)", () => {
  assert.match(ts.version, /^6\./);
});
