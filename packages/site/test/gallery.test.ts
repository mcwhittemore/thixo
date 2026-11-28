import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { compile } from "@thixo/core";
import { GALLERY } from "../src/gallery-entries.ts";
import { PROGRAMS_DIR, readProgram } from "../src/programs.ts";

for (const entry of GALLERY) {
  test(`the gallery program ${entry.id} compiles`, () => {
    const files = readProgram(entry.id);
    assert.ok(files["main.thx"], `${entry.id} has a main.thx`);
    const result = compile(files);
    assert.deepEqual(result.ok ? [] : result.errors, []);
  });
}

test("every program folder is on the site", () => {
  const onSite = new Set(["spin", ...GALLERY.map((e) => e.id)]);
  assert.deepEqual(readdirSync(PROGRAMS_DIR).filter((name) => !onSite.has(name)), []);
});
