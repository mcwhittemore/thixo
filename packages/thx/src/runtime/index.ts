// The in-page runtime: the guards compiled plugin code calls for every field read, call, element and loop, and the
// handle the host holds. Browser-safe: no imports at run time but the allowlist, no Node APIs, no React.
//
// How values are represented:
// - A record is a null-prototype object made here (plugin literals, toThx copies, JSON.parse). Reads see own data
//   fields only. A record handed in, or passed out to the host, is frozen.
// - A list is a real array. Reads see `length`, indexes and the language's methods.
// - Strings, numbers, booleans, Dates, Maps, Sets and promises have the language's method tables and nothing else.
// - Functions, elements, Urls and anything else have no fields at all.

import type { CreateRuntime, PluginDefinition, PluginMeta, Runtime, RuntimeHost, Url } from "../contract.js";
import {
  ASSET_FILE,
  attrKind,
  isElementAllowed,
  MEDIA_RE,
  POSITION_VALUES,
  STYLE_FUNCTIONS,
  STYLE_LENGTH,
  STYLE_PROPS,
  STYLE_STATES,
  STYLE_UNITLESS,
  STYLE_URL_PROPS,
  STYLE_VALUE_RE,
  TOKEN_VALUES,
} from "./allowlist.js";

const apply = Reflect.apply;
const create = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const isFrozen = Object.isFrozen;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectKeys = Object.keys;
const isArray = Array.isArray;
const ObjectProto = Object.prototype;
const NativePromise = Promise;
const promiseThen = Promise.prototype.then;
const promiseFinally = Promise.prototype.finally;
const promiseResolve = Promise.resolve.bind(Promise);
const promiseAll = Promise.all.bind(Promise);
const NativeDate = Date;
const NativeMap = Map;
const NativeSet = Set;
const NativeError = Error;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;

/** Thrown when a plugin runs out of budget or recurses too deep. Plugin code can't catch it. */
class ThxStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThxStop";
  }
}

const DEFAULT_BUDGET = 5_000_000;
const MAX_DEPTH = 400;
const MAX_BUILT = 10_000_000;

let runtimeCount = 0;

type Impl = (self: never, args: unknown[]) => unknown;

interface Ctx {
  ticks: number;
  resumes: number;
}

interface UrlInfo {
  address: string;
  /** True when the compiler wrote it from the source (`rt.addr`, `rt.asset`), false when the host handed it in. */
  written: boolean;
}

