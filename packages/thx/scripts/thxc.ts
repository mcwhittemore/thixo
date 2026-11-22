// Compiles a folder of .thx files against the todo example's env (or one given as JSON) and prints the result as
// JSON: the manifest and meta, or the errors. For verification and for poking at the compiler by hand.
//   node --import tsx packages/thx/scripts/thxc.ts <folder> [--env env.json] [--code]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { compile, verifyOutput } from "../src/index.js";
import type { CompileEnv, SourceFiles } from "../src/contract.js";
import { todoEnv } from "../test/fixtures/env.js";

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--"));
if (!folder) {
  console.error("usage: thxc.ts <folder> [--env env.json] [--code]");
  process.exit(2);
}
const envAt = args.indexOf("--env");
const env: CompileEnv = envAt >= 0 ? JSON.parse(readFileSync(args[envAt + 1], "utf8")) : todoEnv();
const files: SourceFiles = {};
const walk = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".thx")) files[relative(folder, full)] = readFileSync(full, "utf8");
  }
};
walk(folder);
const r = compile(files, env);
if (!r.ok) {
  console.log(JSON.stringify({ ok: false, errors: r.errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, meta: r.meta, manifest: r.manifest, sourceHash: r.sourceHash, verified: verifyOutput(r.code).ok, ...(args.includes("--code") ? { code: r.code } : {}) }, null, 2));
