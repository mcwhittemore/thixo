// The language's own lib. The type check runs with `noLib`, so these are the only globals that exist. Each built-in
// has only the methods the runtime's method tables implement. `Symbol` and `RegExp` are declared because the
// checker needs them for iteration, and the compiler refuses them as values.

import { attrsOf, elementTags, STYLE_PROPS, TOKEN_VALUES, type AttrKind } from "../runtime/allowlist.js";

const CORE = `
interface Object {}
interface Function {}
interface CallableFunction {}
interface NewableFunction {}
interface IArguments { readonly length: number; readonly [index: number]: unknown; }
interface RegExp {}
interface Symbol {}
interface SymbolConstructor { readonly iterator: unique symbol; }
declare var Symbol: SymbolConstructor;
interface TemplateStringsArray extends ReadonlyArray<string> { readonly raw: readonly string[]; }

interface IteratorYieldResult<T> { done?: false; value: T; }
interface IteratorReturnResult<T> { done: true; value: T; }
type IteratorResult<T, TReturn = undefined> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterator<T, TReturn = undefined, TNext = undefined> { next(...args: [] | [TNext]): IteratorResult<T, TReturn>; }
interface Iterable<T, TReturn = undefined, TNext = undefined> { [Symbol.iterator](): Iterator<T, TReturn, TNext>; }
interface IterableIterator<T, TReturn = undefined, TNext = undefined> extends Iterator<T, TReturn, TNext> {
  [Symbol.iterator](): IterableIterator<T, TReturn, TNext>;
}
interface IteratorObject<T, TReturn = undefined, TNext = undefined> extends Iterator<T, TReturn, TNext> {
  [Symbol.iterator](): IteratorObject<T, TReturn, TNext>;
}
type BuiltinIteratorReturn = undefined;
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T; }
type PropertyKey = string | number;

type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Record<K extends string | number, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends string | number> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T & {};
type Parameters<T extends (...args: never) => unknown> = T extends (...args: infer P) => unknown ? P : never;
type ReturnType<T extends (...args: never) => unknown> = T extends (...args: never) => infer R ? R : never;
type Awaited<T> = T extends null | undefined
  ? T
  : T extends object & { then(onfulfilled: infer F, ...args: infer _): unknown }
    ? F extends (value: infer V, ...args: infer _) => unknown
      ? Awaited<V>
      : never
    : T;

interface Boolean { toString(): string; }
declare var Boolean: (value?: unknown) => boolean;

interface Number {
  toFixed(digits?: number): string;
  toPrecision(precision?: number): string;
  toString(radix?: number): string;
  toLocaleString(): string;
}
interface NumberConstructor {
  (value?: unknown): number;
  isFinite(n: unknown): boolean;
  isInteger(n: unknown): boolean;
  isNaN(n: unknown): boolean;
  parseFloat(s: string): number;
  parseInt(s: string, radix?: number): number;
  readonly MAX_SAFE_INTEGER: number;
  readonly MIN_SAFE_INTEGER: number;
  readonly EPSILON: number;
}
declare var Number: NumberConstructor;
declare var NaN: number;
declare var Infinity: number;
declare function parseInt(s: string, radix?: number): number;
declare function parseFloat(s: string): number;
declare function isNaN(n: number): boolean;
declare function isFinite(n: number): boolean;

interface String {
  readonly length: number;
  readonly [index: number]: string;
  [Symbol.iterator](): IterableIterator<string>;
  at(index: number): string | undefined;
  charAt(index: number): string;
  charCodeAt(index: number): number;
  codePointAt(index: number): number | undefined;
  concat(...parts: string[]): string;
  endsWith(search: string, end?: number): boolean;
  includes(search: string, from?: number): boolean;
  indexOf(search: string, from?: number): number;
  lastIndexOf(search: string, from?: number): number;
  localeCompare(other: string): number;
  normalize(form?: "NFC" | "NFD" | "NFKC" | "NFKD"): string;
  padEnd(length: number, fill?: string): string;
  padStart(length: number, fill?: string): string;
  repeat(count: number): string;
  replace(search: string, replacement: string): string;
  replaceAll(search: string, replacement: string): string;
  slice(start?: number, end?: number): string;
  split(separator: string, limit?: number): string[];
  startsWith(search: string, from?: number): boolean;
  substring(start: number, end?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  toString(): string;
}
declare var String: (value?: unknown) => string;

interface ReadonlyArray<T> {
  readonly length: number;
  readonly [n: number]: T;
  [Symbol.iterator](): IterableIterator<T>;
  at(index: number): T | undefined;
  concat(...items: (T | readonly T[])[]): T[];
  every(predicate: (value: T, index: number) => unknown): boolean;
  filter<S extends T>(predicate: (value: T, index: number) => value is S): S[];
  filter(predicate: (value: T, index: number) => unknown): T[];
  find<S extends T>(predicate: (value: T, index: number) => value is S): S | undefined;
  find(predicate: (value: T, index: number) => unknown): T | undefined;
  findIndex(predicate: (value: T, index: number) => unknown): number;
  findLast(predicate: (value: T, index: number) => unknown): T | undefined;
  findLastIndex(predicate: (value: T, index: number) => unknown): number;
  flat<U>(this: readonly (U | readonly U[])[]): U[];
  flatMap<U>(fn: (value: T, index: number) => U | readonly U[]): U[];
  forEach(fn: (value: T, index: number) => void): void;
  includes(value: T, from?: number): boolean;
  indexOf(value: T, from?: number): number;
  lastIndexOf(value: T, from?: number): number;
  join(separator?: string): string;
  map<U>(fn: (value: T, index: number) => U): U[];
  reduce(fn: (acc: T, value: T, index: number) => T): T;
  reduce<U>(fn: (acc: U, value: T, index: number) => U, initial: U): U;
  reduceRight(fn: (acc: T, value: T, index: number) => T): T;
  reduceRight<U>(fn: (acc: U, value: T, index: number) => U, initial: U): U;
  slice(start?: number, end?: number): T[];
  some(predicate: (value: T, index: number) => unknown): boolean;
  toSorted(compare?: (a: T, b: T) => number): T[];
  toReversed(): T[];
  toSpliced(start: number, deleteCount?: number, ...items: T[]): T[];
  with(index: number, value: T): T[];
}
interface Array<T> extends ReadonlyArray<T> {
  [n: number]: T;
  length: number;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  sort(compare?: (a: T, b: T) => number): this;
  reverse(): T[];
}
interface ArrayConstructor {
  isArray(value: unknown): value is unknown[];
  from<T>(items: Iterable<T> | ArrayLike<T>): T[];
  from<T, U>(items: Iterable<T> | ArrayLike<T>, fn: (value: T, index: number) => U): U[];
}
declare var Array: ArrayConstructor;

interface ObjectConstructor {
  keys(o: object): string[];
  values<T>(o: { readonly [key: string]: T } | ArrayLike<T>): T[];
  entries<T>(o: { readonly [key: string]: T } | ArrayLike<T>): [string, T][];
  fromEntries<T>(entries: Iterable<readonly [string | number, T]>): { [key: string]: T };
}
declare var Object: ObjectConstructor;

interface ReadonlyMap<K, V> {
  readonly size: number;
  [Symbol.iterator](): IterableIterator<[K, V]>;
  get(key: K): V | undefined;
  has(key: K): boolean;
  forEach(fn: (value: V, key: K) => void): void;
  keys(): K[];
  values(): V[];
  entries(): [K, V][];
}
interface Map<K, V> extends ReadonlyMap<K, V> {
  set(key: K, value: V): this;
  delete(key: K): boolean;
  clear(): void;
}
interface MapConstructor {
  new <K, V>(entries?: Iterable<readonly [K, V]> | null): Map<K, V>;
}
declare var Map: MapConstructor;

interface ReadonlySet<T> {
  readonly size: number;
  [Symbol.iterator](): IterableIterator<T>;
  has(value: T): boolean;
  forEach(fn: (value: T) => void): void;
  values(): T[];
}
interface Set<T> extends ReadonlySet<T> {
  add(value: T): this;
  delete(value: T): boolean;
  clear(): void;
}
interface SetConstructor {
  new <T>(values?: Iterable<T> | null): Set<T>;
}
declare var Set: SetConstructor;

interface Date {
  getTime(): number;
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getDay(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
  getMilliseconds(): number;
  getUTCFullYear(): number;
  getUTCMonth(): number;
  getUTCDate(): number;
  getUTCDay(): number;
  getUTCHours(): number;
  getUTCMinutes(): number;
  getUTCSeconds(): number;
  getUTCMilliseconds(): number;
  getTimezoneOffset(): number;
  toISOString(): string;
  toJSON(): string;
  toDateString(): string;
  toTimeString(): string;
  toLocaleDateString(locale?: string): string;
  toLocaleTimeString(locale?: string): string;
  toLocaleString(locale?: string): string;
  toString(): string;
}
interface DateConstructor {
  new (): Date;
  new (value: number | string | Date): Date;
  new (year: number, month: number, day?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): Date;
  now(): number;
  parse(text: string): number;
  UTC(year: number, month?: number, day?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
}
declare var Date: DateConstructor;

interface Math {
  readonly E: number;
  readonly LN2: number;
  readonly LN10: number;
  readonly LOG2E: number;
  readonly LOG10E: number;
  readonly PI: number;
  readonly SQRT1_2: number;
  readonly SQRT2: number;
  abs(x: number): number;
  acos(x: number): number;
  asin(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  cbrt(x: number): number;
  ceil(x: number): number;
  cos(x: number): number;
  exp(x: number): number;
  floor(x: number): number;
  hypot(...values: number[]): number;
  log(x: number): number;
  log10(x: number): number;
  log2(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  random(): number;
  round(x: number): number;
  sign(x: number): number;
  sin(x: number): number;
  sqrt(x: number): number;
  tan(x: number): number;
  trunc(x: number): number;
}
declare var Math: Math;

interface JSON {
  parse(text: string): unknown;
  stringify(value: unknown, replacer?: null, space?: number | string): string;
}
declare var JSON: JSON;

interface PromiseLike<T> {
  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2>;
}
interface Promise<T> {
  then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2>;
  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<T | R>;
  finally(onfinally?: (() => void) | null): Promise<T>;
}
interface PromiseConstructor {
  all<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
  resolve(): Promise<void>;
  resolve<T>(value: T): Promise<Awaited<T>>;
}
declare var Promise: PromiseConstructor;

interface Error { readonly name: string; readonly message: string; }
interface ErrorConstructor {
  new (message?: string): Error;
  (message?: string): Error;
}
declare var Error: ErrorConstructor;

/** An address the program was handed or wrote out in its source. It can be passed along, never read or built. */
interface Url { readonly __thxUrl: never; }
/** Anything a component may return or take as children. */
type ThxNode = JSX.Element | string | number | boolean | null | undefined | readonly ThxNode[];
/** A component: a function from props to what it renders. */
type Component<P = {}> = (props: P) => ThxNode;
/** What an event handler on a raw element receives. Never the event itself. */
interface ThxEvent {
  /** The element's value: an input's text, a select's choice. Empty when it has none. */
  readonly value: string;
  readonly checked: boolean;
  /** The key pressed, for key events. */
  readonly key: string;
  /** The pointer's position inside the element, for pointer and mouse events. */
  readonly x: number;
  readonly y: number;
}
type ThxHandler = (event: ThxEvent) => void | Promise<void>;
`;