function isPrimitive(v: unknown): v is string | number | boolean | null | undefined {
  return v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function isIndexKey(key: string): boolean {
  return /^(0|[1-9][0-9]{0,9})$/.test(key) && Number(key) < 4294967295;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function cssString(text: string): string {
  return `"${text.replace(/["\\\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/** Which addresses each kind of attribute may hold. `written` is true for a `Url` the compiler wrote from the
 * source, false for one the host handed in.
 *
 * - A load (`<img src>`, a style's `url()`) fires with no click. One written in the source is never an outside
 *   address: the build copied it into the app (`rt.asset`), so the page never fetches from a host because of what a
 *   plugin's author wrote. One the app handed in may be on any http or https host: the plugin did not make it.
 * - A link waits for a click. One written in the source is any https address; one handed in is http, https or
 *   mailto.
 * - Nothing runs: `javascript:` and every other scheme are refused, as is a `data:` address that is not an image or a
 *   font. */
function addressAllowed(address: string, kind: "link" | "load" | "any", written: boolean): boolean {
  if (/[\u0000-\u001f\u007f\s]/.test(address)) return false;
  if (address.startsWith("/") && !address.startsWith("//")) return true;
  if (/^https?:\/\/[^/]/i.test(address)) {
    if (!written) return true;
    if (kind === "load") return false;
    return /^https:/i.test(address);
  }
  if (kind !== "load" && /^mailto:/i.test(address)) return !written;
  if (kind !== "link" && /^data:(image\/(png|jpeg|gif|webp|avif|svg\+xml)|font\/(woff2?|ttf|otf))[;,]/i.test(address)) return true;
  return false;
}

export const createRuntime: CreateRuntime = (host: RuntimeHost): Runtime => {
  const id = ++runtimeCount;
  const budget = host.budget ?? DEFAULT_BUDGET;
  const maxResumes = Math.max(1000, Math.floor(budget / 50));

  const records = new WeakSet<object>();
  const errorRecords = new WeakSet<object>();
  const knownArrays = new WeakSet<object>();
  const dates = new WeakSet<object>();
  const maps = new WeakSet<object>();
  const sets = new WeakSet<object>();
  const frozenColls = new WeakSet<object>();
  const urls = new WeakMap<object, UrlInfo>();
  const pluginFns = new WeakSet<object>();
  const builtinFns = new WeakSet<object>();
  const hostFns = new WeakMap<object, Function>();
  const hostFnFor = new WeakMap<Function, Function>();
  const hostComponents = new WeakSet<object>();
  const elements = new WeakSet<object>();
  const spreads = new WeakSet<object>();
  const nsTokens = new WeakMap<object, Ns>();
  const definitions = new WeakSet<object>();
  /** Host object to its language copy, and back. */
  const thxCopyOf = new WeakMap<object, unknown>();
  const hostOriginOf = new WeakMap<object, unknown>();
  /** Plugin value to the copy the host was given, and back. */
  const hostCopyOf = new WeakMap<object, unknown>();
  const pluginOriginOf = new WeakMap<object, unknown>();
  const componentFor = new WeakMap<Function, Function>();
  const styleRules = new Map<string, string>();

  let cur: Ctx = { ticks: 0, resumes: 0 };
  let depth = 0;
  let active = 0;
  let rendering = 0;
  let dead: ThxStop | undefined;
  const SHORT = freeze(create(null));

  // ---- stopping ----

  function report(e: unknown): void {
    if (e instanceof ThxStop && e !== dead) return;
    try {
      host.onError?.(e instanceof NativeError ? e : new NativeError(describeError(e)));
    } catch {
      // The host's own handler failed; nothing more to do.
    }
  }

  function stop(reason: string): never {
    if (!dead) {
      dead = new ThxStop(reason);
      report(dead);
    }
    throw dead;
  }

  function alive(): void {
    if (dead) throw dead;
  }

  function newCtx(): Ctx {
    return { ticks: 0, resumes: 0 };
  }

  /** Runs plugin code the host called: a render, a handler, a callback. A new count starts unless plugin code is
   * already on the stack. */
  function enter(fn: Function, args: unknown[]): unknown {
    alive();
    const savedCur = cur;
    const savedDepth = depth;
    if (active === 0) cur = newCtx();
    active++;
    try {
      const result = apply(fn, undefined, args);
      alive();
      return result;
    } finally {
      active--;
      depth = savedDepth;
      cur = savedCur;
    }
  }

  /** Runs a plugin callback after an await or a promise settles. It counts against the context that waited. */
  function resume(k: Ctx, fn: unknown, args: unknown[]): unknown {
    alive();
    cur = k;
    k.ticks = 0;
    if (++k.resumes > maxResumes) stop(`The plugin awaited more than ${maxResumes} times in one go and was stopped.`);
    depth = 0;
    active++;
    try {
      return callValue(fn, args);
    } finally {
      active--;
    }
  }

  // ---- describing ----

  function kindOf(v: unknown): string {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return t;
    if (t !== "object" && t !== "function") return "opaque";
    const o = v as object;
    if (isArray(o)) return "list";
    if (records.has(o)) return "record";
    if (urls.has(o)) return "url";
    if (dates.has(o)) return "date";
    if (maps.has(o)) return "map";
    if (sets.has(o)) return "set";
    if (nsTokens.has(o)) return "builtin";
    if (o instanceof NativePromise) return "promise";
    if (elements.has(o)) return "element";
    if (t === "function") return "function";
    return "opaque";
  }

  function describe(v: unknown): string {
    const k = kindOf(v);
    const names: Record<string, string> = {
      list: "a list",
      record: "a record",
      url: "a Url",
      date: "a Date",
      map: "a Map",
      set: "a Set",
      builtin: "a built-in",
      promise: "a promise",
      element: "an element",
      function: "a function",
      opaque: "a value from outside the language",
      string: "a string",
      number: "a number",
      boolean: "a boolean",
    };
    return names[k] ?? k;
  }

  function describeError(e: unknown): string {
    if (typeof e === "object" && e !== null && records.has(e)) {
      const m = getOwnPropertyDescriptor(e, "message");
      return m && typeof m.value === "string" ? m.value : "The plugin threw a record.";
    }
    if (isPrimitive(e)) return `The plugin threw ${String(e)}.`;
    return "The plugin threw a value.";
  }

  function fail(message: string): never {
    throw new TypeError(message);
  }

  // ---- keys and fields ----

  function normKey(k: unknown): string {
    if (typeof k === "string") return k;
    if (typeof k === "number") return String(k);
    return fail(`A field name is a string or a number, not ${describe(k)}.`);
  }

  function checkWritableKey(key: string): void {
    if (key === "__proto__") fail("`__proto__` is not a field name in the language.");
  }

  function ownData(o: object, key: string): unknown {
    const d = getOwnPropertyDescriptor(o, key);
    return d && "value" in d ? d.value : undefined;
  }

  function makeRecord(): Record<string, unknown> {
    const o = create(null) as Record<string, unknown>;
    records.add(o);
    return o;
  }

  function setField(o: object, key: string, value: unknown): void {
    checkWritableKey(key);
    defineProperty(o, key, { value, writable: true, enumerable: true, configurable: true });
  }

  function recordFrom(entries: [string, unknown][]): Record<string, unknown> {
    const o = makeRecord();
    for (const [k, v] of entries) setField(o, k, v);
    return o;
  }

  // ---- calling ----

  function isCallable(f: unknown): boolean {
    if (typeof f !== "function" && (typeof f !== "object" || f === null)) return false;
    const o = f as object;
    return pluginFns.has(o) || hostFns.has(o) || builtinFns.has(o) || (nsTokens.has(o) && !!nsTokens.get(o)!.call);
  }

  function callValue(f: unknown, args: unknown[]): unknown {
    if (typeof f === "function" && (pluginFns.has(f) || hostFns.has(f) || builtinFns.has(f))) return apply(f, undefined, args);
    if (typeof f === "object" && f !== null && nsTokens.has(f)) {
      const ns = nsTokens.get(f)!;
      if (ns.call) return ns.call(args);
    }
    return fail(`${describe(f)} is not a function.`);
  }

  function spreadArgs(args: unknown[]): unknown[] {
    const out: unknown[] = [];
    for (const a of args) {
      if (typeof a === "object" && a !== null && spreads.has(a)) out.push(...toList((a as { v: unknown }).v, "spread"));
      else out.push(a);
    }
    return out;
  }

  function builtin<F extends Function>(f: F): F {
    builtinFns.add(f);
    return f;
  }

  /** Wraps a plugin callback for a built-in method: it gets exactly the arguments the language promises. */
  function cb(f: unknown, what: string): (...a: unknown[]) => unknown {
    if (!isCallable(f)) fail(`${what} takes a function, not ${describe(f)}.`);
    return (...a: unknown[]) => callValue(f, a);
  }

  function prim(v: unknown, what: string): string | number | boolean | null | undefined {
    if (!isPrimitive(v)) fail(`${what} takes plain values, not ${describe(v)}.`);
    return v;
  }

  function strArg(v: unknown, what: string, optional = false): string | undefined {
    if (v === undefined && optional) return undefined;
    if (typeof v !== "string") fail(`${what} takes a string, not ${describe(v)}.`);
    return v;
  }

  function numArg(v: unknown, what: string, optional = false): number | undefined {
    if (v === undefined && optional) return undefined;
    if (typeof v !== "number") fail(`${what} takes a number, not ${describe(v)}.`);
    return v;
  }

  // ---- lists and iteration ----

  function toList(v: unknown, what: string): unknown[] {
    if (isArray(v)) return v;
    if (typeof v === "string") return Array.from(v);
    if (typeof v === "object" && v !== null) {
      if (maps.has(v)) return Array.from(v as Map<unknown, unknown>, ([k, val]) => [k, val]);
      if (sets.has(v)) return Array.from(v as Set<unknown>);
    }
    return fail(`Only lists, strings, Maps and Sets can be used in a ${what}, not ${describe(v)}.`);
  }

  function checkMutableList(o: unknown[], method: string): void {
    if (isFrozen(o)) fail(`This list can't be changed with ${method}: it was handed to the plugin or passed to the app. Make a new one, such as [...list, item] or list.toSorted().`);
  }

  function checkMutableColl(o: object, method: string): void {
    if (frozenColls.has(o)) fail(`This ${maps.has(o) ? "Map" : "Set"} can't be changed with ${method}: it was handed to the plugin or passed to the app. Make a new one.`);
  }

  function cappedLength(n: number): number {
    if (n > MAX_BUILT) fail(`That would build a value of ${n} items or characters, more than the language allows.`);
    return n;
  }

  function defaultCompare(a: unknown, b: unknown): number {
    if (a === undefined) return b === undefined ? 0 : 1;
    if (b === undefined) return -1;
    const x = toText(a);
    const y = toText(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function comparator(f: unknown): (a: unknown, b: unknown) => number {
    if (f === undefined) return defaultCompare;
    const call = cb(f, "sort");
    return (a, b) => {
      const r = call(a, b);
      return typeof r === "number" && r === r ? r : 0;
    };
  }

  // ---- method tables ----

  const STRING = new Map<string, Impl>(
    Object.entries({
      at: (s: string, [i]: unknown[]) => s.at(numArg(i, "at")!),
      charAt: (s: string, [i]: unknown[]) => s.charAt(numArg(i, "charAt")!),
      charCodeAt: (s: string, [i]: unknown[]) => s.charCodeAt(numArg(i, "charCodeAt")!),
      codePointAt: (s: string, [i]: unknown[]) => s.codePointAt(numArg(i, "codePointAt")!),
      concat: (s: string, a: unknown[]) => s.concat(...a.map((x) => strArg(x, "concat")!)),
      endsWith: (s: string, [x, n]: unknown[]) => s.endsWith(strArg(x, "endsWith")!, numArg(n, "endsWith", true)),
      includes: (s: string, [x, n]: unknown[]) => s.includes(strArg(x, "includes")!, numArg(n, "includes", true)),
      indexOf: (s: string, [x, n]: unknown[]) => s.indexOf(strArg(x, "indexOf")!, numArg(n, "indexOf", true)),
      lastIndexOf: (s: string, [x, n]: unknown[]) => s.lastIndexOf(strArg(x, "lastIndexOf")!, numArg(n, "lastIndexOf", true)),
      localeCompare: (s: string, [x]: unknown[]) => s.localeCompare(strArg(x, "localeCompare")!),
      normalize: (s: string, [f]: unknown[]) => s.normalize(strArg(f, "normalize", true)),
      padEnd: (s: string, [n, f]: unknown[]) => s.padEnd(cappedLength(numArg(n, "padEnd")!), strArg(f, "padEnd", true)),
      padStart: (s: string, [n, f]: unknown[]) => s.padStart(cappedLength(numArg(n, "padStart")!), strArg(f, "padStart", true)),
      repeat: (s: string, [n]: unknown[]) => {
        const count = numArg(n, "repeat")!;
        cappedLength(s.length * count);
        return s.repeat(count);
      },
      replace: (s: string, [a, b]: unknown[]) => s.replace(strArg(a, "replace")!, () => strArg(b, "replace")!),
      replaceAll: (s: string, [a, b]: unknown[]) => s.replaceAll(strArg(a, "replaceAll")!, () => strArg(b, "replaceAll")!),
      slice: (s: string, [a, b]: unknown[]) => s.slice(numArg(a, "slice", true), numArg(b, "slice", true)),
      split: (s: string, [sep, n]: unknown[]) => (sep === undefined ? [s] : s.split(strArg(sep, "split")!, numArg(n, "split", true))),
      startsWith: (s: string, [x, n]: unknown[]) => s.startsWith(strArg(x, "startsWith")!, numArg(n, "startsWith", true)),
      substring: (s: string, [a, b]: unknown[]) => s.substring(numArg(a, "substring")!, numArg(b, "substring", true)),
      toLowerCase: (s: string) => s.toLowerCase(),
      toUpperCase: (s: string) => s.toUpperCase(),
      trim: (s: string) => s.trim(),
      trimStart: (s: string) => s.trimStart(),
      trimEnd: (s: string) => s.trimEnd(),
      toString: (s: string) => s,
    }) as [string, Impl][],
  );

  const NUMBER = new Map<string, Impl>(
    Object.entries({
      toFixed: (n: number, [d]: unknown[]) => n.toFixed(numArg(d, "toFixed", true)),
      toPrecision: (n: number, [d]: unknown[]) => n.toPrecision(numArg(d, "toPrecision", true)),
      toString: (n: number, [r]: unknown[]) => n.toString(numArg(r, "toString", true)),
      toLocaleString: (n: number) => n.toLocaleString(),
    }) as [string, Impl][],
  );

  const BOOLEAN = new Map<string, Impl>([["toString", ((b: boolean) => String(b)) as Impl]]);

  const listRead = {
    at: (l: unknown[], [i]: unknown[]) => l.at(numArg(i, "at")!),
    concat: (l: unknown[], a: unknown[]) => {
      const out = l.slice();
      for (const x of a) {
        if (isArray(x)) out.push(...x);
        else out.push(x);
      }
      return out;
    },
    every: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "every");
      return l.every((v, i) => c(v, i));
    },
    filter: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "filter");
      return l.filter((v, i) => c(v, i));
    },
    find: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "find");
      return l.find((v, i) => c(v, i));
    },
    findIndex: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "findIndex");
      return l.findIndex((v, i) => c(v, i));
    },
    findLast: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "findLast");
      for (let i = l.length - 1; i >= 0; i--) if (c(l[i], i)) return l[i];
      return undefined;
    },
    findLastIndex: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "findLastIndex");
      for (let i = l.length - 1; i >= 0; i--) if (c(l[i], i)) return i;
      return -1;
    },
    flat: (l: unknown[]) => {
      const out: unknown[] = [];
      for (const x of l) {
        if (isArray(x)) out.push(...x);
        else out.push(x);
      }
      return out;
    },
    flatMap: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "flatMap");
      const out: unknown[] = [];
      l.forEach((v, i) => {
        const r = c(v, i);
        if (isArray(r)) out.push(...r);
        else out.push(r);
      });
      return out;
    },
    forEach: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "forEach");
      l.forEach((v, i) => {
        c(v, i);
      });
      return undefined;
    },
    includes: (l: unknown[], [v, n]: unknown[]) => l.includes(v, numArg(n, "includes", true)),
    indexOf: (l: unknown[], [v, n]: unknown[]) => l.indexOf(v, numArg(n, "indexOf", true)),
    lastIndexOf: (l: unknown[], [v, n]: unknown[]) => (n === undefined ? l.lastIndexOf(v) : l.lastIndexOf(v, numArg(n, "lastIndexOf"))),
    join: (l: unknown[], [sep]: unknown[]) => l.map((x) => (x === null || x === undefined ? "" : toText(x))).join(strArg(sep, "join", true) ?? ","),
    map: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "map");
      return l.map((v, i) => c(v, i));
    },
    reduce: (l: unknown[], a: unknown[]) => {
      const c = cb(a[0], "reduce");
      return a.length > 1 ? l.reduce((acc, v, i) => c(acc, v, i), a[1]) : l.reduce((acc, v, i) => c(acc, v, i));
    },
    reduceRight: (l: unknown[], a: unknown[]) => {
      const c = cb(a[0], "reduceRight");
      return a.length > 1 ? l.reduceRight((acc, v, i) => c(acc, v, i), a[1]) : l.reduceRight((acc, v, i) => c(acc, v, i));
    },
    slice: (l: unknown[], [a, b]: unknown[]) => l.slice(numArg(a, "slice", true), numArg(b, "slice", true)),
    some: (l: unknown[], [f]: unknown[]) => {
      const c = cb(f, "some");
      return l.some((v, i) => c(v, i));
    },
    toSorted: (l: unknown[], [f]: unknown[]) => l.slice().sort(comparator(f)),
    toReversed: (l: unknown[]) => l.slice().reverse(),
    toSpliced: (l: unknown[], [s, n, ...items]: unknown[]) => {
      const out = l.slice();
      out.splice(numArg(s, "toSpliced")!, n === undefined ? out.length : numArg(n, "toSpliced")!, ...items);
      return out;
    },
    with: (l: unknown[], [i, v]: unknown[]) => {
      const idx = numArg(i, "with")!;
      const at = idx < 0 ? l.length + idx : idx;
      if (!Number.isInteger(at) || at < 0 || at >= l.length) throw new RangeError("with: index out of range.");
      const out = l.slice();
      out[at] = v;
      return out;
    },
  };
  const listWrite = {
    push: (l: unknown[], a: unknown[]) => {
      checkMutableList(l, "push");
      cappedLength(l.length + a.length);
      return l.push(...a);
    },
    pop: (l: unknown[]) => {
      checkMutableList(l, "pop");
      return l.pop();
    },
    shift: (l: unknown[]) => {
      checkMutableList(l, "shift");
      return l.shift();
    },
    unshift: (l: unknown[], a: unknown[]) => {
      checkMutableList(l, "unshift");
      cappedLength(l.length + a.length);
      return l.unshift(...a);
    },
    splice: (l: unknown[], [s, n, ...items]: unknown[]) => {
      checkMutableList(l, "splice");
      return l.splice(numArg(s, "splice")!, n === undefined ? l.length : numArg(n, "splice")!, ...items);
    },
    sort: (l: unknown[], [f]: unknown[]) => {
      checkMutableList(l, "sort");
      return l.sort(comparator(f));
    },
    reverse: (l: unknown[]) => {
      checkMutableList(l, "reverse");
      return l.reverse();
    },
  };
  const LIST = new Map<string, Impl>(Object.entries({ ...listRead, ...listWrite }) as [string, Impl][]);

  const MAP = new Map<string, Impl>(
    Object.entries({
      get: (m: Map<unknown, unknown>, [k]: unknown[]) => m.get(k),
      has: (m: Map<unknown, unknown>, [k]: unknown[]) => m.has(k),
      set: (m: Map<unknown, unknown>, [k, v]: unknown[]) => {
        checkMutableColl(m, "set");
        m.set(k, v);
        return m;
      },
      delete: (m: Map<unknown, unknown>, [k]: unknown[]) => {
        checkMutableColl(m, "delete");
        return m.delete(k);
      },
      clear: (m: Map<unknown, unknown>) => {
        checkMutableColl(m, "clear");
        m.clear();
        return undefined;
      },
      forEach: (m: Map<unknown, unknown>, [f]: unknown[]) => {
        const c = cb(f, "forEach");
        for (const [k, v] of Array.from(m)) c(v, k);
        return undefined;
      },
      keys: (m: Map<unknown, unknown>) => Array.from(m.keys()),
      values: (m: Map<unknown, unknown>) => Array.from(m.values()),
      entries: (m: Map<unknown, unknown>) => Array.from(m, ([k, v]) => [k, v]),
    }) as [string, Impl][],
  );

  const SET = new Map<string, Impl>(
    Object.entries({
      has: (s: Set<unknown>, [v]: unknown[]) => s.has(v),
      add: (s: Set<unknown>, [v]: unknown[]) => {
        checkMutableColl(s, "add");
        s.add(v);
        return s;
      },
      delete: (s: Set<unknown>, [v]: unknown[]) => {
        checkMutableColl(s, "delete");
        return s.delete(v);
      },
      clear: (s: Set<unknown>) => {
        checkMutableColl(s, "clear");
        s.clear();
        return undefined;
      },
      forEach: (s: Set<unknown>, [f]: unknown[]) => {
        const c = cb(f, "forEach");
        for (const v of Array.from(s)) c(v);
        return undefined;
      },
      values: (s: Set<unknown>) => Array.from(s),
    }) as [string, Impl][],
  );

  const dateGetters = [
    "getTime",
    "getFullYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getUTCFullYear",
    "getUTCMonth",
    "getUTCDate",
    "getUTCDay",
    "getUTCHours",
    "getUTCMinutes",
    "getUTCSeconds",
    "getUTCMilliseconds",
    "getTimezoneOffset",
    "toISOString",
    "toJSON",
    "toDateString",
    "toTimeString",
    "toString",
  ] as const;
  const DATE = new Map<string, Impl>(dateGetters.map((name) => [name, ((d: Date) => apply(NativeDate.prototype[name] as Function, d, [])) as Impl]));
  for (const name of ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"] as const)
    DATE.set(name, ((d: Date, [locale]: unknown[]) => apply(NativeDate.prototype[name] as Function, d, [strArg(locale, name, true)])) as Impl);

  const PROMISE = new Map<string, Impl>(
    Object.entries({
      then: (p: Promise<unknown>, [ok, err]: unknown[]) => thenOf(p, ok, err),
      catch: (p: Promise<unknown>, [err]: unknown[]) => thenOf(p, undefined, err),
      finally: (p: Promise<unknown>, [f]: unknown[]) => {
        if (f === undefined || f === null) return apply(promiseFinally, p, []);
        if (!isCallable(f)) fail(`finally takes a function, not ${describe(f)}.`);
        const k = cur;
        return quiet(apply(promiseFinally, p, [() => resume(k, f, [])]) as Promise<unknown>);
      },
    }) as [string, Impl][],
  );

  /** Marks a plugin promise as handled for the one rejection the runtime causes itself, the stop. Any other
   * rejection still surfaces as unhandled. */
  function quiet<P extends Promise<unknown>>(p: P): P {
    apply(promiseThen, p, [
      undefined,
      (e: unknown) => {
        if (!(e instanceof ThxStop)) throw e;
      },
    ]);
    return p;
  }

  function thenOf(p: Promise<unknown>, ok: unknown, err: unknown): Promise<unknown> {
    const k = cur;
    if (ok !== undefined && ok !== null && !isCallable(ok)) fail(`then takes a function, not ${describe(ok)}.`);
    if (err !== undefined && err !== null && !isCallable(err)) fail(`catch takes a function, not ${describe(err)}.`);
    return quiet(
      apply(promiseThen, p, [
        ok === undefined || ok === null ? undefined : (v: unknown) => resume(k, ok, [v]),
        err === undefined || err === null ? undefined : (e: unknown) => resume(k, err, [caught(e)]),
      ]) as Promise<unknown>,
    );
  }

  function methodTable(o: unknown): Map<string, Impl> | undefined {
    switch (kindOf(o)) {
      case "string":
        return STRING;
      case "number":
        return NUMBER;
      case "boolean":
        return BOOLEAN;
      case "list":
        return LIST;
      case "map":
        return MAP;
      case "set":
        return SET;
      case "date":
        return DATE;
      case "promise":
        return PROMISE;
      default:
        return undefined;
    }
  }

  // ---- built-in namespaces ----

  interface Ns {
    fields: Map<string, unknown>;
    call?: (args: unknown[]) => unknown;
    construct?: (args: unknown[]) => unknown;
  }

  function ns(spec: Ns): object {
    const token = freeze(create(null));
    nsTokens.set(token, spec);
    return token;
  }

  function nsFields(entries: Record<string, unknown>): Map<string, unknown> {
    const m = new Map<string, unknown>();
    for (const [k, v] of Object.entries(entries)) m.set(k, typeof v === "function" ? builtin(v) : v);
    return m;
  }

  function numbersOf(args: unknown[], what: string): number[] {
    return args.map((a) => {
      if (typeof a !== "number") fail(`Math.${what} takes numbers, not ${describe(a)}.`);
      return a;
    });
  }

  const mathFns: Record<string, unknown> = {};
  for (const name of ["abs", "acos", "asin", "atan", "atan2", "cbrt", "ceil", "cos", "exp", "floor", "hypot", "log", "log10", "log2", "max", "min", "pow", "round", "sign", "sin", "sqrt", "tan", "trunc"] as const) {
    const f = Math[name] as (...a: number[]) => number;
    mathFns[name] = (...a: unknown[]) => apply(f, Math, numbersOf(a, name));
  }
  mathFns.random = () => Math.random();
  for (const name of ["E", "LN2", "LN10", "LOG2E", "LOG10E", "PI", "SQRT1_2", "SQRT2"] as const) mathFns[name] = Math[name];
  const MathNs = ns({ fields: nsFields(mathFns) });

  const JSONNs = ns({
    fields: nsFields({
      parse: (text: unknown, reviver: unknown) => {
        if (reviver !== undefined) fail("JSON.parse takes no reviver in the language.");
        return fromJson(jsonParse(strArg(text, "JSON.parse")!));
      },
      stringify: (value: unknown, replacer: unknown, space: unknown) => {
        if (replacer !== undefined && replacer !== null) fail("JSON.stringify takes no replacer in the language.");
        if (space !== undefined && typeof space !== "number" && typeof space !== "string") fail("JSON.stringify's space is a number or a string.");
        return jsonStringify(toJsonable(value, new Set()), null, space as number | string | undefined);
      },
    }),
  });

  function fromJson(v: unknown): unknown {
    if (isPrimitive(v)) return v;
    if (isArray(v)) return v.map(fromJson);
    const o = makeRecord();
    for (const k of objectKeys(v as object)) {
      if (k === "__proto__") continue;
      setField(o, k, fromJson((v as Record<string, unknown>)[k]));
    }
    return o;
  }

  function toJsonable(v: unknown, seen: Set<unknown>): unknown {
    if (isPrimitive(v)) return v;
    if (seen.has(v)) fail("JSON.stringify: the value contains itself.");
    const k = kindOf(v);
    seen.add(v);
    try {
      if (k === "list") return (v as unknown[]).map((x) => {
        const j = toJsonable(x, seen);
        return j === undefined ? null : j;
      });
      if (k === "record") {
        const out: Record<string, unknown> = {};
        for (const key of objectKeys(v as object)) {
          const j = toJsonable(ownData(v as object, key), seen);
          if (j !== undefined) defineProperty(out, key, { value: j, enumerable: true, writable: true, configurable: true });
        }
        return out;
      }
      if (k === "date") return apply(NativeDate.prototype.toJSON, v, []);
      if (k === "map" || k === "set" || k === "url") return {};
      return undefined;
    } finally {
      seen.delete(v);
    }
  }

  function newDate(args: unknown[]): Date {
    const list = args.map((a) => {
      if (typeof a === "object" && a !== null && dates.has(a)) return apply(NativeDate.prototype.getTime, a, []) as number;
      return prim(a, "new Date");
    });
    const d = new NativeDate(...(list as [number]));
    dates.add(d);
    return d;
  }

  const DateNs = ns({
    fields: nsFields({
      now: () => NativeDate.now(),
      parse: (s: unknown) => NativeDate.parse(strArg(s, "Date.parse")!),
      UTC: (...a: unknown[]) => apply(NativeDate.UTC, NativeDate, numbersOf(a, "UTC")),
    }),
    construct: newDate,
  });

  const MapNs = ns({
    fields: new Map(),
    construct: ([entries]) => {
      const m = new NativeMap<unknown, unknown>();
      if (entries !== undefined && entries !== null) for (const pair of toList(entries, "new Map")) m.set(get(pair, 0), get(pair, 1));
      maps.add(m);
      return m;
    },
  });

  const SetNs = ns({
    fields: new Map(),
    construct: ([values]) => {
      const s = new NativeSet<unknown>(values === undefined || values === null ? [] : toList(values, "new Set"));
      sets.add(s);
      return s;
    },
  });

  const PromiseNs = ns({
    fields: nsFields({
      all: (list: unknown) => promiseAll(toList(list, "Promise.all")),
      resolve: (v: unknown) => promiseResolve(v),
    }),
  });

  function entriesOf(o: unknown): [string, unknown][] {
    if (isArray(o)) return o.map((v, i) => [String(i), v]);
    if (typeof o === "object" && o !== null && records.has(o)) return objectKeys(o).map((k) => [k, ownData(o, k)]);
    if (typeof o === "string") return Array.from(o, (c, i) => [String(i), c]);
    return [];
  }

  const ObjectNs = ns({
    fields: nsFields({
      keys: (o: unknown) => entriesOf(o).map(([k]) => k),
      values: (o: unknown) => entriesOf(o).map(([, v]) => v),
      entries: (o: unknown) => entriesOf(o).map(([k, v]) => [k, v]),
      fromEntries: (it: unknown) => recordFrom(toList(it, "Object.fromEntries").map((pair) => [normKey(get(pair, 0)), get(pair, 1)])),
    }),
  });

  const ArrayNs = ns({
    fields: nsFields({
      isArray: (v: unknown) => isArray(v),
      from: (it: unknown, f: unknown) => {
        let list: unknown[];
        if (typeof it === "object" && it !== null && records.has(it)) {
          const n = ownData(it, "length");
          if (typeof n !== "number" || !Number.isInteger(n) || n < 0) fail("Array.from takes a list, a string, a Map, a Set or { length: n }.");
          cappedLength(n);
          list = new Array(n).fill(undefined);
        } else list = toList(it, "Array.from").slice();
        if (f === undefined) return list;
        const c = cb(f, "Array.from");
        return list.map((v, i) => c(v, i));
      },
    }),
  });

  function toNumber(v: unknown): number {
    if (typeof v === "object" && v !== null && dates.has(v)) return apply(NativeDate.prototype.getTime, v, []) as number;
    if (isPrimitive(v)) return Number(v);
    return NaN;
  }

  const NumberNs = ns({
    fields: nsFields({
      isFinite: (v: unknown) => Number.isFinite(v),
      isInteger: (v: unknown) => Number.isInteger(v),
      isNaN: (v: unknown) => Number.isNaN(v),
      parseFloat: (s: unknown) => Number.parseFloat(strArg(s, "parseFloat")!),
      parseInt: (s: unknown, r: unknown) => Number.parseInt(strArg(s, "parseInt")!, numArg(r, "parseInt", true)),
      MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      EPSILON: Number.EPSILON,
    }),
    call: ([v]) => toNumber(v),
  });

  const StringNs = ns({ fields: new Map(), call: ([v]) => (v === undefined ? "" : toText(v)) });
  const BooleanNs = ns({ fields: new Map(), call: ([v]) => !!v });

  function makeError(message: unknown): Record<string, unknown> {
    const e = recordFrom([
      ["name", "Error"],
      ["message", message === undefined ? "" : toText(message)],
    ]);
    errorRecords.add(e);
    return e;
  }

  const ErrorNs = ns({ fields: new Map(), call: ([m]) => makeError(m), construct: ([m]) => makeError(m) });

  /** A value as text, the way a template string shows it. A Url can't be turned into text (L7). */
  function toText(v: unknown): string {
    if (isPrimitive(v)) return String(v);
    switch (kindOf(v)) {
      case "list":
        return (v as unknown[]).map((x) => (x === null || x === undefined ? "" : toText(x))).join(",");
      case "date":
        return apply(NativeDate.prototype.toString, v, []) as string;
      case "record":
        if (errorRecords.has(v as object)) return `${toText(ownData(v as object, "name"))}: ${toText(ownData(v as object, "message"))}`;
        return "[object Object]";
      case "url":
        return fail("A Url can't be turned into text: a plugin can pass an address along but never read it (L7).");
      case "function":
        return "function";
      case "element":
        return "[element]";
      default:
        return "[object Object]";
    }
  }

  // ---- reads, calls and writes ----

  function bound(o: unknown, impl: Impl): Function {
    return builtin((...a: unknown[]) => impl(o as never, spreadArgs(a)));
  }

  function get(o: unknown, k: unknown, opt?: number): unknown {
    if (o === SHORT) return SHORT;
    if (o === null || o === undefined) {
      if (opt) return SHORT;
      return fail(`Cannot read the field "${String(normKey(k))}" of ${o}.`);
    }
    const key = normKey(k);
    const kind = kindOf(o);
    switch (kind) {
      case "string": {
        const s = o as string;
        if (key === "length") return s.length;
        if (isIndexKey(key)) return s[Number(key)];
        const impl = STRING.get(key);
        return impl ? bound(s, impl) : undefined;
      }
      case "list": {
        const l = o as unknown[];
        if (key === "length") return l.length;
        if (isIndexKey(key)) return ownData(l, key);
        const impl = LIST.get(key);
        return impl ? bound(l, impl) : undefined;
      }
      case "record":
        return ownData(o as object, key);
      case "map":
      case "set":
        if (key === "size") return (o as Map<unknown, unknown>).size;
      // falls through
      case "number":
      case "boolean":
      case "date":
      case "promise": {
        const impl = methodTable(o)!.get(key);
        return impl ? bound(o, impl) : undefined;
      }
      case "builtin": {
        const spec = nsTokens.get(o as object)!;
        return spec.fields.get(key);
      }
      default:
        return fail(`${describe(o)} has no fields: it can only be ${kind === "function" ? "called" : kind === "url" ? "passed along" : kind === "element" ? "rendered" : "passed along"}.`);
    }
  }

  function method(o: unknown, k: unknown, args: unknown[], flags?: number): unknown {
    if (o === SHORT) return SHORT;
    if (o === null || o === undefined) {
      if (flags && flags & 1) return SHORT;
      return fail(`Cannot call "${String(normKey(k))}" on ${o}.`);
    }
    const key = normKey(k);
    const table = methodTable(o);
    const impl = table?.get(key);
    if (impl) return impl(o as never, spreadArgs(args));
    if (kindOf(o) === "builtin") {
      const f = nsTokens.get(o as object)!.fields.get(key);
      if (f === undefined && flags && flags & 2) return SHORT;
      if (typeof f !== "function") return fail(`${key} is not a function of this built-in.`);
      return apply(f, undefined, spreadArgs(args));
    }
    if (kindOf(o) === "record") {
      const f = ownData(o as object, key);
      if ((f === undefined || f === null) && flags && flags & 2) return SHORT;
      return callValue(f, spreadArgs(args));
    }
    if (table) {
      if (flags && flags & 2) return SHORT;
      return fail(`${describe(o)} has no method "${key}".`);
    }
    return get(o, key);
  }

  function call(f: unknown, args: unknown[], opt?: number): unknown {
    if (f === SHORT) return SHORT;
    if ((f === null || f === undefined) && opt) return SHORT;
    return callValue(f, spreadArgs(args));
  }

  const UPDATE: Record<string, (a: never, b: never) => unknown> = {
    "+=": (a, b) => (a as number) + (b as number),
    "-=": (a, b) => (a as number) - (b as number),
    "*=": (a, b) => (a as number) * (b as number),
    "/=": (a, b) => (a as number) / (b as number),
    "%=": (a, b) => (a as number) % (b as number),
    "**=": (a, b) => (a as number) ** (b as number),
    "&=": (a, b) => (a as number) & (b as number),
    "|=": (a, b) => (a as number) | (b as number),
    "^=": (a, b) => (a as number) ^ (b as number),
    "<<=": (a, b) => (a as number) << (b as number),
    ">>=": (a, b) => (a as number) >> (b as number),
    ">>>=": (a, b) => (a as number) >>> (b as number),
  };

  function set(o: unknown, k: unknown, v: unknown, op?: string): unknown {
    if (o === null || o === undefined) return fail(`Cannot set the field "${String(normKey(k))}" of ${o}.`);
    const key = normKey(k);
    const kind = kindOf(o);
    let old: unknown;
    if (kind === "record") {
      if (isFrozen(o)) fail("This record can't be changed: it was handed to the plugin or passed to the app. Make a new one: { ...record, field: value }.");
      checkWritableKey(key);
      old = ownData(o as object, key);
    } else if (kind === "list") {
      const l = o as unknown[];
      checkMutableList(l, "a field write");
      if (!isIndexKey(key) || Number(key) > l.length) fail(`A list's fields are its indexes, 0 to its length. "${key}" is not one.`);
      old = l[Number(key)];
    } else return fail(`${describe(o)} has no fields to set.`);
    let next: unknown;
    let result: unknown;
    if (op === undefined) next = result = v;
    else if (op === "++x" || op === "x++" || op === "--x" || op === "x--") {
      const n = +(old as number);
      next = op.includes("++") ? n + 1 : n - 1;
      result = op.startsWith("x") ? n : next;
    } else {
      const f = UPDATE[op];
      if (!f) return fail(`Unknown assignment ${op}.`);
      next = result = f(old as never, v as never);
    }
    if (kind === "record") setField(o as object, key, next);
    else (o as unknown[])[Number(key)] = next;
    return result;
  }

  function construct(c: unknown, args: unknown[]): unknown {
    const spec = typeof c === "object" && c !== null ? nsTokens.get(c) : undefined;
    if (!spec?.construct) return fail(`new works only on Date, Map, Set and Error, not ${describe(c)}.`);
    return spec.construct(spreadArgs(args));
  }

  function record(...parts: unknown[]): Record<string, unknown> {
    const o = makeRecord();
    for (let i = 0; i < parts.length; ) {
      const p = parts[i];
      if (typeof p === "object" && p !== null && spreads.has(p)) {
        const src = (p as { v: unknown }).v;
        if (src !== null && src !== undefined) for (const [k, v] of entriesOf(src)) setField(o, k, v);
        i += 1;
        continue;
      }
      setField(o, normKey(p), parts[i + 1]);
      i += 2;
    }
    return o;
  }

  function list(...items: unknown[]): unknown[] {
    cappedLength(items.length);
    return spreadArgs(items);
  }

  function spread(v: unknown): object {
    const marker = freeze({ v });
    spreads.add(marker);
    return marker;
  }

  function rest(o: unknown, without: unknown[]): Record<string, unknown> {
    if (typeof o !== "object" || o === null || !records.has(o)) return fail(`Only a record can be destructured with ...rest, not ${describe(o)}.`);
    const skip = new Set(without.map(normKey));
    return recordFrom(entriesOf(o).filter(([k]) => !skip.has(k)));
  }

  function caught(e: unknown): unknown {
    if (e instanceof ThxStop) throw e;
    alive();
    if (isPrimitive(e)) return e;
    if (typeof e === "object" || typeof e === "function") {
      if (kindOf(e) !== "opaque" && kindOf(e) !== "function") return e;
      if (pluginFns.has(e as object) || hostFns.has(e as object)) return e;
      let name = "Error";
      let message = "Unknown error";
      try {
        if (e instanceof NativeError || (typeof e === "object" && e !== null && "message" in e)) {
          const n = (e as { name?: unknown }).name;
          const m = (e as { message?: unknown }).message;
          name = typeof n === "string" ? n : "Error";
          message = typeof m === "string" ? m : String(m);
        }
      } catch {
        // A host error whose fields throw: keep the defaults.
      }
      const rec = recordFrom([
        ["name", name],
        ["message", message],
      ]);
      errorRecords.add(rec);
      freeze(rec);
      return rec;
    }
    return makeError("Unknown error");
  }

  // ---- host values ----

  function hostFunction<F extends (...args: never[]) => unknown>(fn: F): F {
    if (typeof fn !== "function") fail("hostFunction takes a function.");
    if (hostFns.has(fn)) return fn;
    const cached = hostFnFor.get(fn);
    if (cached) return cached as F;
    const wrapper = function (...args: unknown[]) {
      alive();
      const hostArgs = args.map((a) => toHost(a));
      return toThx(apply(fn, undefined, hostArgs));
    };
    hostFns.set(wrapper, fn);
    hostFnFor.set(fn, wrapper);
    return wrapper as unknown as F;
  }

  function hostComponent<C>(component: C): C {
    if ((typeof component !== "function" && typeof component !== "object") || component === null) fail("hostComponent takes a component.");
    hostComponents.add(component as object);
    return component;
  }

  function isLanguageValue(v: unknown): boolean {
    if (isPrimitive(v)) return true;
    const o = v as object;
    return (
      records.has(o) ||
      knownArrays.has(o) ||
      dates.has(o) ||
      maps.has(o) ||
      sets.has(o) ||
      urls.has(o) ||
      hostFns.has(o) ||
      hostComponents.has(o) ||
      elements.has(o) ||
      pluginFns.has(o) ||
      builtinFns.has(o)
    );
  }

  function toThx<T>(value: T): T {
    return convertIn(value, new Map()) as T;
  }

  function convertIn(v: unknown, seen: Map<object, unknown>): unknown {
    if (isPrimitive(v)) return v;
    if (typeof v !== "object" && typeof v !== "function") return fail(`toThx can't hand ${typeof v} values to a plugin.`);
    const o = v as object;
    if (pluginOriginOf.has(o)) return pluginOriginOf.get(o);
    if (isLanguageValue(o)) return o;
    if (o instanceof NativePromise) {
      const cachedP = thxCopyOf.get(o);
      if (cachedP) return cachedP;
      const p = apply(promiseThen, o, [(x: unknown) => toThx(x)]) as Promise<unknown>;
      thxCopyOf.set(o, p);
      return p;
    }
    if (typeof v === "function") return hostFunction(v as (...a: never[]) => unknown);
    const cached = thxCopyOf.get(o);
    if (cached !== undefined) return cached;
    if (seen.has(o)) return seen.get(o);
    let out: unknown;
    if (o instanceof NativeDate) {
      const d = new NativeDate(apply(NativeDate.prototype.getTime, o, []) as number);
      dates.add(d);
      out = d;
    } else if (o instanceof NativeMap) {
      const m = new NativeMap<unknown, unknown>();
      seen.set(o, m);
      for (const [k, val] of Array.from(o as Map<unknown, unknown>)) m.set(convertIn(k, seen), convertIn(val, seen));
      maps.add(m);
      frozenColls.add(m);
      out = m;
    } else if (o instanceof NativeSet) {
      const s = new NativeSet<unknown>();
      seen.set(o, s);
      for (const val of Array.from(o as Set<unknown>)) s.add(convertIn(val, seen));
      sets.add(s);
      frozenColls.add(s);
      out = s;
    } else if (isArray(o)) {
      const l: unknown[] = [];
      seen.set(o, l);
      for (let i = 0; i < o.length; i++) l.push(convertIn(o[i], seen));
      freeze(l);
      knownArrays.add(l);
      out = l;
    } else if (o instanceof NativeError) {
      out = caught(o);
    } else {
      const proto = getPrototypeOf(o);
      if (proto !== ObjectProto && proto !== null)
        return fail(`toThx can't hand ${Object.prototype.toString.call(o)} to a plugin: only plain objects, lists, Dates, Maps, Sets, functions and Urls.`);
      const r = makeRecord();
      seen.set(o, r);
      for (const k of objectKeys(o)) {
        if (k === "__proto__") continue;
        setField(r, k, convertIn((o as Record<string, unknown>)[k], seen));
      }
      freeze(r);
      out = r;
    }
    thxCopyOf.set(o, out);
    hostOriginOf.set(out as object, o);
    return out;
  }

  /** A plugin value as the host sees it. Plugin containers are frozen as they leave, so the copy stays true. */
  function toHost(v: unknown): unknown {
    return convertOut(v, new Map());
  }

  function convertOut(v: unknown, seen: Map<object, unknown>): unknown {
    if (isPrimitive(v)) return v;
    const o = v as object;
    if (hostOriginOf.has(o)) return hostOriginOf.get(o);
    if (urls.has(o) || elements.has(o) || hostComponents.has(o)) return o;
    if (hostFns.has(o)) return hostFns.get(o);
    const cached = hostCopyOf.get(o);
    if (cached !== undefined) return cached;
    if (seen.has(o)) return seen.get(o);
    let out: unknown;
    const kind = kindOf(o);
    if (pluginFns.has(o) || builtinFns.has(o)) {
      const f = o as Function;
      out = function (...args: unknown[]) {
        const outside = rendering === 0;
        try {
          const r = enter(f, args.map((a) => toThx(a)));
          if (outside && r instanceof NativePromise) apply(promiseThen, r, [undefined, report]);
          return toHost(r);
        } catch (e) {
          if (outside) report(e);
          throw e;
        }
      };
    } else if (kind === "promise") {
      out = apply(promiseThen, o, [(x: unknown) => toHost(x)]);
    } else if (kind === "list") {
      const l = o as unknown[];
      const copy: unknown[] = [];
      seen.set(o, copy);
      for (const x of l) copy.push(convertOut(x, seen));
      freeze(l);
      out = copy;
    } else if (kind === "record") {
      const copy: Record<string, unknown> = {};
      seen.set(o, copy);
      for (const k of objectKeys(o)) defineProperty(copy, k, { value: convertOut(ownData(o, k), seen), enumerable: true, writable: true, configurable: true });
      freeze(o);
      out = copy;
    } else if (kind === "date") {
      out = new NativeDate(apply(NativeDate.prototype.getTime, o, []) as number);
    } else if (kind === "map") {
      const m = new NativeMap<unknown, unknown>();
      seen.set(o, m);
      for (const [k, val] of Array.from(o as Map<unknown, unknown>)) m.set(convertOut(k, seen), convertOut(val, seen));
      frozenColls.add(o);
      out = m;
    } else if (kind === "set") {
      const s = new NativeSet<unknown>();
      seen.set(o, s);
      for (const val of Array.from(o as Set<unknown>)) s.add(convertOut(val, seen));
      frozenColls.add(o);
      out = s;
    } else return fail(`${describe(o)} can't be passed to the app.`);
    hostCopyOf.set(o, out);
    if (typeof out === "object" || typeof out === "function") pluginOriginOf.set(out as object, o);
    return out;
  }

  function mint(address: string, written: boolean): Url {
    const u = freeze(create(null)) as Url;
    urls.set(u, { address, written });
    return u;
  }

  function url(address: string): Url {
    if (typeof address !== "string" || !addressAllowed(address, "any", false)) fail(`url: "${String(address)}" is not an address a plugin may be handed: http(s), mailto, a path on this app, or a data: image or font.`);
    return mint(address, false);
  }

  /** An address written out in the source. */
  function addr(text: unknown, kind: unknown): Url {
    if (typeof text !== "string" || (kind !== "link" && kind !== "load")) return fail("This address is not allowed here.");
    if (kind === "load" && /^https?:/i.test(text))
      fail(`This plugin's code loads ${text} from outside the app. A plugin's own images and fonts are copied into the app when it is built (thixo build, thixo dev, or the authoring agent's submit), and this code was not.`);
    if (!addressAllowed(text, kind, true)) fail("This address is not allowed here.");
    return mint(text, true);
  }

  /** A file the build copied into the app for this version, by its name. The host says where it is served. */
  function asset(file: unknown): Url {
    if (typeof file !== "string" || !ASSET_FILE.test(file)) return fail("This is not the name of a copied file.");
    if (!host.assetAddress) return fail("This app can't show a plugin's copied files here.");
    const address = host.assetAddress(file);
    if (typeof address !== "string" || !address.startsWith("/") || address.startsWith("//") || /[\u0000-\u001f\u007f\s]/.test(address)) return fail("A copied file must be served from a path on the app.");
    return mint(address, true);
  }

  // ---- elements ----

  function propEntries(props: unknown[]): [string, unknown][] {
    const out: [string, unknown][] = [];
    for (let i = 0; i < props.length; ) {
      const p = props[i];
      if (typeof p === "object" && p !== null && spreads.has(p)) {
        const src = (p as { v: unknown }).v;
        if (src !== null && src !== undefined) {
          if (kindOf(src) !== "record") fail(`Only a record can be spread into an element's props, not ${describe(src)}.`);
          out.push(...entriesOf(src));
        }
        i += 1;
        continue;
      }
      out.push([normKey(p), props[i + 1]]);
      i += 2;
    }
    return out;
  }

  function childToHost(c: unknown): unknown {
    if (c === null || c === undefined || typeof c === "boolean" || typeof c === "string" || typeof c === "number") return c;
    if (isArray(c)) return c.map(childToHost);
    if (typeof c === "object" && elements.has(c)) return c;
    return fail(`${describe(c)} can't be rendered. Render text, numbers, elements or lists of them.`);
  }

  function eventData(ev: unknown): Record<string, unknown> {
    let value = "";
    let checked = false;
    let key = "";
    let x = 0;
    let y = 0;
    try {
      const e = ev as { target?: { value?: unknown; checked?: unknown }; key?: unknown; nativeEvent?: { offsetX?: unknown; offsetY?: unknown }; offsetX?: unknown; offsetY?: unknown };
      const target = e?.target;
      if (target && typeof target.value === "string") value = target.value;
      if (target && typeof target.checked === "boolean") checked = target.checked;
      if (typeof e?.key === "string") key = e.key;
      const ox = e?.nativeEvent?.offsetX ?? e?.offsetX;
      const oy = e?.nativeEvent?.offsetY ?? e?.offsetY;
      if (typeof ox === "number") x = ox;
      if (typeof oy === "number") y = oy;
    } catch {
      // Leave the defaults.
    }
    return freeze(recordFrom([["value", value], ["checked", checked], ["key", key], ["x", x], ["y", y]]));
  }

  function handlerFor(fn: unknown, name: string, preventDefault: boolean): (ev: unknown) => void {
    if (fn !== undefined && !isCallable(fn)) fail(`${name} takes a function, not ${describe(fn)} (L6).`);
    return (ev: unknown) => {
      if (preventDefault) {
        try {
          (ev as { preventDefault?: () => void })?.preventDefault?.();
        } catch {
          // Not a real event.
        }
      }
      if (fn === undefined) return;
      try {
        const r = enter(() => callValue(fn, [eventData(ev)]), []);
        if (r instanceof NativePromise) apply(promiseThen, r, [undefined, report]);
      } catch (e) {
        report(e);
      }
    };
  }

  function svgValue(v: unknown, name: string): string | number {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return fail(`${name} takes a string or a number, not ${describe(v)}.`);
    if (/url\s*\(|javascript:|expression\s*\(|[\\<>]/i.test(v)) fail(`${name}="${v}" is not allowed: it could load or run something.`);
    return v;
  }

  function el(type: unknown, props: unknown[], children: unknown[]): unknown {
    alive();
    const entries = propEntries(props);
    let element: unknown;
    if (typeof type === "string") {
      const kids = children.map(childToHost);
      if (!isElementAllowed(type)) fail(`<${type}> is not an element a plugin can create.`);
      const hp: Record<string, unknown> = {};
      const put = (k: string, v: unknown) => defineProperty(hp, k, { value: v, enumerable: true, writable: true, configurable: true });
      let hasSubmit = false;
      for (const [name, v] of entries) {
        const kind = attrKind(type, name);
        if (!kind) fail(`"${name}" is not an attribute <${type}> may have.`);
        if (v === undefined || v === null) continue;
        switch (kind) {
          case "key":
            if (typeof v !== "string" && typeof v !== "number") fail("key is a string or a number.");
            put("key", v);
            break;
          case "text":
            if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") fail(`${name} takes text, not ${describe(v)}.`);
            put(name, v);
            break;
          case "number":
            if (typeof v !== "number") fail(`${name} takes a number, not ${describe(v)}.`);
            put(name, v);
            break;
          case "boolean":
            if (typeof v !== "boolean") fail(`${name} takes true or false, not ${describe(v)}.`);
            put(name, v);
            break;
          case "token": {
            if (typeof v !== "string") fail(`${name} takes a string, not ${describe(v)}.`);
            const allowed = TOKEN_VALUES[type]?.[name] ?? TOKEN_VALUES["*"]?.[name];
            if (allowed && !allowed.includes(v)) fail(`${name}="${v}" is not allowed on <${type}>. Allowed: ${allowed.join(", ")}.`);
            put(name, v);
            break;
          }
          case "class":
            if (typeof v !== "string") fail(`className takes a string, not ${describe(v)}.`);
            put(name, v);
            break;
          case "link":
          case "load": {
            const info = typeof v === "object" ? urls.get(v as object) : undefined;
            if (!info) fail(`${name} takes a Url: an address written out in the source or handed to the plugin. A plugin can't build one (L7).`);
            if (!addressAllowed(info.address, kind, info.written)) fail(kind === "load" ? `${name} can't load that address: an address written in a plugin's source loads only from the app.` : `${name} can't hold that address.`);
            put(name, info.address);
            break;
          }
          case "event":
            if (name === "onSubmit") hasSubmit = true;
            put(name, handlerFor(v, name, name === "onSubmit"));
            break;
          case "style":
            put("style", styleProp(v));
            break;
          case "svg":
            put(name, svgValue(v, name));
            break;
        }
      }
      if (type === "a" && "href" in hp) {
        put("target", "_blank");
        put("rel", "noopener noreferrer");
      }
      if (type === "form" && !hasSubmit) put("onSubmit", handlerFor(undefined, "onSubmit", true));
      if (type === "input") put("autoComplete", "off");
      element = host.createElement(type, hp, ...kids);
    } else if ((typeof type === "function" || typeof type === "object") && type !== null && hostComponents.has(type)) {
      const hp: Record<string, unknown> = {};
      for (const [name, v] of entries) defineProperty(hp, name, { value: name === "key" ? prim(v, "key") : toHost(v), enumerable: true, writable: true, configurable: true });
      element = host.createElement(type, hp, ...children.map(childToHost));
    } else if (typeof type === "function" && pluginFns.has(type)) {
      let component = componentFor.get(type);
      if (!component) {
        const fn = type;
        component = function ThxComponent(hp: { __thx: unknown }) {
          rendering++;
          try {
            return childToHost(enter(fn, [hp.__thx]));
          } finally {
            rendering--;
          }
        };
        componentFor.set(type, component);
      }
      const p = makeRecord();
      let key: unknown;
      for (const [name, v] of entries) {
        if (name === "key") key = prim(v, "key");
        else setField(p, name, v);
      }
      if (children.length === 1) setField(p, "children", children[0]);
      else if (children.length > 1) setField(p, "children", children.slice());
      freeze(p);
      const hp: Record<string, unknown> = { __thx: p };
      if (key !== undefined) hp.key = key;
      element = host.createElement(component, hp);
    } else return fail(`${describe(type)} can't be rendered as an element. Render an allowed element name, one of the plugin's own components, or a component the app provides.`);
    if ((typeof element === "object" || typeof element === "function") && element !== null) elements.add(element);
    return element;
  }

  function frag(children: unknown[]): unknown {
    alive();
    const element = host.createElement(host.Fragment, null, ...children.map(childToHost));
    if (typeof element === "object" && element !== null) elements.add(element);
    return element;
  }

  // ---- styles ----

  function styleValue(prop: string, v: unknown): string {
    if (!STYLE_PROPS.has(prop)) fail(`"${prop}" is not a style property in the language.`);
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(`${prop}: ${v} is not a finite number.`);
      return STYLE_LENGTH.has(prop) && v !== 0 ? `${v}px` : String(v);
    }
    if (typeof v === "object" && v !== null && urls.has(v)) {
      if (!STYLE_URL_PROPS.has(prop)) fail(`${prop} can't hold a Url.`);
      const { address, written } = urls.get(v)!;
      if (!addressAllowed(address, "load", written)) fail(`${prop} can't load that address: an address written in a plugin's source loads only from the app.`);
      return `url(${cssString(address)})`;
    }
    if (typeof v !== "string") return fail(`${prop} takes a string, a number or a Url, not ${describe(v)}.`);
    if (!STYLE_VALUE_RE.test(v) || v.includes("/*") || v.includes("*/")) fail(`${prop}: "${v}" has characters a style value can't hold.`);
    if ((v.split('"').length - 1) % 2 !== 0 || (v.split("'").length - 1) % 2 !== 0) fail(`${prop}: "${v}" has an unclosed quote.`);
    const fnRe = /([a-zA-Z-]+)\s*\(/g;
    for (let m = fnRe.exec(v); m; m = fnRe.exec(v))
      if (!STYLE_FUNCTIONS.has(m[1].toLowerCase())) fail(`${prop}: ${m[1]}() is not allowed in a style. An address in a style is a Url (L7).`);
    if (/\(\s*\)/.test(v) && /^\s*\(/.test(v)) fail(`${prop}: "${v}" is not a style value.`);
    if (prop === "position" && !POSITION_VALUES.has(v.trim())) fail(`position: ${v} is not allowed. Use static, relative, absolute or sticky.`);
    return v;
  }

  function declarations(style: unknown, allowNested: boolean, nested: [string, unknown][]): string {
    if (kindOf(style) !== "record") return fail(`A style is a record, not ${describe(style)}.`);
    const out: string[] = [];
    for (const [k, v] of entriesOf(style)) {
      if (v === undefined || v === null) continue;
      if (k.startsWith(":") || k.startsWith("@")) {
        if (!allowNested) fail(`"${k}" can't be nested here. States and @media go in css({...}), one level deep.`);
        nested.push([k, v]);
        continue;
      }
      out.push(`${kebab(k)}:${styleValue(k, v)}`);
    }
    return out.join(";");
  }

  function css(style: unknown): string {
    alive();
    const nested: [string, unknown][] = [];
    const base = declarations(style, true, nested);
    const parts: string[] = [`.@{${base}}`];
    for (const [k, v] of nested) {
      if (k.startsWith(":")) {
        if (!STYLE_STATES.has(k)) fail(`"${k}" is not a state a style can have. Allowed: ${[...STYLE_STATES].join(", ")}.`);
        parts.push(`.@${k}{${declarations(v, false, [])}}`);
      } else {
        if (!MEDIA_RE.test(k)) fail(`"${k}" is not a media query the language allows.`);
        const inner: [string, unknown][] = [];
        const decls = declarations(v, true, inner);
        const innerRules = inner.map(([s, sv]) => {
          if (!s.startsWith(":") || !STYLE_STATES.has(s)) fail(`"${s}" can't be nested inside ${k}.`);
          return `.@${s}{${declarations(sv, false, [])}}`;
        });
        parts.push(`${k}{.@{${decls}}${innerRules.join("")}}`);
      }
    }
    const template = parts.join("\n");
    const cls = `thx${id}-${fnv(template)}`;
    if (!styleRules.has(cls)) {
      const text = template.split(".@").join(`.${cls}`);
      styleRules.set(cls, text);
      host.insertStyle?.(cls, text);
    }
    return cls;
  }

  function styleProp(style: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (kindOf(style) !== "record") return fail(`style takes a record, not ${describe(style)}.`);
    for (const [k, v] of entriesOf(style)) {
      if (v === undefined || v === null) continue;
      if (k.startsWith(":") || k.startsWith("@")) fail(`"${k}" can't go in the style prop. Use css({...}) for states and @media.`);
      const value = typeof v === "number" ? (styleValue(k, v), v) : styleValue(k, v);
      defineProperty(out, k, { value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  // ---- the plugin ----

  function definePluginAtRunTime(): never {
    return fail("definePlugin is called once, as plugin.thx's default export.");
  }

  function plugin(slot: unknown, meta: unknown, component: unknown): PluginDefinition {
    if (typeof slot !== "string") fail("plugin: the slot is a name.");
    if (typeof component !== "function" || !pluginFns.has(component)) fail("definePlugin's third argument is the plugin's own component function.");
    const fn = component;
    const m = toHost(meta) as PluginMeta;
    const def: PluginDefinition = {
      slot,
      meta: m,
      component: function ThxPlugin(props: Record<string, unknown>) {
        rendering++;
        try {
          const handed = toThx(props ?? {});
          return childToHost(enter(fn, [handed]));
        } finally {
          rendering--;
        }
      },
    };
    freeze(def);
    definitions.add(def);
    return def;
  }

  function imp(spec: unknown, name: unknown): unknown {
    if (typeof spec !== "string" || typeof name !== "string") return fail("imp: bad import.");
    if (spec === "thixo/plugin" && name === "definePlugin") return builtin(definePluginAtRunTime);
    if (spec === "thixo/plugin" && name === "css") return cssFn;
    const mod = Object.prototype.hasOwnProperty.call(host.modules, spec) ? host.modules[spec] : undefined;
    if (!mod) return fail(`The app gives plugins no module "${spec}".`);
    if (!Object.prototype.hasOwnProperty.call(mod, name)) return fail(`The app's module "${spec}" has no export "${name}".`);
    const v = mod[name];
    if (!isLanguageValue(v))
      return fail(`The app's "${spec}" export "${name}" was not made a language value. The host prepares each with hostFunction, hostComponent, toThx or url.`);
    return v;
  }

  const cssFn = builtin((style: unknown) => css(style));

  // ---- the counters ----

  function tick(): void {
    if (dead) throw dead;
    if (++cur.ticks > budget) stop(`The plugin ran more than ${budget} steps in one go and was stopped.`);
  }

  function push(): number {
    if (dead) throw dead;
    if (depth >= MAX_DEPTH) stop(`The plugin called functions more than ${MAX_DEPTH} deep and was stopped.`);
    return depth++;
  }

  function pop(d: number): void {
    depth = d;
  }

  function aw(x: unknown): Promise<{ ok: boolean; v?: unknown; e?: unknown }> {
    const box = (v: unknown) => ({ ok: true, v });
    if (x instanceof NativePromise) return apply(promiseThen, x, [box, (e: unknown) => ({ ok: false, e })]) as Promise<{ ok: boolean }>;
    return promiseResolve(box(x));
  }

  function back(k: Ctx, result: { ok: boolean; v?: unknown; e?: unknown }): unknown {
    alive();
    cur = k;
    k.ticks = 0;
    depth = 0;
    if (++k.resumes > maxResumes) stop(`The plugin awaited more than ${maxResumes} times in one go and was stopped.`);
    if (!result.ok) throw result.e;
    return result.v;
  }

  function registerFn<F>(f: F): F {
    if (typeof f !== "function") return fail("fn: not a function.");
    pluginFns.add(f);
    return f;
  }

  const guard = freeze(
    Object.assign(create(null), {
      tick,
      done: (p: unknown) => (p instanceof NativePromise ? quiet(p) : p),
      push,
      pop,
      ctx: () => cur,
      back,
      aw,
      fn: registerFn,
      c: call,
      m: method,
      g: get,
      s: set,
      end: (x: unknown) => (x === SHORT ? undefined : x),
      r: record,
      a: list,
      sp: spread,
      iter: (v: unknown) => (isArray(v) ? v : toList(v, "for ... of loop")),
      list: (v: unknown) => (isArray(v) ? v : toList(v, "destructuring")),
      rest,
      caught,
      el,
      frag,
      addr,
      asset,
      imp,
      nw: construct,
      plugin,
      str: toText,
      Math: MathNs,
      JSON: JSONNs,
      Date: DateNs,
      Map: MapNs,
      Set: SetNs,
      Promise: PromiseNs,
      Object: ObjectNs,
      Array: ArrayNs,
      Number: NumberNs,
      String: StringNs,
      Boolean: BooleanNs,
      Error: ErrorNs,
      parseInt: builtin((s: unknown, r: unknown) => Number.parseInt(strArg(s, "parseInt")!, numArg(r, "parseInt", true))),
      parseFloat: builtin((s: unknown) => Number.parseFloat(strArg(s, "parseFloat")!)),
      isNaN: builtin((n: unknown) => Number.isNaN(toNumber(n))),
      isFinite: builtin((n: unknown) => Number.isFinite(toNumber(n))),
    }),
  );

  return {
    hostFunction,
    hostComponent,
    toThx,
    url,
    isUrl: (value: unknown): value is Url => typeof value === "object" && value !== null && urls.has(value),
    unwrapUrl: (u: Url) => {
      const info = typeof u === "object" && u !== null ? urls.get(u) : undefined;
      if (!info) return fail("unwrapUrl takes a Url.");
      return info.address;
    },
    instantiate(module: { default: (rt: unknown) => unknown }): PluginDefinition {
      const fn = module?.default;
      if (typeof fn !== "function") fail("instantiate takes a compiled module.");
      const def = enter(fn, [guard]);
      if (typeof def !== "object" || def === null || !definitions.has(def)) fail("The module did not return a plugin definition.");
      return def as PluginDefinition;
    },
    styleSheet: () => [...styleRules.values()].join("\n"),
    get stopped() {
      return dead !== undefined;
    },
  } as Runtime;
};

/** The names on the object compiled code receives as `rt`. verifyOutput keeps its own copy of this list. */
export function guardNames(): string[] {
  const rt = createRuntime({ createElement: () => ({}), Fragment: "f", modules: {} });
  let names: string[] = [];
  try {
    rt.instantiate({
      default: (g: unknown) => {
        names = Object.keys(g as object);
        throw new Error("names only");
      },
    });
  } catch {
    // Expected: the module only reads the names.
  }
  return names;
}
