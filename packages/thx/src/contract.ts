// The contract between the thx package and everything else. Types only.
// The compiler half is used by the registry and the CLI. The runtime half is
// used by the shell's plugin host. What happens between the compiler and its
// own runtime (the shape of the emitted code, the guards) is private to this
// package.

/** A schema type as plain JSON. `thixo/schema`'s `t` builds these; the build reads them from literals (U7). */
export type SchemaJson =
  | { kind: "string" | "number" | "boolean" | "date" | "url" | "unknown" }
  | { kind: "array"; of: SchemaJson }
  | { kind: "object"; fields: Record<string, SchemaJson> }
  | { kind: "optional"; of: SchemaJson }
  | { kind: "record"; name: string };

/** The types a plugin data field can have (D3, D8). */
export type FieldType = "string" | "number" | "boolean" | "date" | "url" | "string[]" | "number[]";

export interface FieldDecl {
  name: string;
  type: FieldType;
}

export interface DataSchema {
  /** Store name to its fields, sorted by name. */
  stores: Record<string, FieldDecl[]>;
  /** Record name to the fields this plugin adds to it, sorted by name. */
  annotations: Record<string, FieldDecl[]>;
}

/** What the build derives for a version (L8). Nobody writes one. */
export interface Manifest {
  slot: string;
  requiredEndpoints: string[];
  optionalEndpoints: string[];
  annotates: string[];
  data: DataSchema;
  /** sha256, hex, of the canonical JSON of `data` (D3). */
  schemaHash: string;
  shellServices: string[];
  /** Every outside address the source names (L7): what it loads and what it links to. */
  addresses: string[];
  /** The outside addresses the source writes out where something loads (`<img src>`). The build copies each one into
   * the app, so the page never fetches it from outside. */
  loads: string[];
  /** The outside addresses the source writes out as links (`<a href>`). */
  links: string[];
  /** Each address in `loads` that the build copied, to the name of the file it stored: `<sha256>.<ext>`. */
  assets: Record<string, string>;
  /** Exposed libraries the plugin imports (L3). */
  libraries: string[];
}

/** A plugin's own description of itself, read from `definePlugin`'s literal second argument (U7). */
export interface PluginMeta {
  /** Present on a default plugin's folder: the PluginId it publishes to. */
  id?: string;
  name: string;
  description: string;
}

/** A plugin's files, keyed by path relative to its folder: `plugin.thx`, `data.thx`, `lib/dates.thx`. */
export type SourceFiles = Record<string, string>;

/** One module a plugin may import, as the compiler sees it. */
export interface ModuleDecl {
  /** TypeScript declarations for the module's exports, as the text of a `.d.ts` file. */
  dts: string;
}

/** Everything about the app the compiler needs. Core builds this from the app definition. */
export interface CompileEnv {
  /** Every importable module by specifier: `thixo/plugin`, `thixo/ui`, `thixo/data`, `thixo/schema`,
   * `thixo/services`, `@app/sdk`, `@app/sdk/optional`, `@app/slots`, and each exposed library. Anything else is a
   * build error (L2). */
  modules: Record<string, ModuleDecl>;
  /** Endpoint export name to what the manifest needs to know. Importing one from `@app/sdk` requires it; from
   * `@app/sdk/optional` makes it optional (P2). */
  endpoints: Record<string, { scopes: string[] }>;
  /** Record export name (as exported from `@app/sdk`, such as `Todo`) to the record. */
  records: Record<string, { name: string; read: string[] }>;
  /** Slot export name (as exported from `@app/slots`, such as `todoDetail`) to the slot's name. */
  slots: Record<string, { name: string }>;
  /** Export names of `thixo/services`: each one imported is a shell service in the manifest (S8). */
  services: string[];
  /** Module specifiers that are exposed libraries (L3), so the manifest can list them. */
  libraries: string[];
  /** The files the build copied: each outside address the source loads, to the stored file's name
   * (`<sha256>.<ext>`). The compiler emits a load of a listed address as the app's copy. An outside load that is not
   * listed compiles, is in the manifest's `loads`, and is refused at run time: the build step copies it and compiles
   * again. The compiler itself never fetches. */
  assets?: Record<string, string>;
}

