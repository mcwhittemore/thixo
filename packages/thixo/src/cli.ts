// `thixo compile <folder|file.thx> [-o out.js] [--entry main.thx] [--modules decls.json] [--json]`
//
// Compiles a program to one ES module. `--modules` names a JSON file mapping each host module's specifier to its
// `.d.ts` text, or to a path of a `.d.ts` file relative to the JSON. Errors print as `file:line:column code message`,
// or as JSON with `--json`. Exit code 0 when it compiled, 1 when the source has errors, 2 for bad usage.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { compile } from "./compiler/compile.js";
import type { ModuleDecl, SourceFiles } from "./contract.js";

interface Io {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
}

const USAGE = "usage: thixo compile <folder|file.thx> [-o out.js] [--entry main.thx] [--modules decls.json] [--json]\n";

export function readProgram(path: string): { files: SourceFiles; entry?: string } {
  const full = resolve(path);
  if (statSync(full).isFile()) {
    if (!full.endsWith(".thx")) throw new Error(`${path} is not a .thx file.`);
    return { files: readFolder(dirname(full)), entry: basename(full) };
  }
  return { files: readFolder(full) };
}

function readFolder(root: string): SourceFiles {
  const out: SourceFiles = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".thx")) out[relative(root, full).split("\\").join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

export function readModules(path: string): Record<string, ModuleDecl> {
  const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  const out: Record<string, ModuleDecl> = {};
  for (const [spec, value] of Object.entries(json)) {
    if (typeof value !== "string") throw new Error(`${path}: "${spec}" must map to .d.ts text or a path.`);
    out[spec] = { dts: value.endsWith(".d.ts") ? readFileSync(join(dirname(path), value), "utf8") : value };
  }
  return out;
}

export function main(argv: string[], io: Io): number {
  const [command, ...rest] = argv;
  if (command !== "compile") {
    io.stderr.write(USAGE);
    return 2;
  }
  let input: string | undefined;
  let out: string | undefined;
  let entry: string | undefined;
  let modulesPath: string | undefined;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-o" || a === "--out") out = rest[++i];
    else if (a === "--entry") entry = rest[++i];
    else if (a === "--modules") modulesPath = rest[++i];
    else if (a === "--json") json = true;
    else if (!a.startsWith("-") && input === undefined) input = a;
    else {
      io.stderr.write(`unknown argument ${a}\n${USAGE}`);
      return 2;
    }
  }
  if (!input) {
    io.stderr.write(USAGE);
    return 2;
  }
  let files: SourceFiles;
  let modules: Record<string, ModuleDecl> | undefined;
  try {
    const read = readProgram(input);
    files = read.files;
    entry ??= read.entry;
    if (modulesPath) modules = readModules(modulesPath);
  } catch (e) {
    io.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  const r = compile(files, { entry, modules });
  if (!r.ok) {
    if (json) io.stdout.write(JSON.stringify({ ok: false, errors: r.errors }, null, 2) + "\n");
    else for (const e of r.errors) io.stderr.write(`${e.file}:${e.line}:${e.column} ${e.code} ${e.message}${e.hint ? `\n  hint: ${e.hint}` : ""}\n`);
    return 1;
  }
  if (out) writeFileSync(out, r.code);
  if (json) io.stdout.write(JSON.stringify({ ok: true, imports: r.imports, links: r.links, sourceHash: r.sourceHash, ...(out ? {} : { code: r.code }) }, null, 2) + "\n");
  else if (!out) io.stdout.write(r.code);
  return 0;
}
