// TypeScript's own verdict on programs, with the language's lib and the same host modules, for comparing thixo's
// type check against. A test-only dependency: `@thixo/core` itself never loads TypeScript.

import ts from "typescript-js-api";
import { LIB_THX_DTS, THIXO_DTS } from "../../src/index.js";

const OPTIONS: ts.CompilerOptions = {
  noLib: true,
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  types: [],
  allowUnreachableCode: true,
  moduleDetection: ts.ModuleDetectionKind.Force,
};

/** Type-checks many single-file programs in one TypeScript program. Returns each program's diagnostics. */
export function tsDiagnostics(programs: string[], modules: Record<string, string>): string[][] {
  const mods: Record<string, string> = { thixo: THIXO_DTS, ...modules };
  const specs = Object.keys(mods);
  const sources = new Map<string, ts.SourceFile>();
  sources.set("/lib.d.ts", ts.createSourceFile("/lib.d.ts", LIB_THX_DTS, ts.ScriptTarget.ES2022, true));
  specs.forEach((s, i) => sources.set(`/m/m${i}.d.ts`, ts.createSourceFile(`/m/m${i}.d.ts`, mods[s], ts.ScriptTarget.ES2022, true)));
  const names = programs.map((_, i) => `/src/p${i}.tsx`);
  programs.forEach((text, i) =>
    sources.set(
      names[i],
      ts.createSourceFile(names[i], text, { languageVersion: ts.ScriptTarget.ES2022, setExternalModuleIndicator: (sf) => ((sf as unknown as { externalModuleIndicator: unknown }).externalModuleIndicator = true) }, true, ts.ScriptKind.TSX),
    ),
  );
  const host: ts.CompilerHost = {
    getSourceFile: (n) => sources.get(n),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => sources.has(f),
    readFile: (f) => sources.get(f)?.text,
    directoryExists: () => true,
    getDirectories: () => [],
    resolveModuleNameLiterals: (lits) =>
      lits.map((l) => {
        const i = specs.indexOf(l.text);
        return { resolvedModule: i >= 0 ? { resolvedFileName: `/m/m${i}.d.ts`, extension: ts.Extension.Dts, isExternalLibraryImport: false } : undefined };
      }),
  };
  const program = ts.createProgram({ rootNames: [...sources.keys()], options: OPTIONS, host });
  return names.map((n) => {
    const sf = program.getSourceFile(n)!;
    return [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)].map((d) => {
      const pos = d.start === undefined ? "" : `${sf.getLineAndCharacterOfPosition(d.start).line + 1}:${sf.getLineAndCharacterOfPosition(d.start).character + 1} `;
      return `${pos}TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
    });
  });
}

/** TypeScript's diagnostics for the lib and the given declarations themselves. */
export function tsLibDiagnostics(modules: Record<string, string>): string[] {
  const mods: Record<string, string> = { thixo: THIXO_DTS, ...modules };
  const sources = new Map<string, ts.SourceFile>();
  sources.set("/lib.d.ts", ts.createSourceFile("/lib.d.ts", LIB_THX_DTS, ts.ScriptTarget.ES2022, true));
  Object.values(mods).forEach((text, i) => sources.set(`/m/m${i}.d.ts`, ts.createSourceFile(`/m/m${i}.d.ts`, text, ts.ScriptTarget.ES2022, true)));
  const host: ts.CompilerHost = {
    getSourceFile: (n) => sources.get(n),
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => sources.has(f),
    readFile: (f) => sources.get(f)?.text,
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram({ rootNames: [...sources.keys()], options: OPTIONS, host });
  return [...program.getGlobalDiagnostics(), ...program.getSemanticDiagnostics()].map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}
