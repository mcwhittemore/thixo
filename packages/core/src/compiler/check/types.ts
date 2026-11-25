// The checker's types. Object types and signatures resolve their parts on first use, so a type can refer to itself
// (`type ThxNode = ... | readonly ThxNode[]`) and the lib costs only what a program touches.

import type * as A from "../syntax/ast.js";
import type { Sym } from "../bind.js";

let nextId = 1;

export type PrimName = "any" | "unknown" | "never" | "void" | "undefined" | "null" | "string" | "number" | "bigint" | "symbol" | "object";

export interface Prim {
  k: PrimName;
  id: number;
  /** The any that stands in after an error, so one mistake is reported once. */
  error?: boolean;
}

export interface Lit {
  k: "lit";
  id: number;
  value: string | number | boolean;
  /** From a literal in an expression: widens to its primitive where a value can change. */
  fresh: boolean;
}

/** A template literal type with holes, such as `https://${string}`. */
export interface Tpl {
  k: "tpl";
  id: number;
  quasis: string[];
  holes: Type[];
}

export interface Union {
  k: "union";
  id: number;
  types: Type[];
  alias?: string;
}

export interface Inter {
  k: "inter";
  id: number;
  types: Type[];
  alias?: string;
}

export interface TParam {
  k: "tparam";
  id: number;
  sym: Sym;
  name: string;
  constraint(): Type | undefined;
}

export interface Arr {
  k: "array";
  id: number;
  elem(): Type;
  ro: boolean;
}

export interface Tuple {
  k: "tuple";
  id: number;
  elems: Type[];
  optional: boolean[];
  /** The last element is `...T[]`, and `elems` holds its T. */
  rest: boolean;
  ro: boolean;
}

export interface Param {
  name: string;
  type: Type;
  optional: boolean;
  rest: boolean;
}

export interface Sig {
  tparams: TParam[];
  params(): Param[];
  ret(): Type;
  /** `x is T`: the parameter it names and the type. */
  pred?(): { index: number; type: Type } | undefined;
  /** A type parameter's default, for when a call gives nothing to infer it from. */
  tdefault?(tp: TParam): Type | undefined;
  /** Declared with method syntax, so its parameters are compared both ways. */
  method: boolean;
  decl?: A.Node;
}

export interface Prop {
  name: string;
  optional: boolean;
  readonly: boolean;
  type(): Type;
  decl?: A.Node;
}

export interface IndexInfo {
  key: Type;
  type: Type;
  readonly: boolean;
}

export interface Members {
  props: Map<string, Prop>;
  calls: Sig[];
  ctors: Sig[];
  index: IndexInfo[];
}

export interface Obj {
  k: "obj";
  id: number;
  members(): Members;
  /** How the type is shown: `ThxEvent`, `Map<string, number>`. Structural when absent. */
  name?: string;
  /** The interface or alias it instantiates, and with what, for comparing two instances without their members. */
  decl?: Sym;
  args?: Type[];
  /** Made by an object literal, a function expression or a spread: its literals widen where it is stored. */
  literal?: boolean;
  /** How to rebuild it under new type arguments. */
  instantiate?(m: Mapper): Type;
}

/** `keyof T` or `T[K]` over a type parameter, worked out once the parameter is known. */
export interface Deferred {
  k: "deferred";
  id: number;
  op: "keyof" | "index";
  a: Type;
  b?: Type;
}

export type Type = Prim | Lit | Tpl | Union | Inter | TParam | Arr | Tuple | Obj | Deferred;

export type Mapper = Map<number, Type>;

function prim(k: PrimName, error = false): Prim {
  return { k, id: nextId++, error };
}

export const T = {
  any: prim("any"),
  error: prim("any", true),
  unknown: prim("unknown"),
  never: prim("never"),
  void: prim("void"),
  undefined: prim("undefined"),
  null: prim("null"),
  string: prim("string"),
  number: prim("number"),
  bigint: prim("bigint"),
  symbol: prim("symbol"),
  object: prim("object"),
};

const lits = new Map<string, Lit>();

