// Builds one TypeScript program over a plugin's files, the language's lib and the host modules' declarations,
// entirely in memory. Plugin files are given to TypeScript as `.tsx` under `/src/`.

import ts from "typescript";
import type { CompileEnv, SourceFiles } from "../contract.js";
import { LIB_THX_DTS } from "./lib-dts.js";

export const LIB_PATH = "/lib.thx.d.ts";
const SRC = "/src/";

export const COMPILER_OPTIONS: ts.CompilerOptions = {
  noLib: true,
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  types: [],
  noImplicitReturns: false,
  allowUnreachableCode: true,
  skipLibCheck: false,
  isolatedModules: false,
};

export interface PluginProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  /** Plugin path (`plugin.thx`) to its source file. */
  files: Map<string, ts.SourceFile>;
  /** Source file name back to the plugin path, for files that are the plugin's. */
  pluginPathOf(sf: ts.SourceFile): string | undefined;
  /** Module specifier of a host module's declaration file. */
  moduleOf(sf: ts.SourceFile): string | undefined;
  isLib(sf: ts.SourceFile): boolean;
}

let libSource: ts.SourceFile | undefined;

function lib(): ts.SourceFile {
  libSource ??= ts.createSourceFile(LIB_PATH, LIB_THX_DTS, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return libSource;
}

export function tsPathOf(pluginPath: string): string {
  return SRC + pluginPath.replace(/\.thx$/, ".tsx");
}

/** Resolves a relative specifier from one plugin file to another plugin path, or undefined. */
export function resolveRelative(from: string, spec: string, files: SourceFiles): string | undefined {
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
  const candidates = joined.endsWith(".thx") ? [joined] : [`${joined}.thx`];
  for (const c of candidates) if (Object.prototype.hasOwnProperty.call(files, c)) return c;
  return undefined;
}

export function createPluginProgram(files: SourceFiles, env: CompileEnv): PluginProgram {
  const byTsPath = new Map<string, string>();
  const sources = new Map<string, ts.SourceFile>();
  for (const [path, text] of Object.entries(files)) {
    const tsPath = tsPathOf(path);
    byTsPath.set(tsPath, path);
    sources.set(tsPath, ts.createSourceFile(tsPath, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX));
  }
  const specs = Object.keys(env.modules);
  const modulePath = new Map<string, string>();
  const moduleBySpec = new Map<string, string>();
  specs.forEach((spec, i) => {
    const p = `/modules/m${i}.d.ts`;
    modulePath.set(p, spec);
    moduleBySpec.set(spec, p);
    sources.set(p, ts.createSourceFile(p, env.modules[spec].dts, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS));
  });
  sources.set(LIB_PATH, lib());

  const host: ts.CompilerHost = {
    getSourceFile: (name) => sources.get(name),
    getDefaultLibFileName: () => LIB_PATH,
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => sources.has(f),
    readFile: (f) => sources.get(f)?.text,
    directoryExists: () => true,
    getDirectories: () => [],
    resolveModuleNameLiterals: (literals, containingFile) =>
      literals.map((lit) => {
        const spec = lit.text;
        const fromPlugin = byTsPath.get(containingFile);
        if (fromPlugin !== undefined) {
          const rel = resolveRelative(fromPlugin, spec, files);
          if (rel !== undefined)
            return { resolvedModule: { resolvedFileName: tsPathOf(rel), extension: ts.Extension.Tsx, isExternalLibraryImport: false } };
        }
        const mod = moduleBySpec.get(spec);
        if (mod !== undefined)
          return { resolvedModule: { resolvedFileName: mod, extension: ts.Extension.Dts, isExternalLibraryImport: false } };
        return { resolvedModule: undefined };
      }),
  };

  const roots = [LIB_PATH, ...[...byTsPath.keys()], ...modulePath.keys()];
  const program = ts.createProgram({ rootNames: roots, options: COMPILER_OPTIONS, host });
  const checker = program.getTypeChecker();
  const pluginFiles = new Map<string, ts.SourceFile>();
  for (const [tsPath, path] of byTsPath) {
    const sf = program.getSourceFile(tsPath);
    if (sf) pluginFiles.set(path, sf);
  }
  return {
    program,
    checker,
    files: pluginFiles,
    pluginPathOf: (sf) => byTsPath.get(sf.fileName),
    moduleOf: (sf) => modulePath.get(sf.fileName),
    isLib: (sf) => sf.fileName === LIB_PATH,
  };
}
