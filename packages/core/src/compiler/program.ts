// A program as the compiler holds it: its files parsed and bound, the host modules it may import, and the lib. The lib
// and each module's declarations are parsed and bound once per process and shared by every compile.

import type { CompileEnv, SourceFiles, ThixoError } from "../contract.js";
import type * as A from "./syntax/ast.js";
import { lineCol } from "./syntax/ast.js";
import { parse } from "./syntax/parser.js";
import { bindFile, bindLibPart, type BoundFile, type GlobalScope, type Sym } from "./bind.js";
import { LIB_CHECK_DTS } from "./lib-dts.js";

export interface Lib {
  global: GlobalScope;
  /** The bound file of a lib declaration, for nodes inside it. */
  boundOf(file: A.SourceFile): BoundFile | undefined;
  /** Every declaration, read now. For tests. */
  loadAll(): BoundFile[];
}

export interface ModuleInfo {
  spec: string;
  bound: BoundFile;
  /** A syntax error in the module's declarations. */
  error?: ThixoError;
  /** Names its declarations use that don't exist, found the first time a compile checks it. */
  declErrors?: ThixoError[];
}

export interface ProgramFiles {
  /** Program path (`main.thx`) to its parsed file. */
  files: Map<string, A.SourceFile>;
  bound: Map<string, BoundFile>;
  /** The host modules the program's files import, read. */
  modules: Map<string, ModuleInfo>;
  lib: Lib;
  /** What an import names: a declaration in another program file or a host module, or undefined. */
  resolveAlias(sym: Sym): Sym | undefined;
}

let lib: Lib | undefined;

/** A Map that reads the lib declarations naming a key the first time the key is looked up. */
class LazyNames extends Map<string, Sym> {
  constructor(private readonly load: (name: string) => void) {
    super();
  }

  override get(name: string): Sym | undefined {
    const v = super.get(name);
    if (v !== undefined) return v;
    this.load(name);
    return super.get(name);
  }
}

/** The lib's top-level declarations, each with the names it declares. A doc comment goes with what follows it. */
function libParts(text: string): { text: string; names: string[] }[] {
  const parts: { text: string; names: string[] }[] = [];
  const lines = text.split("\n");
  let cur: string[] = [];
  const flush = () => {
    const t = cur.join("\n");
    cur = [];
    if (!t.trim()) return;
    const names = [...t.matchAll(/^(?:declare\s+)?(?:interface|type|var|function|namespace)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    parts.push({ text: t, names });
  };
  let commentOpen = false;
  for (const line of lines) {
    const top = /^(?:interface |type |declare )/.test(line);
    if (top && !commentOpen) flush();
    if (line.startsWith("/**")) {
      flush();
      commentOpen = !line.includes("*/");
      cur.push(line);
      if (!commentOpen) commentOpen = true;
      continue;
    }
    if (commentOpen && top) commentOpen = false;
    cur.push(line);
  }
  flush();
  return parts;
}

export function getLib(): Lib {
  if (lib) return lib;
  const parts = libParts(LIB_CHECK_DTS);
  const byName = new Map<string, number[]>();
  parts.forEach((p, i) => {
    for (const n of p.names) byName.set(n, [...(byName.get(n) ?? []), i]);
  });
  const loaded = new Set<number>();
  const files = new Map<A.SourceFile, BoundFile>();
  const load = (i: number) => {
    if (loaded.has(i)) return;
    loaded.add(i);
    const r = parse(parts[i].text, `(lib ${parts[i].names.join(", ")})`, "dts");
    if (r.error) throw new Error(`the lib does not parse: ${r.error.message}`);
    files.set(r.file, bindLibPart(r.file, global));
  };
  const loadName = (name: string) => {
    for (const i of byName.get(name) ?? []) load(i);
  };
  const global: GlobalScope = { values: new LazyNames(loadName), types: new LazyNames(loadName) };
  lib = {
    global,
    boundOf: (f) => files.get(f),
    loadAll: () => {
      parts.forEach((_, i) => load(i));
      return [...files.values()];
    },
  };
  return lib;
}

const modules = new Map<string, ModuleInfo>();

export function getModule(spec: string, dts: string): ModuleInfo {
  const key = `${spec}\0${dts}`;
  let m = modules.get(key);
  if (!m) {
    const r = parse(dts, spec, "dts");
    const bound = bindFile(r.file, "module", getLib().global);
    m = { spec, bound };
    if (r.error) {
      const pos = lineCol(r.file, r.error.pos);
      m.error = { file: spec, line: pos.line, column: pos.column, code: "thixo/env-type", message: `The declarations of \`${spec}\` are not valid syntax: ${r.error.message}` };
    }
    if (modules.size > 200) modules.clear();
    modules.set(key, m);
  }
  return m;
}

/** Resolves a relative specifier from one program file to another program path, or undefined. */
export function resolveRelative(from: string, spec: string, files: { has(path: string): boolean } | SourceFiles): string | undefined {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return undefined;
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  for (const part of spec.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      if (dir.length === 0) return undefined;
      dir.pop();
    } else dir.push(part);
  }
  const joined = dir.join("/");
  const candidate = joined.endsWith(".thx") ? joined : `${joined}.thx`;
  const has = typeof (files as { has?: unknown }).has === "function" ? (files as { has(p: string): boolean }).has(candidate) : Object.prototype.hasOwnProperty.call(files, candidate);
  return has ? candidate : undefined;
}

export interface Parsed {
  program: ProgramFiles;
  /** Syntax errors in the program's files. */
  errors: ThixoError[];
}

export function createProgramFiles(sources: SourceFiles, env: CompileEnv): Parsed {
  const libInfo = getLib();
  const files = new Map<string, A.SourceFile>();
  const errors: ThixoError[] = [];
  for (const [path, text] of Object.entries(sources)) {
    const r = parse(text, path, "tsx");
    files.set(path, r.file);
    if (r.error) {
      const pos = lineCol(r.file, r.error.pos);
      errors.push({ file: path, line: pos.line, column: pos.column, code: "thixo/syntax", message: `This is not valid syntax: ${r.error.message}`, hint: "In a .thx file `<T>value` is read as JSX. Write the value with its type on the declaration instead." });
    }
  }
  // Only the modules some file imports are read: a host may offer many, and a program uses a few.
  const mods = new Map<string, ModuleInfo>();
  for (const file of files.values())
    for (const st of file.statements)
      if (st.kind === "Import") {
        const spec = st.source.value;
        if (!mods.has(spec) && Object.prototype.hasOwnProperty.call(env.modules, spec)) mods.set(spec, getModule(spec, env.modules[spec].dts));
      }
  const bound = new Map<string, BoundFile>();
  for (const [path, file] of files) bound.set(path, bindFile(file, "program", libInfo.global));

  const resolveAlias = (sym: Sym): Sym | undefined => {
    const seen = new Set<Sym>();
    let s: Sym | undefined = sym;
    while (s && s.kind === "import") {
      if (seen.has(s)) return undefined;
      seen.add(s);
      if (s.importStyle !== "named") return undefined;
      const from = s.importFrom!;
      let target: BoundFile | undefined;
      if (s.file.home === "program") {
        const rel = resolveRelative(s.file.file.path, from, files);
        if (rel !== undefined) target = bound.get(rel);
        else if (!from.startsWith(".")) target = mods.get(from)?.bound;
      } else if (!from.startsWith(".")) target = mods.get(from)?.bound;
      s = target?.exports.get(s.importName!);
    }
    return s;
  };

  return { program: { files, bound, modules: mods, lib: libInfo, resolveAlias }, errors };
}