export function lit(value: string | number | boolean, fresh = false): Lit {
  const key = `${typeof value}:${fresh ? 1 : 0}:${String(value)}`;
  let l = lits.get(key);
  if (!l) {
    l = { k: "lit", id: nextId++, value, fresh };
    lits.set(key, l);
  }
  return l;
}

export const TRUE = lit(true);
export const FALSE = lit(false);
export const BOOLEAN: Union = { k: "union", id: nextId++, types: [FALSE, TRUE], alias: "boolean" };

export function newId(): number {
  return nextId++;
}

export function isLitOf(t: Type, base: "string" | "number" | "boolean"): t is Lit {
  return t.k === "lit" && typeof t.value === base;
}

export function baseOf(t: Lit): Type {
  return typeof t.value === "string" ? T.string : typeof t.value === "number" ? T.number : BOOLEAN;
}

export function regular(t: Lit): Lit {
  return t.fresh ? lit(t.value, false) : t;
}

/** A union, flattened, without repeats or members another member already covers. */
export function union(types: Type[], alias?: string): Type {
  const flat: Type[] = [];
  const push = (t: Type) => {
    if (t.k === "union") t.types.forEach(push);
    else flat.push(t);
  };
  types.forEach(push);
  let hasAny: Prim | undefined;
  let hasUnknown = false;
  let hasString = false;
  let hasNumber = false;
  for (const t of flat) {
    if (t.k === "any") hasAny ??= t;
    else if (t.k === "unknown") hasUnknown = true;
    else if (t.k === "string") hasString = true;
    else if (t.k === "number") hasNumber = true;
  }
  if (hasAny) return hasAny;
  if (hasUnknown) return T.unknown;
  const out: Type[] = [];
  const seen = new Set<number>();
  const litSeen = new Map<string, number>();
  for (const t of flat) {
    if (t.k === "never") continue;
    if (t.k === "lit") {
      if ((hasString && typeof t.value === "string") || (hasNumber && typeof t.value === "number")) continue;
      const key = `${typeof t.value}:${String(t.value)}`;
      const at = litSeen.get(key);
      if (at !== undefined) {
        if (!t.fresh) out[at] = t;
        continue;
      }
      litSeen.set(key, out.length);
      out.push(t);
      continue;
    }
    if (t.k === "tpl" && hasString) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  if (out.length === 0) return T.never;
  if (out.length === 1) return out[0];
  const hasTrue = out.some((t) => t.k === "lit" && t.value === true);
  const hasFalse = out.some((t) => t.k === "lit" && t.value === false);
  if (out.length === 2 && hasTrue && hasFalse && !alias) return BOOLEAN;
  return { k: "union", id: nextId++, types: out, alias };
}

export function intersection(types: Type[]): Type {
  const flat: Type[] = [];
  for (const t of types) {
    if (t.k === "inter") flat.push(...t.types);
    else flat.push(t);
  }
  const out = flat.filter((t, i) => t.k !== "unknown" && flat.findIndex((u) => u.id === t.id) === i);
  if (out.some((t) => t.k === "never")) return T.never;
  if (out.length === 0) return T.unknown;
  if (out.length === 1) return out[0];
  const any = out.find((t) => t.k === "any");
  if (any) return any;
  return { k: "inter", id: nextId++, types: out };
}

export function members(t: Type[] | undefined): Type[] {
  return t ?? [];
}

export function unionMembers(t: Type): Type[] {
  return t.k === "union" ? t.types : [t];
}

export function mapUnion(t: Type, fn: (m: Type) => Type): Type {
  if (t.k !== "union") return fn(t);
  const mapped = t.types.map(fn);
  return mapped.every((m, i) => m === t.types[i]) ? t : union(mapped);
}

export function filterUnion(t: Type, keep: (m: Type) => boolean): Type {
  if (t.k !== "union") return keep(t) ? t : T.never;
  const kept = t.types.filter(keep);
  if (kept.length === t.types.length) return t;
  return union(kept, kept.length > 1 && t.alias === "boolean" ? undefined : undefined);
}

export function emptyMembers(): Members {
  return { props: new Map(), calls: [], ctors: [], index: [] };
}

export function obj(fn: () => Members, extra: Partial<Obj> = {}): Obj {
  let m: Members | undefined;
  let resolving = false;
  return {
    k: "obj",
    id: nextId++,
    members() {
      if (m) return m;
      if (resolving) return emptyMembers();
      resolving = true;
      try {
        m = fn();
      } finally {
        resolving = false;
      }
      return m;
    },
    ...extra,
  };
}

export function lazy<V>(fn: () => V): () => V {
  let done = false;
  let v: V;
  let busy = false;
  return () => {
    if (done) return v;
    if (busy) throw new CircularError();
    busy = true;
    try {
      v = fn();
      done = true;
    } finally {
      busy = false;
    }
    return v;
  };
}

export class CircularError extends Error {}

export function arrayOf(elem: Type | (() => Type), ro = false): Arr {
  const get = typeof elem === "function" ? lazyType(elem) : () => elem;
  return { k: "array", id: nextId++, elem: get, ro };
}

function lazyType(fn: () => Type): () => Type {
  let v: Type | undefined;
  let busy = false;
  return () => {
    if (v) return v;
    if (busy) return T.error;
    busy = true;
    try {
      v = fn();
    } finally {
      busy = false;
    }
    return v;
  };
}

export function prop(name: string, type: Type | (() => Type), optional = false, ro = false, decl?: A.Node): Prop {
  return { name, optional, readonly: ro, type: typeof type === "function" ? lazyType(type) : () => type, decl };
}

export function sig(params: Param[] | (() => Param[]), ret: Type | (() => Type), extra: Partial<Sig> = {}): Sig {
  const ps = typeof params === "function" ? lazyOnce(params) : () => params;
  return { tparams: [], params: ps, ret: typeof ret === "function" ? lazyType(ret) : () => ret, method: false, ...extra };
}

function lazyOnce<V>(fn: () => V): () => V {
  let done = false;
  let v: V;
  return () => {
    if (!done) {
      v = fn();
      done = true;
    }
    return v;
  };
}

export function fnType(s: Sig, extra: Partial<Obj> = {}): Obj {
  return obj(() => ({ props: new Map(), calls: [s], ctors: [], index: [] }), extra);
}

export function minArgs(s: Sig): number {
  const ps = s.params();
  let n = 0;
  ps.forEach((p, i) => {
    if (!p.optional && !p.rest) n = i + 1;
  });
  return n;
}

export function hasRest(s: Sig): boolean {
  const ps = s.params();
  return ps.length > 0 && ps[ps.length - 1].rest;
}

export function isNullish(t: Type): boolean {
  return t.k === "undefined" || t.k === "null" || t.k === "void";
}

export function removeNullish(t: Type): Type {
  return filterUnion(t, (m) => !isNullish(m));
}

export function hasNullish(t: Type): boolean {
  return unionMembers(t).some(isNullish);
}

export function isStringLike(t: Type): boolean {
  return t.k === "string" || t.k === "tpl" || isLitOf(t, "string");
}

export function isNumberLike(t: Type): boolean {
  return t.k === "number" || isLitOf(t, "number");
}

export function isBooleanLike(t: Type): boolean {
  return isLitOf(t, "boolean") || t === BOOLEAN;
}

/** Fresh literals to their primitives, through unions. */
export function widenLiterals(t: Type): Type {
  if (t.k === "lit") return t.fresh ? baseOf(t) : t;
  if (t.k === "union") {
    if (!t.types.some((m) => m.k === "lit" && m.fresh)) return t;
    return union(t.types.map(widenLiterals), t.alias);
  }
  return t;
}

// ---- display ----

export function typeToString(t: Type, depth = 0): string {
  if (depth > 6) return "...";
  switch (t.k) {
    case "any":
    case "unknown":
    case "never":
    case "void":
    case "undefined":
    case "null":
    case "string":
    case "number":
    case "bigint":
    case "symbol":
    case "object":
      return t.k;
    case "lit":
      return typeof t.value === "string" ? JSON.stringify(t.value) : String(t.value);
    case "tpl": {
      let s = "`" + t.quasis[0];
      t.holes.forEach((h, i) => (s += "${" + typeToString(h, depth + 1) + "}" + t.quasis[i + 1]));
      return s + "`";
    }
    case "union": {
      if (t.alias) return t.alias;
      const parts: string[] = [];
      const hasTrue = t.types.some((m) => m.k === "lit" && m.value === true);
      const hasFalse = t.types.some((m) => m.k === "lit" && m.value === false);
      let boolDone = false;
      for (const m of t.types) {
        if (hasTrue && hasFalse && m.k === "lit" && typeof m.value === "boolean") {
          if (!boolDone) parts.push("boolean");
          boolDone = true;
          continue;
        }
        const s = typeToString(m, depth + 1);
        parts.push(m.k === "obj" && isFunctionOnly(m) && !m.name ? `(${s})` : s);
      }
      return parts.join(" | ");
    }
    case "inter":
      return t.alias ?? t.types.map((m) => typeToString(m, depth + 1)).join(" & ");
    case "tparam":
      return t.name;
    case "deferred":
      return t.op === "keyof" ? `keyof ${typeToString(t.a, depth + 1)}` : `${typeToString(t.a, depth + 1)}[${typeToString(t.b!, depth + 1)}]`;
    case "array": {
      const e = t.elem();
      let s = typeToString(e, depth + 1);
      if (e.k === "union" && !e.alias || e.k === "inter" || (e.k === "obj" && isFunctionOnly(e) && !e.name)) s = `(${s})`;
      return `${t.ro ? "readonly " : ""}${s}[]`;
    }
    case "tuple": {
      const parts = t.elems.map((e, i) => {
        const s = typeToString(e, depth + 1);
        if (t.rest && i === t.elems.length - 1) return `...${s}[]`;
        return t.optional[i] ? `${s}?` : s;
      });
      return `${t.ro ? "readonly " : ""}[${parts.join(", ")}]`;
    }
    case "obj": {
      if (t.name) return t.name;
      const m = t.members();
      if (m.props.size === 0 && m.index.length === 0 && m.ctors.length === 0 && m.calls.length === 1) return sigToString(m.calls[0], depth, "=>");
      const parts: string[] = [];
      for (const c of m.calls) parts.push(`${sigToString(c, depth, ":")};`);
      for (const ix of m.index) parts.push(`${ix.readonly ? "readonly " : ""}[x: ${typeToString(ix.key, depth + 1)}]: ${typeToString(ix.type, depth + 1)};`);
      let n = 0;
      for (const p of m.props.values()) {
        if (n++ > 8) {
          parts.push("...");
          break;
        }
        const key = /^[A-Za-z_$][\w$]*$/.test(p.name) ? p.name : JSON.stringify(p.name);
        let pt = p.type();
        if (p.optional) pt = removeUndefinedForDisplay(pt);
        parts.push(`${p.readonly ? "readonly " : ""}${key}${p.optional ? "?" : ""}: ${typeToString(pt, depth + 1)};`);
      }
      return parts.length ? `{ ${parts.join(" ")} }` : "{}";
    }
  }
}

function removeUndefinedForDisplay(t: Type): Type {
  return t.k === "union" ? filterUnion(t, (m) => m.k !== "undefined") : t;
}

function isFunctionOnly(t: Obj): boolean {
  const m = t.members();
  return m.props.size === 0 && m.index.length === 0 && m.calls.length === 1 && m.ctors.length === 0;
}

export function sigToString(s: Sig, depth: number, arrow: "=>" | ":"): string {
  const tps = s.tparams.length ? `<${s.tparams.map((p) => p.name).join(", ")}>` : "";
  const ps = s.params().map((p) => `${p.rest ? "..." : ""}${p.name}${p.optional && !p.rest ? "?" : ""}: ${typeToString(p.optional && !p.rest ? removeUndefinedForDisplay(p.type) : p.type, depth + 1)}`);
  const pred = s.pred?.();
  const ret = pred ? `${s.params()[pred.index]?.name ?? "x"} is ${typeToString(pred.type, depth + 1)}` : typeToString(s.ret(), depth + 1);
  return `${tps}(${ps.join(", ")}) ${arrow} ${ret}`;
}