function styleDts(): string {
  const props = [...STYLE_PROPS].map((p) => `  ${p}?: string | number | Url;`).join("\n");
  return `/** A style object: the style prop and css() take these. */
interface ThxStyle {
${props}
}
/** A css() object: a style, with states such as ":hover" and "@media (...)" queries nested inside. */
type ThxCss = ThxStyle & { [state: \`:\${string}\`]: ThxStyle } & { [media: \`@media \${string}\`]: ThxStyle };
`;
}

function attrType(tag: string, name: string, kind: AttrKind): string {
  const tokens = TOKEN_VALUES[tag]?.[name] ?? TOKEN_VALUES["*"]?.[name];
  switch (kind) {
    case "text":
      return "string | number";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "token":
      return tokens ? tokens.map((t) => JSON.stringify(t)).join(" | ") : "string";
    case "link":
      return "Url | `https://${string}`";
    case "load":
      return "Url | `data:${string}` | `https://${string}`";
    case "event":
      return "ThxHandler";
    case "style":
      return "ThxStyle";
    case "class":
      return "string";
    case "key":
      return "string | number";
    case "svg":
      return "string | number";
  }
}

function jsxDts(): string {
  const elements = elementTags()
    .map((tag) => {
      const attrs = attrsOf(tag);
      const lines = Object.entries(attrs)
        .filter(([name]) => name !== "key")
        .map(([name, kind]) => `      ${name}?: ${attrType(tag, name, kind)};`);
      lines.push("      key?: string | number;");
      return `    ${tag}: {\n${lines.join("\n")}\n      children?: ThxNode;\n      [aria: \`aria-\${string}\`]: string | number | boolean | undefined;\n      [data: \`data-\${string}\`]: string | number | boolean | undefined;\n    };`;
    })
    .join("\n");
  return `declare namespace JSX {
  interface Element { readonly __thxElement: never; }
  type ElementType = string | ((props: never) => ThxNode);
  interface ElementChildrenAttribute { children: {}; }
  interface IntrinsicAttributes { key?: string | number; }
  interface IntrinsicElements {
${elements}
  }
}
`;
}

/** The text of the language's lib, as a `.d.ts` file. */
export const LIB_THX_DTS: string = `${CORE}\n${styleDts()}\n${jsxDts()}`;

/** Globals program code may name. Everything else the lib declares exists only for the checker. */
export const BUILTIN_GLOBALS: ReadonlySet<string> = new Set([
  "Math",
  "JSON",
  "Date",
  "Map",
  "Set",
  "Promise",
  "Object",
  "Array",
  "Number",
  "String",
  "Boolean",
  "Error",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "NaN",
  "Infinity",
]);

/** Built-ins `new` may be used on. */
export const CONSTRUCTIBLE: ReadonlySet<string> = new Set(["Date", "Map", "Set", "Error"]);
