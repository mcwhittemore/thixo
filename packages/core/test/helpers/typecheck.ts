import ts from "thixo-thx/ts-api";

/** Stand-in for thx's own library: the globals the plugin-facing declarations may use, and the bare minimum of
 * built-ins that `noLib` demands. */
export const STAND_IN_LIB = `
interface Array<T> { length: number; [n: number]: T; map<U>(fn: (value: T, index: number) => U): U[]; find(fn: (value: T) => boolean): T | undefined; filter(fn: (value: T) => boolean): T[]; }
interface Boolean {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface Number {}
interface Object {}
interface RegExp {}
interface String { length: number }
interface Date { getTime(): number }
declare var Date: { now(): number };
declare var Math: { ceil(n: number): number };
interface SymbolConstructor { readonly iterator: unique symbol }
declare var Symbol: SymbolConstructor;
interface IteratorResult<T> { done?: boolean; value: T }
interface Iterator<T> { next(): IteratorResult<T> }
interface IterableIterator<T> extends Iterator<T> { [Symbol.iterator](): IterableIterator<T> }
interface Array<T> { [Symbol.iterator](): IterableIterator<T> }
interface Promise<T> { then<R>(onfulfilled: (value: T) => R | Promise<R>): Promise<R> }
interface Map<K, V> { get(key: K): V | undefined; has(key: K): boolean; readonly size: number }
interface Url { readonly __thxUrl: never }
type ThxNode = string | number | boolean | null | undefined | JSX.Element | ThxNode[];
type Component<P> = (props: P) => JSX.Element | null;
declare namespace JSX {
  interface Element { readonly __element: true }
  interface IntrinsicElements { [tag: string]: any }
  interface IntrinsicAttributes { key?: string | number }
  interface ElementChildrenAttribute { children: {} }
}
`;

export interface CheckInput {
  /** Module specifier to declaration text. */
  modules: Record<string, string>;
  /** File path (such as /plugin/plugin.tsx) to source. Relative imports resolve among these. */
  files: Record<string, string>;
}

export function typecheck({ modules, files }: CheckInput): string[] {
  const all: Record<string, string> = { "/lib.d.ts": STAND_IN_LIB, ...files };
  for (const [specifier, text] of Object.entries(modules)) all[`/modules/${specifier}.d.ts`] = text;

  const options: ts.CompilerOptions = {
    noLib: true,
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.Preserve,
    types: [],
    skipLibCheck: false,
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name, languageVersion) =>
    name in all ? ts.createSourceFile(name, all[name], languageVersion, true) : undefined;
  host.fileExists = (name) => name in all;
  host.readFile = (name) => all[name];
  host.resolveModuleNames = (names, importer) =>
    names.map((name) => {
      const base = name.startsWith(".") ? new URL(name, `file://${importer}`).pathname : undefined;
      const candidates = base ? [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`] : [`/modules/${name}.d.ts`];
      const hit = candidates.find((c) => c in all);
      return hit ? { resolvedFileName: hit, extension: hit.endsWith(".d.ts") ? ts.Extension.Dts : hit.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts } : undefined;
    });

  const roots = Object.keys(all).filter((name) => !name.startsWith("/modules/") || true);
  const program = ts.createProgram(roots, options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1} ` : "";
    return where + ts.flattenDiagnosticMessageText(d.messageText, "\n");
  });
}
