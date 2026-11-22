import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildCompileEnv } from "../src/server/index.js";
import { typecheck } from "./helpers/typecheck.js";
import { app } from "./helpers/todo-server.js";

const env = buildCompileEnv(app, {});
const modules = Object.fromEntries(Object.entries(env.modules).map(([name, m]) => [name, m.dts]));
const folder = join(import.meta.dirname, "../../../examples/todo/plugins");

/** A plugin folder's .thx files as TypeScript the stand-in checker reads: plugin.thx as .tsx, others as .ts. */
function files(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(join(folder, name))) {
    if (!file.endsWith(".thx")) continue;
    const ext = file === "plugin.thx" ? ".tsx" : ".ts";
    out[`/${name}/${file.replace(/\.thx$/, ext)}`] = readFileSync(join(folder, name, file), "utf8");
  }
  return out;
}

test("the todo example's default plugins are .thx folders, each with a plugin.thx and an id", () => {
  const names = readdirSync(folder).sort();
  assert.deepEqual(names, ["done-badge", "due-dates", "todo-list"]);
  for (const name of names) {
    const source = readFileSync(join(folder, name, "plugin.thx"), "utf8");
    assert.match(source, /export default definePlugin\(/);
    assert.match(source, /id: "plg_[a-z_]+"/);
    assert.doesNotMatch(source, /from "react"/);
  }
});

test("each default plugin type-checks against the app's generated declarations", () => {
  for (const name of ["todo-list", "due-dates", "done-badge"]) assert.deepEqual(typecheck({ modules, files: files(name) }), [], name);
});

test("the todo list places the todo-row child slot in each row, and done-badge fills it (S13)", () => {
  assert.match(readFileSync(join(folder, "todo-list/plugin.thx"), "utf8"), /<ChildSlot is=\{todoRow\} context=\{\{ todoId: todo\.id \}\}/);
  assert.match(readFileSync(join(folder, "done-badge/plugin.thx"), "utf8"), /definePlugin\(\s*todoRow,/);
});