export interface ThxError {
  file: string;
  line: number;
  column: number;
  /** Stable, such as `thx/no-global` or `thx/unknown-import`. */
  code: string;
  /** What is wrong, in a sentence the authoring agent can act on. */
  message: string;
  /** What to write instead, when there is one answer. */
  hint?: string;
}

export type CompileResult =
  | {
      ok: true;
      /** An ES module: `export default function (rt) { ... }`. It has no free identifiers. */
      code: string;
      manifest: Manifest;
      meta: PluginMeta;
      /** sha256, hex, of the source files in canonical order. */
      sourceHash: string;
    }
  | { ok: false; errors: ThxError[] };

export interface Compiler {
  compile(files: SourceFiles, env: CompileEnv): CompileResult;
  /** Parses emitted code again and fails if it names anything it did not declare. Run before any code is stored or
   * served. It is a second check on the compiler, written apart from it. */
  verifyOutput(code: string): { ok: true } | { ok: false; errors: string[] };
  sourceHash(files: SourceFiles): string;
  schemaHash(data: DataSchema): string;
}

// ---- In the page ----

/** An address a plugin can pass along and never read or build (L7). Opaque: plugin code can't see inside one. */
export interface Url {
  readonly __thxUrl: never;
}

/** What the shell's plugin host gives the runtime. */
export interface RuntimeHost {
  /** The host's `React.createElement`. The runtime calls it only after an element has passed the allowlist. */
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  /** The host's `React.Fragment`. */
  Fragment: unknown;
  /** Host modules by specifier, exactly the modules in `CompileEnv.modules`. Every value in them must already be a
   * language value: made with `hostFunction`, `hostComponent`, `toThx` or `url`. */
  modules: Record<string, Record<string, unknown>>;
  /** Loops and calls a plugin may run in one entry (a render, an event handler, a resumed await) before it is
   * stopped. Default 5,000,000. */
  budget?: number;
  /** Where one of the plugin version's copied files is served on the app, from its name (`<sha256>.<ext>`). It
   * must return a path on the app. Left out, a plugin that loads a copied file stops when it renders it. */
  assetAddress?(file: string): string;
  /** Called when a plugin is stopped or throws outside a render. */
  onError?(error: Error): void;
  /** Called once for each class `css({...})` makes, with its rules. The host adds them to a stylesheet in the page.
   * The rules only ever select that class, its states and `@media` around it. */
  insertStyle?(className: string, cssText: string): void;
}

/** The handle a host holds on one plugin's runtime. The compiled code gets a different object, with the guards. */
export interface Runtime {
  /** Wraps a host function so plugin code can call it. Arguments reach `fn` as plain data (functions as callable
   * wrappers that run under the budget). What `fn` returns goes through `toThx`. A returned promise resolves to a
   * language value. */
  hostFunction<F extends (...args: never[]) => unknown>(fn: F): F;
  /** Marks a host React component as one a plugin may render. Props reach it as plain data; plugin functions in
   * props (event handlers) arrive as callable wrappers that run under the budget. */
  hostComponent<C>(component: C): C;
  /** Deep-copies host data into frozen language values: records with nothing behind them, lists, dates, Urls. */
  toThx<T>(value: T): T;
  /** Mints an address. Only the host can. */
  url(address: string): Url;
  isUrl(value: unknown): value is Url;
  /** The address inside a Url. For host components that render one. */
  unwrapUrl(url: Url): string;
  /** Runs compiled code and returns what its `definePlugin` call returned. */
  instantiate(module: { default: (rt: unknown) => unknown }): PluginDefinition;
  /** Every rule `css({...})` has made so far, for a host that injects styles in one go (such as on the server). */
  styleSheet(): string;
  /** True once the plugin ran out of budget or recursed too deep. A stopped runtime refuses to run anything more. */
  readonly stopped: boolean;
}

/** What `definePlugin` hands back. `component` is a real React component the host can render. */
export interface PluginDefinition {
  slot: string;
  meta: PluginMeta;
  component: (props: Record<string, unknown>) => unknown;
}

export type CreateRuntime = (host: RuntimeHost) => Runtime;
