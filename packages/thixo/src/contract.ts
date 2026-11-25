// The contract between thixo and whoever uses it: a host page, a tool, a benchmark. Types only.
// The compiler half turns `.thx` source into a JavaScript module. The runtime half runs that module in a page. What
// happens between the compiler and its own runtime (the shape of the emitted code, the guards) is private.

/** A program's files, keyed by path relative to its folder: `main.thx`, `lib/shapes.thx`. */
export type SourceFiles = Record<string, string>;

/** One module a program may import, as the compiler sees it. */
export interface ModuleDecl {
  /** TypeScript declarations for the module's exports, as the text of a `.d.ts` file. */
  dts: string;
}

export interface CompileOptions {
  /** The file whose default export is the program's component. Default `main.thx`. */
  entry?: string;
  /** Modules the host gives the program, by specifier, beside the built-in `thixo`. Anything else is a build error. */
  modules?: Record<string, ModuleDecl>;
}

/** Every module a program may import, built-in and host, as the compiler uses it. */
export interface CompileEnv {
  modules: Record<string, ModuleDecl>;
}

export interface ThixoError {
  file: string;
  line: number;
  column: number;
  /** Stable, such as `thixo/no-global` or `thixo/unknown-import`. */
  code: string;
  /** What is wrong, in a sentence an agent can act on. */
  message: string;
  /** What to write instead, when there is one answer. */
  hint?: string;
}

export type CompileResult =
  | {
      ok: true;
      /** An ES module: `export default function (rt) { ... }`. It has no free identifiers. */
      code: string;
      /** The module specifiers the program imports, sorted. */
      imports: string[];
      /** Every outside address the source writes out as a link (`<a href>`), sorted. */
      links: string[];
      /** sha256, hex, of the source files in canonical order. */
      sourceHash: string;
    }
  | { ok: false; errors: ThixoError[] };

// ---- In the page ----

/** An address a program can pass along and never read or build. Opaque: program code can't see inside one. */
export interface Url {
  readonly __thxUrl: never;
}

/** What the host page gives the runtime. */
export interface RuntimeHost {
  /** The host's `React.createElement`. The runtime calls it only after an element has passed the allowlist. */
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  /** The host's `React.Fragment`. */
  Fragment: unknown;
  /** Host modules by specifier, exactly the modules in `CompileEnv.modules`. Every value in them must already be a
   * language value: made with `hostFunction`, `hostComponent`, `toThx` or `url`. */
  modules: Record<string, Record<string, unknown>>;
  /** Loops and calls a program may run in one entry (a render, an event handler, a resumed await) before it is
   * stopped. Default 5,000,000. */
  budget?: number;
  /** Called when a program is stopped or throws outside a render. */
  onError?(error: Error): void;
  /** Called once for each class `css({...})` makes, with its rules. The host adds them to a stylesheet in the page.
   * The rules only ever select that class, its states and `@media` around it. */
  insertStyle?(className: string, cssText: string): void;
}

/** The handle a host holds on one program's runtime. The compiled code gets a different object, with the guards. */
export interface Runtime {
  /** Wraps a host function so program code can call it. Arguments reach `fn` as plain data (functions as callable
   * wrappers that run under the budget). What `fn` returns goes through `toThx`. A returned promise resolves to a
   * language value. */
  hostFunction<F extends (...args: never[]) => unknown>(fn: F): F;
  /** Marks a host React component as one a program may render. Props reach it as plain data; program functions in
   * props (event handlers) arrive as callable wrappers that run under the budget. */
  hostComponent<C>(component: C): C;
  /** Deep-copies host data into frozen language values: records with nothing behind them, lists, dates, Urls. */
  toThx<T>(value: T): T;
  /** Mints an address. Only the host can. */
  url(address: string): Url;
  isUrl(value: unknown): value is Url;
  /** The address inside a Url. For host components that render one. */
  unwrapUrl(url: Url): string;
  /** Runs compiled code and returns the program's component. */
  instantiate(module: { default: (rt: unknown) => unknown }): ProgramDefinition;
  /** Every rule `css({...})` has made so far, for a host that injects styles in one go (such as on the server). */
  styleSheet(): string;
  /** True once the program ran out of budget or recursed too deep. A stopped runtime refuses to run anything more. */
  readonly stopped: boolean;
}

/** What a compiled program hands back. `component` is a real React component the host can render. */
export interface ProgramDefinition {
  component: (props: Record<string, unknown>) => unknown;
}

export type CreateRuntime = (host: RuntimeHost) => Runtime;
