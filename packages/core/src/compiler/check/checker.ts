// The type check. It reads TypeScript's annotations and checks a program the way TypeScript would, for the part of
// TypeScript the language keeps: primitives and literals, unions and intersections, object types and interfaces,
// lists and tuples, functions and generics, narrowing by control flow, and JSX. A construct it does not read is a
// compile error, never a pass.

import type { ThixoError } from "../../contract.js";
import type * as A from "../syntax/ast.js";
import { lineCol } from "../syntax/ast.js";
import { parseType } from "../syntax/parser.js";
import type { BoundFile, Sym } from "../bind.js";
import { patternNames } from "../bind.js";
import type { ProgramFiles } from "../program.js";
import { attrsOf, isElementAllowed } from "../../runtime/allowlist.js";
import { attrType } from "../lib-dts.js";
import {
  arrayOf,
  BOOLEAN,
  baseOf,
  emptyMembers,
  FALSE,
  filterUnion,
  fnType,
  hasNullish,
  hasRest,
  intersection,
  isLitOf,
  isNullish,
  isNumberLike,
  isStringLike,
  lit,
  mapUnion,
  minArgs,
  newId,
  obj,
  prop,
  regular,
  removeNullish,
  sig,
  T,
  TRUE,
  typeToString,
  union,
  unionMembers,
  widenLiterals,
  type Arr,
  type IndexInfo,
  type Mapper,
  type Members,
  type Obj,
  type Param,
  type Prop,
  type Sig,
  type TParam,
  type Tuple,
  type Type,
} from "./types.js";

/** Lib names the checker implements itself instead of reading their mapped or conditional definitions. */
const INTRINSIC_ALIASES = new Set(["Partial", "Required", "Readonly", "Pick", "Record", "Exclude", "Extract", "Omit", "NonNullable", "Parameters", "ReturnType", "Awaited"]);

interface Env {
  map: Mapper;
  thisType?: Type;
}

const EMPTY_ENV: Env = { map: new Map() };

interface FlowEntry {
  t: Type;
  root: Sym;
}

/** What is known at a point in a function: narrowed types by reference, or null where the point can't be reached. */
type Flow = Map<string, FlowEntry> | null;

interface FnCtx {
  declared?: Type;
  contextual?: Type;
  isAsync: boolean;
  returns: Type[];
  node: A.Node;
}

interface BreakTarget {
  kind: "loop" | "switch";
  flows: Flow[];
}

export class Checker {
  readonly errors: ThixoError[] = [];
  private spec = 0;
  private specErrors = 0;
  private readonly fileOf = new Map<A.SourceFile, BoundFile>();
  private readonly symTypes = new Map<Sym, Type>();
  private readonly symBusy = new Set<Sym>();
  private readonly checkedDecls = new Set<A.Node>();
  private readonly ifaceCache = new Map<string, Obj>();
  private readonly aliasCache = new Map<string, Type>();
  private readonly aliasBusy = new Set<string>();
  private readonly tparamTypes = new Map<Sym, TParam>();
  private readonly fnReturn = new Map<A.Node, Type>();
  private readonly fnBusy = new Set<A.Node>();
  private readonly intrinsicProps = new Map<string, Obj>();
  private flow: Flow = new Map();
  private fnStack: FnCtx[] = [];
  private breaks: BreakTarget[] = [];

  constructor(private readonly p: ProgramFiles) {
    for (const m of p.modules.values()) this.fileOf.set(m.bound.file, m.bound);
    for (const b of p.bound.values()) this.fileOf.set(b.file, b);
  }

  // ---- errors ----

  private boundOf(n: A.Node): BoundFile | undefined {
    let x: A.Node | undefined = n;
    while (x && x.kind !== "SourceFile") x = x.parent;
    return x ? (this.fileOf.get(x) ?? this.p.lib.boundOf(x)) : undefined;
  }

  error(node: A.Node, message: string, at = node.start): void {
    if (this.spec > 0) {
      this.specErrors++;
      return;
    }
    const bf = this.boundOf(node);
    if (!bf || bf.home === "lib") return;
    const pos = lineCol(bf.file, at);
    this.errors.push({ file: bf.file.path, line: pos.line, column: pos.column, code: bf.home === "program" ? "thixo/type" : "thixo/env-type", message });
  }

  /** Runs `fn` without reporting, and says whether it would have reported anything. */
  private speculate<V>(fn: () => V): { value: V; ok: boolean } {
    const before = this.specErrors;
    const flow = this.flow;
    this.spec++;
    try {
      const value = fn();
      return { value, ok: this.specErrors === before };
    } finally {
      this.spec--;
      this.flow = flow;
    }
  }

  /** Runs `fn` as top-level work: reported, with nothing narrowed, whatever is being checked when it is needed. */
  private atTop<V>(fn: () => V): V {
    const spec = this.spec;
    const flow = this.flow;
    const fns = this.fnStack;
    const breaks = this.breaks;
    this.spec = 0;
    this.flow = new Map();
    this.fnStack = [];
    this.breaks = [];
    try {
      return fn();
    } finally {
      this.spec = spec;
      this.flow = flow;
      this.fnStack = fns;
      this.breaks = breaks;
    }
  }

  // ---- the program ----

  check(): ThixoError[] {
    for (const m of this.p.modules.values()) {
      if (!m.declErrors) {
        const before = this.errors.length;
        if (m.spec !== "thixo") this.checkDeclarations(m.bound);
        m.declErrors = this.errors.splice(before);
      }
      this.errors.push(...m.declErrors);
    }
    for (const bf of this.p.bound.values()) {
      for (const id of bf.duplicates) {
        const first = [...bf.decls.entries()].find(([k, v]) => v.name === id.name && k !== id && k.start < id.start)?.[1];
        const blockScoped = first && (first.kind === "const" || first.kind === "let");
        const msg = blockScoped ? `Cannot redeclare block-scoped variable '${id.name}'.` : first?.kind === "function" && first.decls[0].kind === "FunctionDecl" ? "Duplicate function implementation." : `Duplicate identifier '${id.name}'.`;
        if (first) this.error(first.ident, msg);
        this.error(id, msg);
      }
      this.flow = new Map();
      for (const s of bf.file.statements) this.stmt(s);
    }
    const ignored = new Map<string, Set<number>>();
    for (const [path, bf] of this.p.bound) {
      const lines = new Set<number>();
      const re = /\/\/[^\n]*@ts-(ignore|expect-error)\b|\/\*[\s\S]*?@ts-(ignore|expect-error)\b[\s\S]*?\*\//g;
      for (let m = re.exec(bf.file.text); m; m = re.exec(bf.file.text)) lines.add(lineCol(bf.file, m.index + m[0].length).line + 1);
      if (/@ts-nocheck\b/.test(bf.file.text)) lines.add(-1);
      ignored.set(path, lines);
    }
    const seen = new Set<string>();
    return this.errors.filter((e) => {
      const ig = ignored.get(e.file);
      if (ig && (ig.has(e.line) || ig.has(-1))) return false;
      const key = `${e.file}:${e.line}:${e.column}:${e.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** A host module's declarations: every name they use must exist, in types the language reads. */
  private checkDeclarations(bf: BoundFile): void {
    const unread: Partial<Record<A.Node["kind"], string>> = {
      ConditionalType: "Conditional types",
      MappedType: "Mapped types",
      InferType: "`infer`",
      ImportType: "`import(...)` types",
      ConstructorType: "Constructor types",
      Class: "Classes",
      Enum: "Enums",
    };
    const visit = (n: A.Node) => {
      const what = unread[n.kind];
      if (what) {
        this.error(n, `${what} are not read in a host module's declarations. Declare the type the program sees instead.`.replace("`infer` are", "`infer` is"));
        return;
      }
      if (n.kind === "TypeRef") this.typeFromNode(n, EMPTY_ENV);
      else if (n.kind === "TypeQuery") this.typeFromNode(n, EMPTY_ENV);
      const children: A.Node[] = [];
      forEach(n, (c) => children.push(c));
      children.forEach(visit);
    };
    for (const s of bf.file.statements) visit(s);
  }

  // ---- symbols ----

  private tparamOf(sym: Sym): TParam {
    let t = this.tparamTypes.get(sym);
    if (!t) {
      const decl = sym.decls[0] as A.TypeParam;
      let c: Type | undefined | null = null;
      t = {
        k: "tparam",
        id: newId(),
        sym,
        name: sym.name,
        constraint: () => {
          if (c === null) {
            c = undefined;
            c = decl.constraint ? this.typeFromNode(decl.constraint, EMPTY_ENV) : undefined;
          }
          return c;
        },
      };
      this.tparamTypes.set(sym, t);
    }
    return t;
  }

  /** The type a value symbol holds, as declared or inferred. */
  typeOfSym(sym: Sym): Type {
    const known = this.symTypes.get(sym);
    if (known) return known;
    if (sym.kind === "import") {
      const target = this.p.resolveAlias(sym);
      if (!target || !target.value) return T.error;
      return this.typeOfSym(target);
    }
    if (this.symBusy.has(sym)) {
      const d = sym.decls[0];
      if (d.kind === "VarDeclarator" && !d.type) this.error(sym.ident, `'${sym.name}' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.`);
      return T.error;
    }
    this.symBusy.add(sym);
    try {
      const t = this.computeSymType(sym);
      if (!this.symTypes.has(sym)) this.symTypes.set(sym, t);
      return this.symTypes.get(sym)!;
    } finally {
      this.symBusy.delete(sym);
    }
  }

  private computeSymType(sym: Sym): Type {
    const d = sym.decls[0];
    switch (d.kind) {
      case "FunctionDecl":
      case "Function":
        return this.functionDeclType(sym);
      case "VarDeclarator": {
        if (sym.file.home !== "program") return d.type ? this.typeFromNode(d.type, EMPTY_ENV) : T.error;
        const top = sym.topLevel;
        const run = () => this.varDeclarator(d, (d.parent as A.VarDecl).declKind);
        if (top) this.atTop(run);
        else run();
        return this.symTypes.get(sym) ?? T.error;
      }
      case "Param":
        if (d.type) return this.paramDeclaredType(d, EMPTY_ENV);
        return T.error;
      case "Try":
        return T.unknown;
    }
    return T.error;
  }

  private functionDeclType(sym: Sym): Type {
    const decls = sym.decls as (A.FunctionDecl | A.FunctionExpr)[];
    const overloads = decls.filter((d) => !d.body);
    const used = overloads.length ? overloads : decls;
    const sigs = used.map((d) => this.sigFromFunction(d, EMPTY_ENV));
    return obj(() => ({ props: new Map(), calls: sigs, ctors: [], index: [] }));
  }

  /** The value type of a lib global, such as `Math` or `Promise`. */
  private globalValue(name: string): Type {
    const sym = this.p.lib.global.values.get(name);
    return sym ? this.typeOfSym(sym) : T.error;
  }

  private globalTypeSym(name: string): Sym | undefined {
    return this.p.lib.global.types.get(name);
  }

  /** A lib interface by name, instantiated. */
  libInterface(name: string, args: Type[] = []): Obj | undefined {
    const sym = this.globalTypeSym(name);
    if (!sym || sym.kind !== "interface") return undefined;
    return this.interfaceType(sym, args);
  }

  promiseOf(t: Type): Type {
    return this.libInterface("Promise", [t]) ?? T.error;
  }

  jsxElement(): Type {
    const ns = this.globalTypeSym("JSX");
    const el = ns?.members?.get("Element");
    return el ? this.interfaceType(el, []) : T.error;
  }

  thxNode(): Type {
    const sym = this.globalTypeSym("ThxNode");
    return sym ? this.aliasType(sym, []) : T.error;
  }

  // ---- type nodes ----

  private resolveTypeName(name: A.Ident | A.QualifiedName, node: A.Node): Sym | undefined {
    if (name.kind === "QualifiedName") {
      const left = this.resolveTypeName(name.left, node);
      if (!left) return undefined;
      const target = left.kind === "import" ? this.p.resolveAlias(left) : left;
      const member = target?.members?.get(name.right.name);
      if (!member) this.error(name.right, `Namespace '${left.name}' has no exported member '${name.right.name}'.`);
      return member;
    }
    const bf = this.boundOf(node);
    if (bf) return bf.types.get(name);
    return this.p.lib.global.types.get(name.name);
  }

  typeFromNode(n: A.TypeNode, env: Env): Type {
    switch (n.kind) {
      case "KeywordType":
        switch (n.name) {
          case "boolean":
            return BOOLEAN;
          case "this":
            return env.thisType ?? T.error;
          default:
            return T[n.name];
        }
      case "LiteralType":
        return lit(n.value);
      case "TemplateType": {
        if (n.types.length === 0) return lit(n.quasis[0]);
        return { k: "tpl", id: newId(), quasis: n.quasis, holes: n.types.map((t) => this.typeFromNode(t, env)) };
      }
      case "ArrayType":
        return arrayOf(() => this.typeFromNode(n.elem, env), false);
      case "TupleType":
        return this.tupleFromNode(n, env, false);
      case "TypeOperator": {
        if (n.op === "readonly") {
          if (n.type.kind === "ArrayType") {
            const elem = n.type.elem;
            return arrayOf(() => this.typeFromNode(elem, env), true);
          }
          if (n.type.kind === "TupleType") return this.tupleFromNode(n.type, env, true);
          const inner = this.typeFromNode(n.type, env);
          if (inner.k === "array") return arrayOf(inner.elem, true);
          if (inner.k === "tuple") return { ...inner, id: newId(), ro: true };
          return inner;
        }
        if (n.op === "unique") return T.symbol;
        return this.keyof(this.typeFromNode(n.type, env));
      }
      case "UnionType": {
        const parts = n.types.map((t) => this.typeFromNode(t, env));
        return n.kind === "UnionType" ? union(parts) : intersection(parts);
      }
      case "IntersectionType":
        return intersection(n.types.map((t) => this.typeFromNode(t, env)));
      case "FunctionType": {
        const s = this.sigFromParts(n, n.params, n.returnType, n.typeParams, env, false);
        return fnType(s, { instantiate: (m) => this.typeFromNode(n, composeEnv(env, m, this)) });
      }
      case "ConstructorType": {
        const s = this.sigFromParts(n, n.params, n.returnType, n.typeParams, env, false);
        return obj(() => ({ props: new Map(), calls: [], ctors: [s], index: [] }));
      }
      case "TypeLiteral":
        return this.objFromMembers(n.members, env, undefined, undefined, (m) => this.typeFromNode(n, composeEnv(env, m, this)));
      case "ParenType":
        return this.typeFromNode(n.type, env);
      case "TypeQuery":
        return this.typeQuery(n);
      case "IndexedAccessType": {
        const o = this.typeFromNode(n.object, env);
        const i = this.typeFromNode(n.index, env);
        if (this.isGeneric(o) || this.isGeneric(i)) return this.deferred("index", o, i);
        const r = this.indexedAccess(o, i);
        if (!r) {
          this.error(n.index, `Type '${typeToString(i)}' cannot be used to index type '${typeToString(o)}'.`);
          return T.error;
        }
        return r;
      }
      case "TypePredicate":
        return n.asserts ? T.void : BOOLEAN;
      case "TypeRef":
        return this.typeRef(n, env);
      case "MappedType":
        return this.mappedType(n, env);
      case "ConditionalType":
      case "InferType":
      case "ImportType":
        return T.error;
    }
  }

  /** `{ [P in keyof X]: ... }` over a known X, for the lib's `Promise.all`. Programs can't write one. */
  private mappedType(n: A.MappedType, env: Env): Type {
    if (n.constraint.kind !== "TypeOperator" || n.constraint.op !== "keyof") return T.error;
    const src = this.typeFromNode(n.constraint.type, env);
    if (this.isGeneric(src)) return obj(emptyMembers, { name: "{ ... }", instantiate: (m) => this.typeFromNode(n, composeEnv(env, m, this)) });
    const sym = this.boundOf(n)?.decls.get(n.param);
    if (!sym || !n.type) return T.error;
    const tp = this.tparamOf(sym);
    const at = (key: Type) => this.typeFromNode(n.type!, { map: new Map([...env.map, [tp.id, key]]), thisType: env.thisType });
    if (src.k === "tuple") return { k: "tuple", id: newId(), elems: src.elems.map((_, i) => at(lit(i))), optional: src.optional, rest: src.rest, ro: false };
    if (src.k === "array") return arrayOf(() => at(T.number));
    const sm = this.resolvedMembers(src);
    if (!sm) return T.error;
    return obj(() => {
      const out = emptyMembers();
      for (const [k, p] of sm.props) out.props.set(k, prop(k, () => at(lit(k)), p.optional, p.readonly));
      return out;
    });
  }

  private tupleFromNode(n: A.TupleType, env: Env, ro: boolean): Tuple {
    const elems: Type[] = [];
    const optional: boolean[] = [];
    let rest = false;
    n.elements.forEach((e, i) => {
      let t = this.typeFromNode(e.type, env);
      if (e.rest) {
        if (i === n.elements.length - 1 && t.k === "array") {
          rest = true;
          t = t.elem();
        } else if (t.k === "tuple") {
          elems.push(...t.elems);
          optional.push(...t.optional);
          return;
        }
      }
      elems.push(t);
      optional.push(e.optional);
    });
    return { k: "tuple", id: newId(), elems, optional, rest, ro };
  }

  private typeQuery(n: A.TypeQuery): Type {
    let name: A.Ident | A.QualifiedName = n.name;
    const path: string[] = [];
    while (name.kind === "QualifiedName") {
      path.unshift(name.right.name);
      name = name.left;
    }
    const bf = this.boundOf(n);
    const sym = bf?.values.get(name);
    if (!sym) {
      this.error(name, `Cannot find name '${name.name}'.`);
      return T.error;
    }
    let t = this.typeOfSym(sym);
    for (const pName of path) {
      const pr = this.getProp(t, pName);
      if (!pr) return T.error;
      t = pr.type();
    }
    return t;
  }

  private typeRef(n: A.TypeRef, env: Env): Type {
    const first = n.name.kind === "Ident" ? n.name : leftmost(n.name);
    const sym0 = this.resolveTypeName(n.name, n);
    if (!sym0) {
      if (n.name.kind === "Ident") {
        if (n.name.name === "const") return T.error;
        this.error(n.name, `Cannot find name '${n.name.name}'.`);
      }
      void first;
      return T.error;
    }
    let sym = sym0;
    if (sym.kind === "import") {
      const target = this.p.resolveAlias(sym);
      if (!target) return T.error;
      if (!target.type) {
        this.error(n.name, `'${sym.name}' refers to a value, but is being used as a type here.`);
        return T.error;
      }
      sym = target;
    }
    const args = (n.args ?? []).map((a) => this.typeFromNode(a, env));
    switch (sym.kind) {
      case "typeParam": {
        const bound = env.map.get(this.tparamOf(sym).id);
        return bound ?? this.tparamOf(sym);
      }
      case "interface": {
        if (sym.file.home === "lib" && (sym.name === "Array" || sym.name === "ReadonlyArray") && args.length === 1) {
          const elem = n.args![0];
          return arrayOf(() => this.typeFromNode(elem, env), sym.name === "ReadonlyArray");
        }
        const tps = this.declTypeParams(sym);
        if (!this.checkTypeArgCount(n, sym, tps, args)) return T.error;
        return this.interfaceType(sym, this.fillDefaults(tps, args));
      }
      case "type": {
        if (sym.file.home === "lib" && INTRINSIC_ALIASES.has(sym.name)) return this.intrinsicAlias(sym.name, args, n);
        const tps = this.declTypeParams(sym);
        if (!this.checkTypeArgCount(n, sym, tps, args)) return T.error;
        return this.aliasType(sym, this.fillDefaults(tps, args));
      }
      case "namespace":
        this.error(n.name, `Cannot use namespace '${sym.name}' as a type.`);
        return T.error;
      default:
        this.error(n.name, `'${sym.name}' refers to a value, but is being used as a type here. Did you mean 'typeof ${sym.name}'?`);
        return T.error;
    }
  }

  private declTypeParams(sym: Sym): A.TypeParam[] {
    const d = sym.decls[0] as A.Interface | A.TypeAlias;
    return d.typeParams ?? [];
  }

  private checkTypeArgCount(n: A.TypeRef, sym: Sym, tps: A.TypeParam[], args: Type[]): boolean {
    const required = tps.filter((t) => !t.default).length;
    if (args.length < required || args.length > tps.length) {
      if (tps.length === 0) this.error(n, `Type '${sym.name}' is not generic.`);
      else if (required === tps.length) this.error(n, `Generic type '${sym.name}' requires ${tps.length} type argument${tps.length === 1 ? "" : "s"}.`);
      else this.error(n, `Generic type '${sym.name}' requires between ${required} and ${tps.length} type arguments.`);
      return false;
    }
    return true;
  }

  private fillDefaults(tps: A.TypeParam[], args: Type[]): Type[] {
    if (args.length === tps.length) return args;
    const out = [...args];
    const map: Mapper = new Map();
    tps.forEach((tp, i) => {
      const sym = this.boundOf(tp)?.decls.get(tp.name);
      if (i < args.length) {
        if (sym) map.set(this.tparamOf(sym).id, args[i]);
        return;
      }
      const t = tp.default ? this.typeFromNode(tp.default, { map }) : T.unknown;
      out.push(t);
      if (sym) map.set(this.tparamOf(sym).id, t);
    });
    return out;
  }

  private envFor(tps: A.TypeParam[] | undefined, args: Type[], base: Env = EMPTY_ENV): Env {
    if (!tps?.length) return base;
    const map: Mapper = new Map(base.map);
    tps.forEach((tp, i) => {
      const sym = this.boundOf(tp)?.decls.get(tp.name);
      if (sym) map.set(this.tparamOf(sym).id, args[i] ?? T.unknown);
    });
    return { map, thisType: base.thisType };
  }

  interfaceType(sym: Sym, args: Type[]): Obj {
    const key = `${sym.id}<${args.map((a) => a.id).join(",")}>`;
    let t = this.ifaceCache.get(key);
    if (t) return t;
    const decls = sym.decls as A.Interface[];
    const name = args.length ? `${sym.name}<${args.map((a) => typeToString(a)).join(", ")}>` : sym.name;
    const self: Obj = obj(
      () => {
        const env = this.envFor(decls[0].typeParams, args);
        const withThis: Env = { map: env.map, thisType: self };
        const m = emptyMembers();
        for (const d of decls) {
          const declEnv = d === decls[0] ? withThis : { ...this.envFor(d.typeParams, args), thisType: self };
          for (const base of d.extends) {
            const bt = this.typeFromNode(base, declEnv);
            const bm = this.resolvedMembers(bt);
            if (!bm) continue;
            for (const [k, v] of bm.props) if (!m.props.has(k)) m.props.set(k, v);
            m.calls.push(...bm.calls);
            m.ctors.push(...bm.ctors);
            m.index.push(...bm.index);
          }
          const own = this.membersFrom(d.members, declEnv);
          for (const [k, v] of own.props) m.props.set(k, v);
          m.calls.unshift(...own.calls);
          m.ctors.unshift(...own.ctors);
          m.index.unshift(...own.index);
        }
        return m;
      },
      { name, decl: sym, args, instantiate: (mp) => this.interfaceType(sym, args.map((a) => this.instantiate(a, mp))) },
    );
    this.ifaceCache.set(key, self);
    return self;
  }

  private resolvedMembers(t: Type): Members | undefined {
    const a = this.apparent(t);
    if (a.k === "obj") return a.members();
    if (a.k === "inter") {
      const m = emptyMembers();
      for (const part of a.types) {
        const pm = this.resolvedMembers(part);
        if (!pm) continue;
        for (const [k, v] of pm.props) if (!m.props.has(k)) m.props.set(k, v);
        m.calls.push(...pm.calls);
        m.ctors.push(...pm.ctors);
        m.index.push(...pm.index);
      }
      return m;
    }
    return undefined;
  }

  aliasType(sym: Sym, args: Type[]): Type {
    const key = `${sym.id}<${args.map((a) => a.id).join(",")}>`;
    const cached = this.aliasCache.get(key);
    if (cached) return cached;
    if (this.aliasBusy.has(key)) {
      this.error(sym.ident, `Type alias '${sym.name}' circularly references itself.`);
      return T.error;
    }
    this.aliasBusy.add(key);
    try {
      const d = sym.decls[0] as A.TypeAlias;
      const env = this.envFor(d.typeParams, args);
      let t = this.typeFromNode(d.type, env);
      if (t.k === "union" && !t.alias && args.length === 0) t = { ...t, id: newId(), alias: sym.name };
      else if (t.k === "inter" && !t.alias && args.length === 0) t = { ...t, id: newId(), alias: sym.name };
      else if (t.k === "obj" && !t.name && (d.type.kind === "TypeLiteral" || d.type.kind === "FunctionType")) {
        const inner = t;
        t = { ...inner, id: newId(), name: args.length ? `${sym.name}<${args.map((a) => typeToString(a)).join(", ")}>` : sym.name };
      }
      this.aliasCache.set(key, t);
      return t;
    } finally {
      this.aliasBusy.delete(key);
    }
  }

  private membersFrom(ms: A.TypeMember[], env: Env): Members {
    const m = emptyMembers();
    const methods = new Map<string, Sig[]>();
    for (const mem of ms) {
      switch (mem.kind) {
        case "PropSig": {
          const name = staticKey(mem.key);
          if (name === undefined) continue;
          const tn = mem.type;
          m.props.set(name, prop(name, () => {
            const t = tn ? this.typeFromNode(tn, env) : T.error;
            return mem.optional ? union([t, T.undefined]) : t;
          }, mem.optional, mem.readonly, mem));
          break;
        }
        case "MethodSig": {
          const name = staticKey(mem.key);
          if (name === undefined) continue;
          const s = this.sigFromParts(mem, mem.params, mem.returnType, mem.typeParams, env, true);
          let list = methods.get(name);
          if (!list) {
            list = [];
            methods.set(name, list);
            const sigs = list;
            const optional = mem.optional;
            m.props.set(name, prop(name, () => {
              const f = obj(() => ({ props: new Map(), calls: sigs, ctors: [], index: [] }));
              return optional ? union([f, T.undefined]) : f;
            }, mem.optional, false, mem));
          }
          list.push(s);
          break;
        }
        case "CallSig":
          m.calls.push(this.sigFromParts(mem, mem.params, mem.returnType, mem.typeParams, env, false));
          break;
        case "ConstructSig":
          m.ctors.push(this.sigFromParts(mem, mem.params, mem.returnType, mem.typeParams, env, false));
          break;
        case "IndexSig":
          m.index.push({ key: this.typeFromNode(mem.keyType, env), type: this.typeFromNode(mem.type, env), readonly: mem.readonly });
          break;
      }
    }
    return m;
  }

  private objFromMembers(ms: A.TypeMember[], env: Env, name?: string, decl?: Sym, inst?: (m: Mapper) => Type): Obj {
    return obj(() => this.membersFrom(ms, env), { name, decl, instantiate: inst });
  }

  /** The type of a parameter as written. A rest parameter's type is its list type. Optional ones include undefined. */
  private paramDeclaredType(p: A.Param, env: Env): Type {
    if (!p.type) return T.error;
    const t = this.typeFromNode(p.type, env);
    return p.optional && !p.rest ? union([t, T.undefined]) : t;
  }

  private sigFromParts(node: A.Node, params: A.Param[], returnType: A.TypeNode | undefined, typeParams: A.TypeParam[] | undefined, env: Env, method: boolean): Sig {
    const tps = (typeParams ?? []).map((tp) => {
      const sym = this.boundOf(tp)?.decls.get(tp.name);
      return sym ? this.tparamOf(sym) : undefined;
    }).filter((x): x is TParam => !!x);
    const visible = params.filter((p) => !(p.target.kind === "Ident" && p.target.name === "this"));
    const s: Sig = sig(
      () =>
        visible.map((p, i) => ({
          name: p.target.kind === "Ident" ? p.target.name : `__${i}`,
          type: p.type ? this.paramDeclaredType(p, env) : p.init ? this.atTop(() => widenLiterals(this.expr(p.init!))) : (this.implicitAny(p), T.error),
          optional: p.optional || !!p.init || p.rest,
          rest: p.rest,
        })),
      () => {
        if (returnType) return this.typeFromNode(returnType, env);
        return T.error;
      },
      {
        tparams: tps,
        method,
        decl: node,
        tdefault: (tp) => {
          const d = (typeParams ?? []).find((x) => x.name.name === tp.name)?.default;
          return d ? this.typeFromNode(d, env) : undefined;
        },
        pred:
          returnType?.kind === "TypePredicate" && returnType.type && !returnType.asserts
            ? () => {
                const pr = returnType as A.TypePredicate;
                const index = visible.findIndex((p) => p.target.kind === "Ident" && pr.param.kind === "Ident" && p.target.name === pr.param.name);
                return index < 0 ? undefined : { index, type: this.typeFromNode(pr.type!, env) };
              }
            : undefined,
      },
    );
    return s;
  }

  private implicitAny(p: A.Param): void {
    if (p.target.kind === "Ident") this.error(p, `Parameter '${p.target.name}' implicitly has an 'any' type.`);
    else for (const id of patternNames(p.target)) this.error(id, `Binding element '${id.name}' implicitly has an 'any' type.`);
  }

  /** A declared function's signature. Without a return type, the return type is inferred from its body. */
  private sigFromFunction(f: A.FunctionDecl | A.FunctionExpr, env: Env): Sig {
    const base = this.sigFromParts(f, f.params, f.returnType, f.typeParams, env, false);
    if (f.returnType || !f.body) return base;
    return { ...base, ret: () => this.inferredReturn(f) };
  }

  private inferredReturn(f: A.FunctionDecl | A.FunctionExpr): Type {
    const known = this.fnReturn.get(f);
    if (known) return known;
    if (this.fnBusy.has(f)) {
      if (f.name) this.error(f.name, `'${f.name.name}' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.`);
      return T.error;
    }
    this.fnBusy.add(f);
    try {
      const t = this.atTop(() => {
        this.bindDeclaredParams(f);
        return this.functionBody(f, undefined);
      });
      this.fnReturn.set(f, t);
      this.checkedDecls.add(f);
      return t;
    } finally {
      this.fnBusy.delete(f);
    }
  }

  // ---- instantiation ----

  instantiate(t: Type, m: Mapper): Type {
    if (m.size === 0) return t;
    switch (t.k) {
      case "tparam":
        return m.get(t.id) ?? t;
      case "union": {
        const parts = t.types.map((x) => this.instantiate(x, m));
        return parts.every((x, i) => x === t.types[i]) ? t : union(parts);
      }
      case "inter":
        return intersection(t.types.map((x) => this.instantiate(x, m)));
      case "array": {
        const e = t.elem;
        return arrayOf(() => this.instantiate(e(), m), t.ro);
      }
      case "tuple":
        return { ...t, id: newId(), elems: t.elems.map((x) => this.instantiate(x, m)) };
      case "tpl":
        return { ...t, id: newId(), holes: t.holes.map((x) => this.instantiate(x, m)) };
      case "obj":
        return t.instantiate ? t.instantiate(m) : this.mapObj(t, m);
      case "deferred": {
        const a = this.instantiate(t.a, m);
        if (t.op === "keyof") return this.keyof(a);
        const b = this.instantiate(t.b!, m);
        if (this.isGeneric(a) || this.isGeneric(b)) return this.deferred("index", a, b);
        return this.indexedAccess(a, b) ?? T.error;
      }
      default:
        return t;
    }
  }

  private mapObj(t: Obj, m: Mapper): Obj {
    return obj(() => {
      const src = t.members();
      const out = emptyMembers();
      for (const [k, p] of src.props) out.props.set(k, prop(k, () => this.instantiate(p.type(), m), p.optional, p.readonly, p.decl));
      out.calls = src.calls.map((s) => this.instantiateSig(s, m));
      out.ctors = src.ctors.map((s) => this.instantiateSig(s, m));
      out.index = src.index.map((ix) => ({ key: ix.key, type: this.instantiate(ix.type, m), readonly: ix.readonly }));
      return out;
    }, { literal: t.literal, name: t.name && !t.decl ? undefined : undefined });
  }

  instantiateSig(s: Sig, m: Mapper): Sig {
    if (m.size === 0) return s;
    const pred = s.pred;
    return sig(
      () => s.params().map((p) => ({ ...p, type: this.instantiate(p.type, m) })),
      () => this.instantiate(s.ret(), m),
      {
        tparams: s.tparams.filter((tp) => !m.has(tp.id)),
        method: s.method,
        decl: s.decl,
        tdefault: s.tdefault
          ? (tp) => {
              const d = s.tdefault!(tp);
              return d && this.instantiate(d, m);
            }
          : undefined,
        pred: pred
          ? () => {
              const r = pred();
              return r && { index: r.index, type: this.instantiate(r.type, m) };
            }
          : undefined,
      },
    );
  }

  // ---- properties ----

  arrayIface(elem: Type, ro: boolean): Obj | undefined {
    return this.libInterface(ro ? "ReadonlyArray" : "Array", [elem]);
  }

  /** The type whose members a value of `t` has: a string has String's. */
  apparent(t: Type): Type {
    switch (t.k) {
      case "string":
      case "tpl":
        return this.libInterface("String") ?? t;
      case "number":
        return this.libInterface("Number") ?? t;
      case "lit":
        return this.libInterface(typeof t.value === "string" ? "String" : typeof t.value === "number" ? "Number" : "Boolean") ?? t;
      case "array":
        return this.arrayIface(t.elem(), t.ro) ?? t;
      case "tuple":
        return this.arrayIface(union(t.elems), t.ro) ?? t;
      case "tparam": {
        const c = t.constraint();
        return c ? this.apparent(c) : T.unknown;
      }
      case "deferred": {
        const r = this.resolveDeferred(t);
        return r ? this.apparent(r) : T.unknown;
      }
      case "object":
        return obj(emptyMembers);
      default:
        return t;
    }
  }

  getProp(t: Type, name: string): Prop | undefined {
    if (t.k === "union") {
      const parts: Prop[] = [];
      for (const m of t.types) {
        const p = this.getProp(m, name);
        if (!p) return undefined;
        parts.push(p);
      }
      return prop(name, () => union(parts.map((p) => p.type())), parts.some((p) => p.optional), parts.some((p) => p.readonly), parts[0].decl);
    }
    if (t.k === "inter") {
      const parts = t.types.map((m) => this.getProp(m, name)).filter((p): p is Prop => !!p);
      if (parts.length === 0) return undefined;
      if (parts.length === 1) return parts[0];
      return prop(name, () => intersection(parts.map((p) => p.type())), parts.every((p) => p.optional), parts.some((p) => p.readonly), parts[0].decl);
    }
    if (t.k === "tuple") {
      if (/^\d+$/.test(name)) {
        const i = Number(name);
        if (i < t.elems.length && !(t.rest && i === t.elems.length - 1)) return prop(name, t.optional[i] ? union([t.elems[i], T.undefined]) : t.elems[i], t.optional[i], t.ro);
        if (t.rest) return prop(name, t.elems[t.elems.length - 1], false, t.ro);
        return undefined;
      }
      if (name === "length" && !t.rest && !t.optional.some(Boolean)) return prop(name, lit(t.elems.length), false, true);
    }
    const a = this.apparent(t);
    if (a.k !== "obj") return a.k === "inter" ? this.getProp(a, name) : undefined;
    const m = a.members();
    const own = m.props.get(name);
    if (own) return own;
    for (const ix of m.index) if (this.keyMatches(ix.key, name)) return prop(name, ix.type, false, ix.readonly);
    return undefined;
  }

  private keyMatches(key: Type, name: string): boolean {
    switch (key.k) {
      case "string":
        return true;
      case "number":
        return name !== "" && !Number.isNaN(Number(name));
      case "tpl":
        return tplMatches(key, name);
      case "lit":
        return String(key.value) === name;
      case "union":
        return key.types.some((k) => this.keyMatches(k, name));
      default:
        return false;
    }
  }

  private deferredCache = new Map<string, Type>();

  deferred(op: "keyof" | "index", a: Type, b?: Type): Type {
    const key = `${op}:${a.id}:${b?.id ?? ""}`;
    let t = this.deferredCache.get(key);
    if (!t) {
      t = { k: "deferred", id: newId(), op, a, b };
      this.deferredCache.set(key, t);
    }
    return t;
  }

  private isGeneric(t: Type): boolean {
    return t.k === "tparam" || t.k === "deferred";
  }

  /** A deferred type as far as its parameters' constraints let it be worked out. */
  private resolveDeferred(t: Type & { k: "deferred" }): Type | undefined {
    const bound = (x: Type): Type => (x.k === "tparam" ? (x.constraint() ?? T.unknown) : x.k === "deferred" ? (this.resolveDeferred(x) ?? T.unknown) : x);
    if (t.op === "keyof") return union([T.string, T.number, T.symbol]);
    return this.indexedAccess(bound(t.a), bound(t.b!));
  }

  keyof(t: Type): Type {
    if (this.isGeneric(t)) return this.deferred("keyof", t);
    if (t.k === "any") return union([T.string, T.number, T.symbol]);
    if (t.k === "union") {
      const keys = t.types.map((m) => this.keyof(m));
      return keys.reduce((a, b) => filterUnion(a, (x) => this.assignable(x, b)));
    }
    const a = this.apparent(t);
    const m = a.k === "obj" ? a.members() : a.k === "inter" ? this.resolvedMembers(a) : undefined;
    if (!m) return T.never;
    const parts: Type[] = [...m.props.keys()].map((k) => lit(k));
    for (const ix of m.index) parts.push(ix.key.k === "string" ? union([T.string, T.number]) : ix.key);
    return union(parts);
  }

  indexedAccess(o: Type, i: Type): Type | undefined {
    if (i.k === "union") {
      const parts: Type[] = [];
      for (const m of i.types) {
        const r = this.indexedAccess(o, m);
        if (!r) return undefined;
        parts.push(r);
      }
      return union(parts);
    }
    if (i.k === "lit" && typeof i.value !== "boolean") {
      const p = this.getProp(o, String(i.value));
      if (p) return p.type();
      if (typeof i.value === "number") return this.numberIndex(o);
      return undefined;
    }
    if (i.k === "number") return this.numberIndex(o);
    if (i.k === "string" || i.k === "tpl") return this.stringIndex(o, i);
    if (i.k === "any") return T.error;
    return undefined;
  }

  private numberIndex(o: Type): Type | undefined {
    if (o.k === "array") return o.elem();
    if (o.k === "tuple") return union(o.elems);
    if (isStringLike(o)) return T.string;
    if (o.k === "union") {
      const parts = o.types.map((m) => this.numberIndex(m));
      return parts.every((p) => p) ? union(parts as Type[]) : undefined;
    }
    const a = this.apparent(o);
    const m = a.k === "obj" ? a.members() : undefined;
    const ix = m?.index.find((x) => x.key.k === "number" || x.key.k === "string");
    return ix?.type;
  }

  private stringIndex(o: Type, key: Type): Type | undefined {
    if (o.k === "union") {
      const parts = o.types.map((m) => this.stringIndex(m, key));
      return parts.every((p) => p) ? union(parts as Type[]) : undefined;
    }
    const a = this.apparent(o);
    const m = a.k === "obj" ? a.members() : undefined;
    const ix = m?.index.find((x) => x.key.k === "string" || (key.k === "tpl" && x.key.k === "tpl" && typeToString(x.key) === typeToString(key)));
    return ix?.type;
  }

  // ---- the lib's utility types ----

  private intrinsicAlias(name: string, args: Type[], n: A.TypeRef): Type {
    const arity: Record<string, number> = { Pick: 2, Record: 2, Exclude: 2, Extract: 2, Omit: 2 };
    const want = arity[name] ?? 1;
    if (args.length !== want) {
      this.error(n, `Generic type '${name}' requires ${want} type argument${want === 1 ? "" : "s"}.`);
      return T.error;
    }
    return this.applyIntrinsic(name, args);
  }

  private applyIntrinsic(name: string, args: Type[]): Type {
    const deferred = args.some((a) => a.k === "tparam" || (a.k === "obj" && a.name?.includes("<") && a.decl === undefined && false));
    const shown = `${name}<${args.map((a) => typeToString(a)).join(", ")}>`;
    if (deferred && !["Record"].includes(name)) {
      return obj(() => {
        const a0 = args[0];
        const c = a0.k === "tparam" ? a0.constraint() : undefined;
        if (!c) return emptyMembers();
        const r = this.applyIntrinsic(name, [c, ...args.slice(1)]);
        return this.resolvedMembers(r) ?? emptyMembers();
      }, { name: shown, instantiate: (m) => this.applyIntrinsic(name, args.map((a) => this.instantiate(a, m))) });
    }
    const [a, b] = args;
    const mapProps = (t: Type, fn: (p: Prop) => Prop): Type => {
      if (t.k === "union") return union(t.types.map((m) => mapProps(m, fn)));
      if (name === "Readonly" && t.k === "array") return arrayOf(t.elem, true);
      if (name === "Readonly" && t.k === "tuple") return { ...t, id: newId(), ro: true };
      if (t.k === "array" || t.k === "tuple" || isNullish(t) || t.k === "string" || t.k === "number" || t.k === "lit") return t;
      const src = this.resolvedMembers(t);
      if (!src) return t;
      return obj(() => {
        const out = emptyMembers();
        for (const [k, p] of src.props) out.props.set(k, fn(p));
        out.index = src.index.map((ix) => ({ ...ix, readonly: name === "Readonly" ? true : ix.readonly }));
        return out;
      }, { name: shown });
    };
    const keysOf = (k: Type): string[] => unionMembers(k).filter((x): x is typeof x & { k: "lit" } => x.k === "lit").map((x) => String((x as { value: unknown }).value));
    switch (name) {
      case "Partial":
        return mapProps(a, (p) => prop(p.name, () => union([p.type(), T.undefined]), true, p.readonly, p.decl));
      case "Required":
        return mapProps(a, (p) => prop(p.name, () => (p.optional ? filterUnion(p.type(), (x) => x.k !== "undefined") : p.type()), false, p.readonly, p.decl));
      case "Readonly":
        return mapProps(a, (p) => prop(p.name, p.type, p.optional, true, p.decl));
      case "Pick":
      case "Omit": {
        const keys = new Set(keysOf(b));
        const src = this.resolvedMembers(a);
        if (!src) return T.error;
        return obj(() => {
          const out = emptyMembers();
          for (const [k, p] of src.props) if (keys.has(k) === (name === "Pick")) out.props.set(k, p);
          if (name === "Omit") out.index = src.index;
          return out;
        }, { name: shown });
      }
      case "Record": {
        return obj(() => {
          const out = emptyMembers();
          for (const k of unionMembers(a)) {
            if (k.k === "lit") out.props.set(String(k.value), prop(String(k.value), b));
            else if (k.k === "string" || k.k === "number" || k.k === "tpl") out.index.push({ key: k, type: b, readonly: false });
          }
          return out;
        }, { name: shown, instantiate: (m) => this.applyIntrinsic(name, args.map((x) => this.instantiate(x, m))) });
      }
      case "Exclude":
        return filterUnion(a, (m) => !this.assignable(m, b));
      case "Extract":
        return filterUnion(a, (m) => this.assignable(m, b));
      case "NonNullable":
        return removeNullish(a);
      case "ReturnType": {
        const s = this.callSigs(a)[0];
        return s ? s.ret() : T.error;
      }
      case "Parameters": {
        const s = this.callSigs(a)[0];
        if (!s) return T.error;
        const ps = s.params();
        return { k: "tuple", id: newId(), elems: ps.map((p) => (p.rest && p.type.k === "array" ? p.type.elem() : p.type)), optional: ps.map((p) => p.optional), rest: hasRest(s), ro: false };
      }
      case "Awaited":
        return this.awaited(a);
    }
    return T.error;
  }

  callSigs(t: Type): Sig[] {
    const a = this.apparent(t);
    if (a.k === "obj") return a.members().calls;
    if (a.k === "inter") return this.resolvedMembers(a)?.calls ?? [];
    return [];
  }

  awaited(t: Type): Type {
    if (t.k === "union") return union(t.types.map((m) => this.awaited(m)));
    if (t.k === "obj" && t.decl && t.decl.file.home === "lib" && (t.decl.name === "Promise" || t.decl.name === "PromiseLike") && t.args?.length) return this.awaited(t.args[0]);
    return t;
  }

  /** What a `for ... of` loop over `t` gives each time round, or undefined when `t` can't be looped over. */
  iterElem(t: Type): Type | undefined {
    if (t.k === "any") return t;
    if (isStringLike(t)) return T.string;
    if (t.k === "array") return t.elem();
    if (t.k === "tuple") return union(t.elems);
    if (t.k === "union") {
      const parts = t.types.map((m) => this.iterElem(m));
      return parts.every((p) => p) ? union(parts as Type[]) : undefined;
    }
    if (t.k === "tparam") {
      const c = t.constraint();
      return c ? this.iterElem(c) : undefined;
    }
    if (t.k === "obj" && t.decl?.file.home === "lib" && t.args) {
      switch (t.decl.name) {
        case "Map":
        case "ReadonlyMap":
          return { k: "tuple", id: newId(), elems: [t.args[0], t.args[1]], optional: [false, false], rest: false, ro: false };
        case "Set":
        case "ReadonlySet":
        case "Iterable":
        case "IterableIterator":
        case "Iterator":
        case "IteratorObject":
          return t.args[0];
      }
    }
    return undefined;
  }

  // ---- assignability ----

  private relCache = new Map<string, boolean>();
  private relBusy = new Set<string>();

  assignable(s: Type, t: Type): boolean {
    if (s === t) return true;
    if (t.k === "any" || t.k === "unknown" || s.k === "any" || s.k === "never") return true;
    if (t.k === "never") return false;
    const key = `${s.id}:${t.id}`;
    const cached = this.relCache.get(key);
    if (cached !== undefined) return cached;
    if (this.relBusy.has(key)) return true;
    this.relBusy.add(key);
    let r: boolean;
    try {
      r = this.assignableUncached(s, t);
    } finally {
      this.relBusy.delete(key);
    }
    this.relCache.set(key, r);
    return r;
  }

  private assignableUncached(s: Type, t: Type): boolean {
    if (s.k === "union") return s.types.every((m) => this.assignable(m, t));
    if (t.k === "union") {
      if (t.types.some((m) => this.assignable(s, m))) return true;
      if (s.k === "obj" || s.k === "inter") return this.discriminatedAssignable(s, t);
      return false;
    }
    if (t.k === "inter") {
      this.noWeak++;
      try {
        return t.types.every((m) => this.assignable(s, m));
      } finally {
        this.noWeak--;
      }
    }
    if (s.k === "inter") {
      if (s.types.some((m) => this.assignable(m, t))) return true;
      if (t.k === "obj") return this.structural(s, t);
      return false;
    }
    if (s.k === "deferred") {
      const r = this.resolveDeferred(s);
      return r ? this.assignable(r, t) : false;
    }
    if (t.k === "deferred") return false;
    if (s.k === "tparam") {
      if (t.k === "tparam") return s.id === t.id;
      const c = s.constraint();
      return c ? this.assignable(c, t) : false;
    }
    if (t.k === "tparam") return false;
    switch (t.k) {
      case "string":
        return isStringLike(s);
      case "number":
        return isNumberLike(s);
      case "bigint":
      case "symbol":
      case "null":
      case "undefined":
        return s.k === t.k;
      case "void":
        return s.k === "void" || s.k === "undefined";
      case "object":
        return s.k === "obj" || s.k === "array" || s.k === "tuple" || s.k === "object";
      case "lit":
        return s.k === "lit" && s.value === t.value;
      case "tpl":
        if (s.k === "lit" && typeof s.value === "string") return tplMatches(t, s.value);
        if (s.k === "tpl") return tplCovers(t, s);
        return false;
      case "array":
        if (s.k === "array") return (!s.ro || t.ro) && this.assignable(s.elem(), t.elem());
        if (s.k === "tuple") return (!s.ro || t.ro) && s.elems.every((e) => this.assignable(e, t.elem()));
        return false;
      case "tuple":
        return this.tupleAssignable(s, t);
      case "obj":
        return this.structural(s, t);
    }
    return false;
  }

  /** `{ kind: "a", ... }` to a union of object types, when the literal's discriminant picks one member. */
  private discriminatedAssignable(s: Type, t: Type & { k: "union" }): boolean {
    void s;
    void t;
    return false;
  }

  private tupleAssignable(s: Type, t: Tuple): boolean {
    if (s.k !== "tuple") return false;
    if (s.ro && !t.ro) return false;
    const tFixed = t.rest ? t.elems.length - 1 : t.elems.length;
    const sFixed = s.rest ? s.elems.length - 1 : s.elems.length;
    for (let i = 0; i < Math.max(tFixed, sFixed); i++) {
      if (i >= tFixed) {
        if (!t.rest) return false;
        if (!this.assignable(s.elems[i], t.elems[t.elems.length - 1])) return false;
        continue;
      }
      if (i >= sFixed) {
        if (!t.optional[i]) return false;
        continue;
      }
      if (s.optional[i] && !t.optional[i]) return false;
      if (!this.assignable(s.elems[i], t.elems[i])) return false;
    }
    if (s.rest && !t.rest) return false;
    if (s.rest && t.rest) return this.assignable(s.elems[s.elems.length - 1], t.elems[t.elems.length - 1]);
    return true;
  }

  private libDeclName(t: Obj): string | undefined {
    return t.decl && t.decl.file.home === "lib" ? t.decl.name : undefined;
  }

  private structural(s: Type, t: Obj): boolean {
    if (s.k === "obj" && s.decl && s.decl === t.decl && s.args && t.args && s.args.length === t.args.length) {
      if (s.args.every((a, i) => this.assignable(a, t.args![i]))) return true;
    }
    const lib = this.libDeclName(t);
    if (lib === "Iterable" || lib === "IterableIterator") {
      const e = this.iterElem(s);
      return !!e && !!t.args && this.assignable(e, t.args[0]);
    }
    if (lib === "ArrayLike" && (s.k === "array" || s.k === "tuple" || isStringLike(s))) {
      const e = this.iterElem(s);
      return !!e && !!t.args && this.assignable(e, t.args[0]);
    }
    if (isNullish(s) || s.k === "unknown") return false;
    const tm = t.members();
    if (this.noWeak === 0 && this.isWeak(tm) && !this.sharesProps(s, tm)) return false;
    if (lib === "PromiseLike" && s.k === "obj" && this.libDeclName(s) === "Promise" && s.args && t.args) return this.assignable(s.args[0], t.args[0]);
    for (const tp of tm.props.values()) {
      const sp = this.getPropForRelation(s, tp.name);
      if (!sp) {
        if (tp.optional) continue;
        return false;
      }
      if (sp.optional && !tp.optional) return false;
      if (!this.assignable(sp.type(), tp.type())) return false;
    }
    if (tm.index.length) {
      const sm = this.resolvedMembers(s);
      for (const ix of tm.index) {
        if (s.k === "array" || s.k === "tuple") {
          if (ix.key.k === "number" || ix.key.k === "string") {
            if (!this.assignable(s.k === "array" ? s.elem() : union(s.elems), ix.type)) return false;
          }
          continue;
        }
        if (!sm) continue;
        for (const sp of sm.props.values()) if (this.keyMatches(ix.key, sp.name) && !this.assignable(sp.type(), ix.type)) return false;
        for (const six of sm.index) if (this.keyCovers(ix.key, six.key) && !this.assignable(six.type, ix.type)) return false;
      }
    }
    if (tm.calls.length) {
      const sc = this.callSigs(s);
      if (sc.length === 0) return false;
      for (const tc of tm.calls) if (!sc.some((c) => this.sigAssignable(c, tc))) return false;
    }
    return true;
  }

  private noWeak = 0;

  private isWeak(m: Members): boolean {
    return m.props.size > 0 && m.index.length === 0 && m.calls.length === 0 && m.ctors.length === 0 && [...m.props.values()].every((p) => p.optional);
  }

  /** A source has a field a weak target names, or has none at all to compare. */
  private sharesProps(s: Type, tm: Members): boolean {
    if (s.k === "union" || s.k === "inter") return true;
    const sm = this.resolvedMembers(s);
    if (!sm) return true;
    if (sm.props.size === 0 && sm.calls.length === 0 && sm.ctors.length === 0) return true;
    for (const name of tm.props.keys()) if (this.getPropForRelation(s, name)) return true;
    return false;
  }

  private keyCovers(target: Type, source: Type): boolean {
    if (target.k === "string") return true;
    return typeToString(target) === typeToString(source);
  }

  /** A property as a relation sees it: a source's own members, not ones an index signature stands in for. */
  private getPropForRelation(s: Type, name: string): Prop | undefined {
    if (s.k === "union" || s.k === "inter" || s.k === "tuple") return this.getProp(s, name);
    const a = this.apparent(s);
    if (a.k !== "obj") return a.k === "inter" ? this.getProp(a, name) : undefined;
    return a.members().props.get(name);
  }

  paramTypeAt(s: Sig, i: number): Type | undefined {
    const ps = s.params();
    const rest = ps.length > 0 && ps[ps.length - 1].rest;
    if (i < ps.length - (rest ? 1 : 0)) return ps[i].type;
    if (!rest) return undefined;
    const rt = ps[ps.length - 1].type;
    if (rt.k === "array") return rt.elem();
    if (rt.k === "tuple") return rt.elems[i - (ps.length - 1)] ?? (rt.rest ? rt.elems[rt.elems.length - 1] : undefined);
    return rt.k === "any" ? rt : T.error;
  }

  sigAssignable(s: Sig, t: Sig): boolean {
    if (s.tparams.length) {
      const m: Mapper = new Map();
      const same = s.tparams.length === t.tparams.length;
      s.tparams.forEach((tp, i) => m.set(tp.id, same ? t.tparams[i] : (tp.constraint() ?? T.unknown)));
      s = this.instantiateSig(s, m);
    }
    const sps = s.params();
    const tps = t.params();
    if (minArgs(s) > tps.length && !hasRest(t)) return false;
    const n = Math.max(sps.length, tps.length);
    for (let i = 0; i < n; i++) {
      if (i >= sps.length && !hasRest(s)) break;
      const sp = this.paramTypeAt(s, i);
      const tp = this.paramTypeAt(t, i);
      if (!sp || !tp) continue;
      if (!(this.assignable(tp, sp) || ((s.method || t.method) && this.assignable(sp, tp)))) return false;
    }
    const tr = t.ret();
    if (tr.k === "void") return true;
    if (t.pred?.() && !s.pred?.()) return false;
    return this.assignable(s.ret(), tr);
  }

  // ---- expressions ----

  private resolvedSigs = new Map<A.Node, Sig>();
  private chainBase = new Map<A.Node, Type>();

  expr(e: A.Expr, ctx?: Type): Type {
    switch (e.kind) {
      case "Ident":
        return this.identExpr(e);
      case "Num":
        return lit(e.value, true);
      case "Str":
        return lit(e.value, true);
      case "Bool":
        return lit(e.value, true);
      case "Null":
        return T.null;
      case "Template": {
        const holes = e.exprs.map((x) => this.expr(x));
        if (!e.exprs.length) return lit(e.quasis[0].cooked, true);
        if (ctx && unionMembers(ctx).some((m) => m.k === "tpl" || (m.k === "lit" && typeof m.value === "string")))
          return { k: "tpl", id: newId(), quasis: e.quasis.map((q) => q.cooked), holes: holes.map((h) => (unionMembers(h).every(isNumberLike) ? T.number : T.string)) };
        return T.string;
      }
      case "TaggedTemplate":
        this.expr(e.tag);
        for (const x of e.quasi.exprs) this.expr(x);
        return T.error;
      case "Paren":
        return this.expr(e.expr, ctx);
      case "Array":
        return this.arrayLit(e, ctx);
      case "Object":
        return this.objectLit(e, ctx);
      case "Function":
      case "Arrow":
        return this.functionExpr(e, ctx);
      case "Unary":
        return this.unary(e);
      case "Update":
        return this.update(e);
      case "Binary":
        return this.binary(e, ctx);
      case "Assign":
        return this.assign(e);
      case "Cond": {
        this.expr(e.test);
        const entry = this.flow;
        this.flow = entry && this.narrow(entry, e.test, true);
        const a = this.expr(e.cons, ctx);
        const afterA = this.flow;
        this.flow = entry && this.narrow(entry, e.test, false);
        const b = this.expr(e.alt, ctx);
        this.flow = join(afterA, this.flow);
        return union([a, b]);
      }
      case "Call":
        return this.callExpr(e);
      case "New":
        return this.newExpr(e);
      case "Member":
      case "Index":
        return this.access(e);
      case "Await":
        return this.awaited(this.expr(e.arg));
      case "As": {
        const t = this.expr(e.expr);
        if (e.type.kind === "TypeRef" && e.type.name.kind === "Ident" && e.type.name.name === "const") return t;
        return this.typeFromNode(e.type, EMPTY_ENV);
      }
      case "Satisfies": {
        const target = this.typeFromNode(e.type, EMPTY_ENV);
        const t = this.expr(e.expr, target);
        this.assignTo(e.expr, t, target, "assign");
        return t;
      }
      case "NonNull":
        return removeNullish(this.expr(e.expr));
      case "JsxElement":
        return this.jsxElementExpr(e);
      case "JsxFragment":
        this.jsxChildren(e.children, undefined, e);
        return this.jsxElement();
      default:
        forEach(e, (c) => {
          if (isExprNode(c)) this.expr(c as A.Expr);
        });
        return T.error;
    }
  }

  private identExpr(e: A.Ident): Type {
    const bf = this.boundOf(e);
    const sym = bf?.values.get(e);
    if (!sym) {
      if (e.name === "undefined") return T.undefined;
      if (bf?.typeOnlyValues.get(e)) {
        this.error(e, `'${e.name}' only refers to a type, but is being used as a value here.`);
        return T.error;
      }
      this.error(e, `Cannot find name '${e.name}'.`);
      return T.error;
    }
    if (sym.kind === "import") {
      const target = this.p.resolveAlias(sym);
      if (!target) return T.error;
      if (!target.value) {
        this.error(e, `'${e.name}' only refers to a type, but is being used as a value here.`);
        return T.error;
      }
    }
    if (this.flow) {
      const n = this.flow.get(`#${sym.id}`);
      if (n) return n.t;
    }
    return this.typeOfSym(sym);
  }

  /** The type of the expression a chain link reads from, without the undefined an earlier `?.` added. */
  private chainObject(e: A.Member | A.Index | A.Call, objT: Type, objNode: A.Expr): { t: Type; added: boolean } {
    if (e.optional) return { t: removeNullish(objT), added: hasNullish(objT) };
    if (e.inChain) {
      const base = this.chainBase.get(objNode);
      if (base) return { t: base, added: true };
    }
    return { t: objT, added: false };
  }

  private describe(e: A.Node): string | undefined {
    if (e.kind === "Ident") return e.name;
    if (e.kind === "Member" && e.prop.kind === "Ident") {
      const o = this.describe(e.object);
      return o ? `${o}.${e.prop.name}` : undefined;
    }
    if (e.kind === "Paren") return this.describe(e.expr);
    return undefined;
  }

  /** Reports reading from a value that may be null, undefined or unknown; returns what can be read from. */
  private readable(objNode: A.Node, t: Type): Type {
    if (t.k === "unknown") {
      const d = this.describe(objNode);
      this.error(objNode, d ? `'${d}' is of type 'unknown'.` : "Object is of type 'unknown'.");
      return T.error;
    }
    if (t.k === "any") return t;
    if (hasNullish(t)) {
      const ms = unionMembers(t);
      const u = ms.some((m) => m.k === "undefined" || m.k === "void");
      const n = ms.some((m) => m.k === "null");
      const what = u && n ? "'null' or 'undefined'" : u ? "'undefined'" : "'null'";
      const d = this.describe(objNode);
      if (ms.every(isNullish)) this.error(objNode, d ? `'${d}' is possibly ${what}.` : `Object is possibly ${what}.`);
      else this.error(objNode, d ? `'${d}' is possibly ${what}.` : `Object is possibly ${what}.`);
      const rest = removeNullish(t);
      return rest.k === "never" ? T.error : rest;
    }
    return t;
  }

  private access(e: A.Member | A.Index): Type {
    const objFull = this.expr(e.object);
    const { t: objT0, added } = this.chainObject(e, objFull, e.object);
    let result: Type;
    if (e.kind === "Member") {
      if (e.prop.kind !== "Ident") return T.error;
      const objT = this.readable(e.object, objT0);
      result = this.propOf(objT, e.prop.name, e.prop);
    } else {
      const it = this.expr(e.index);
      const objT = this.readable(e.object, objT0);
      result = this.elementOf(objT, it, e);
    }
    if (this.flow) {
      const key = this.refKey(e);
      const n = key ? this.flow.get(key) : undefined;
      if (n) result = n.t;
    }
    if (added || (e.inChain && this.chainBase.has(e.object) && !e.optional)) {
      this.chainBase.set(e, result);
      return union([result, T.undefined]);
    }
    if (added) this.chainBase.set(e, result);
    return result;
  }

  private propOf(objT: Type, name: string, at: A.Node): Type {
    if (objT.k === "any") return objT;
    if (objT.k === "never") {
      this.error(at, `Property '${name}' does not exist on type 'never'.`);
      return T.error;
    }
    const p = this.getProp(objT, name);
    if (!p) {
      this.error(at, `Property '${name}' does not exist on type '${typeToString(objT)}'.`);
      return T.error;
    }
    return p.type();
  }

  private elementOf(objT: Type, it: Type, e: A.Index): Type {
    if (objT.k === "any" || it.k === "any") return T.error;
    if (it.k === "tparam") {
      const c = it.constraint();
      if (c && c.k === "deferred" && c.op === "keyof" && c.a.id === objT.id) return this.deferred("index", objT, it);
      if (c && !this.isGeneric(objT)) {
        const r = this.indexedAccess(objT, c);
        if (r) return r;
      }
    }
    if (objT.k === "tuple" && it.k === "lit" && typeof it.value === "number" && !objT.rest && it.value >= objT.elems.length) {
      this.error(e.index, `Tuple type '${typeToString(objT)}' of length '${objT.elems.length}' has no element at index '${it.value}'.`);
      return T.error;
    }
    if (it.k === "lit" && typeof it.value !== "boolean") {
      const p = this.getProp(objT, String(it.value));
      if (p) return p.type();
    }
    const r = isNumberLike(it) || isStringLike(it) || it.k === "union" ? this.indexedAccess(objT, it.k === "lit" ? (typeof it.value === "number" ? T.number : it) : it) : undefined;
    if (r) return r;
    if (it.k === "lit" && typeof it.value === "number" && objT.k === "tuple") {
      this.error(e.index, `Tuple type '${typeToString(objT)}' of length '${objT.elems.length}' has no element at index '${it.value}'.`);
      return T.error;
    }
    if (!isNumberLike(it) && !isStringLike(it) && it.k !== "union") {
      this.error(e.index, `Type '${typeToString(widenLiterals(it))}' cannot be used as an index type.`);
      return T.error;
    }
    this.error(e.index, `Element implicitly has an 'any' type because expression of type '${typeToString(it.k === "lit" ? it : widenLiterals(it))}' can't be used to index type '${typeToString(objT)}'.`);
    return T.error;
  }

  private unary(e: A.Unary): Type {
    const t = this.expr(e.arg);
    switch (e.op) {
      case "!":
        return BOOLEAN;
      case "typeof":
        return union(["string", "number", "bigint", "boolean", "symbol", "undefined", "object", "function"].map((s) => lit(s)));
      case "-":
      case "~":
        if (hasNullish(t) && !unionMembers(t).every(isNullish)) this.readable(e.arg, t);
        return T.number;
      case "+":
        return T.number;
      case "delete": {
        let a = e.arg;
        while (a.kind === "Paren") a = a.expr;
        if (a.kind === "Member" && a.prop.kind === "Ident") {
          const p = this.getProp(removeNullish(this.speculate(() => this.expr((a as A.Member).object)).value), a.prop.name);
          if (p && !p.optional) this.error(a, "The operand of a 'delete' operator must be optional.");
        }
        return BOOLEAN;
      }
      default:
        return T.undefined;
    }
  }

  private checkNumeric(n: A.Expr, t: Type, side: "left" | "right" | "operand"): void {
    if (t.k === "any") return;
    if (unionMembers(t).every((m) => isNumberLike(m) || m.k === "bigint" || m.k === "never")) return;
    if (hasNullish(t) && unionMembers(removeNullish(t)).every((m) => isNumberLike(m) || m.k === "bigint")) {
      this.readable(n, t);
      return;
    }
    const msg =
      side === "operand"
        ? "An arithmetic operand must be of type 'any', 'number', 'bigint' or an enum type."
        : `The ${side}-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.`;
    this.error(n, msg);
  }

  private update(e: A.Update): Type {
    const t = this.expr(e.arg);
    this.checkNumeric(e.arg, t, "operand");
    this.checkWritable(e.arg);
    if (this.flow) {
      const key = this.refKey(e.arg);
      if (key) this.setFlow(key, e.arg, T.number);
    }
    return T.number;
  }

  /** Reports assigning to a constant, an import, a function or a read-only field. */
  private checkWritable(target: A.Expr): void {
    if (target.kind === "Paren") return this.checkWritable(target.expr);
    if (target.kind === "Ident") {
      const sym = this.boundOf(target)?.values.get(target);
      if (!sym) return;
      if (sym.kind === "const") this.error(target, `Cannot assign to '${sym.name}' because it is a constant.`);
      else if (sym.kind === "import") this.error(target, `Cannot assign to '${sym.name}' because it is an import.`);
      else if (sym.kind === "function") this.error(target, `Cannot assign to '${sym.name}' because it is a function.`);
      return;
    }
    if (target.kind === "Member" && target.prop.kind === "Ident") {
      const ot = removeNullish(this.refTypeQuiet(target.object));
      const p = this.getProp(ot, target.prop.name);
      if (p?.readonly) this.error(target.prop, `Cannot assign to '${target.prop.name}' because it is a read-only property.`);
      return;
    }
    if (target.kind === "Index") {
      const ot = removeNullish(this.refTypeQuiet(target.object));
      if ((ot.k === "array" || ot.k === "tuple") && ot.ro) this.error(target, `Index signature in type '${typeToString(ot)}' only permits reading.`);
      else if (ot.k === "obj") {
        const ix = ot.members().index.find((x) => x.readonly);
        if (ix && !ot.members().props.size) this.error(target, `Index signature in type '${typeToString(ot)}' only permits reading.`);
      }
    }
  }

  private refTypeQuiet(e: A.Expr): Type {
    return this.speculate(() => this.expr(e)).value;
  }

  private binary(e: A.Binary, ctx?: Type): Type {
    const op = e.op;
    if (op === "&&" || op === "||" || op === "??") {
      const l = this.expr(e.left, op === "&&" ? undefined : ctx);
      const entry = this.flow;
      if (op !== "??") this.flow = entry && this.narrow(entry, e.left, op === "&&");
      const r = this.expr(e.right, ctx);
      this.flow = entry;
      if (op === "&&") return union([this.falsyPart(l), r]);
      if (op === "||") return union([this.truthyPart(l), r]);
      return union([removeNullish(l), r]);
    }
    const l = this.expr(e.left);
    const r = this.expr(e.right);
    switch (op) {
      case "+": {
        if (l.k === "any" || r.k === "any") return T.error;
        const ls = unionMembers(l).every(isStringLike);
        const rs = unionMembers(r).every(isStringLike);
        if (ls || rs) return T.string;
        const ln = unionMembers(l).every(isNumberLike);
        const rn = unionMembers(r).every(isNumberLike);
        if (ln && rn) return T.number;
        if (hasNullish(l) && unionMembers(removeNullish(l)).every((m) => isNumberLike(m) || isStringLike(m))) {
          this.readable(e.left, l);
          return T.number;
        }
        if (hasNullish(r) && unionMembers(removeNullish(r)).every((m) => isNumberLike(m) || isStringLike(m))) {
          this.readable(e.right, r);
          return T.number;
        }
        if (unionMembers(l).some(isStringLike) || unionMembers(r).some(isStringLike)) return T.string;
        this.error(e, `Operator '+' cannot be applied to types '${typeToString(widenLiterals(l))}' and '${typeToString(widenLiterals(r))}'.`, e.start);
        return T.error;
      }
      case "-":
      case "*":
      case "/":
      case "%":
      case "**":
      case "&":
      case "|":
      case "^":
      case "<<":
      case ">>":
      case ">>>":
        this.checkNumeric(e.left, l, "left");
        this.checkNumeric(e.right, r, "right");
        return T.number;
      case "<":
      case ">":
      case "<=":
      case ">=": {
        if (l.k === "any" || r.k === "any") return BOOLEAN;
        const ok =
          (unionMembers(l).every(isNumberLike) && unionMembers(r).every(isNumberLike)) ||
          (unionMembers(l).every(isStringLike) && unionMembers(r).every(isStringLike));
        if (!ok) {
          if (hasNullish(l)) this.readable(e.left, l);
          else if (hasNullish(r)) this.readable(e.right, r);
          else this.error(e, `Operator '${op}' cannot be applied to types '${typeToString(widenLiterals(l))}' and '${typeToString(widenLiterals(r))}'.`);
        }
        return BOOLEAN;
      }
      case ",":
        return r;
      default:
        return BOOLEAN;
    }
  }

  truthyPart(t: Type): Type {
    return filterUnion(t, (m) => !(isNullish(m) || (m.k === "lit" && !m.value)));
  }

  falsyPart(t: Type): Type {
    return mapUnion(t, (m) => {
      if (isNullish(m)) return m;
      if (m.k === "lit") return m.value ? T.never : m;
      if (m.k === "string") return lit("");
      if (m.k === "number") return lit(0);
      if (m.k === "unknown" || m.k === "tparam" || m.k === "any") return m;
      return T.never;
    });
  }

  private assign(e: A.Assign): Type {
    const left = e.left;
    if (left.kind === "Object" || left.kind === "Array") {
      this.expr(e.right);
      return T.error;
    }
    let declared: Type;
    if (left.kind === "Ident") {
      const sym = this.boundOf(left)?.values.get(left);
      if (!sym) {
        this.identExpr(left);
        this.expr(e.right);
        return T.error;
      }
      declared = this.typeOfSym(sym);
    } else if (left.kind === "Member" || left.kind === "Index") {
      const saved = this.flow;
      declared = this.declaredOfTarget(left);
      this.flow = saved;
    } else {
      this.expr(left);
      this.expr(e.right);
      return T.error;
    }
    this.checkWritable(left);
    const r = this.expr(e.right, e.op === "=" || e.op === "??=" || e.op === "||=" || e.op === "&&=" ? declared : undefined);
    switch (e.op) {
      case "=":
      case "??=":
      case "||=":
      case "&&=":
        this.assignTo(e.right, r, declared, "assign", left.start);
        break;
      case "+=":
        if (!unionMembers(declared).every(isStringLike)) {
          this.checkNumeric(left, declared, "left");
          if (!unionMembers(r).every(isStringLike)) this.checkNumeric(e.right, r, "right");
        }
        break;
      default:
        this.checkNumeric(left, declared, "left");
        this.checkNumeric(e.right, r, "right");
    }
    if (this.flow) {
      const key = this.refKey(left);
      if (key) {
        const assigned = e.op === "=" ? r : declared;
        this.setFlow(key, left, this.narrowByAssign(declared, assigned));
      }
    }
    return e.op === "=" ? r : declared;
  }

  /** The declared type of a field being assigned: its type as written, not as narrowed. */
  private declaredOfTarget(left: A.Member | A.Index): Type {
    const objT = this.readable(left.object, this.expr(left.object));
    if (left.kind === "Member") {
      if (left.prop.kind !== "Ident") return T.error;
      const p = this.getProp(objT, left.prop.name);
      if (!p) {
        if (objT.k !== "any") this.error(left.prop, `Property '${left.prop.name}' does not exist on type '${typeToString(objT)}'.`);
        return T.error;
      }
      return p.optional ? p.type() : p.type();
    }
    const it = this.expr(left.index);
    return this.elementOf(objT, it, left);
  }

  // ---- literals ----

  private ctxProp(ctx: Type | undefined, name: string): Type | undefined {
    if (!ctx) return undefined;
    if (ctx.k === "tparam") return this.ctxProp(ctx.constraint(), name);
    const parts: Type[] = [];
    for (const m of unionMembers(ctx)) {
      if (isNullish(m) || m.k === "lit" || m.k === "string" || m.k === "number") continue;
      const p = this.getProp(m, name);
      if (p) parts.push(p.type());
    }
    return parts.length ? union(parts) : undefined;
  }

  private ctxElem(ctx: Type | undefined, i: number): Type | undefined {
    if (!ctx) return undefined;
    const parts: Type[] = [];
    for (const m of unionMembers(ctx)) {
      if (m.k === "array") parts.push(m.elem());
      else if (m.k === "tuple") {
        const e = i < m.elems.length ? m.elems[i] : m.rest ? m.elems[m.elems.length - 1] : undefined;
        if (e) parts.push(e);
      } else if (m.k === "obj" && m.decl?.file.home === "lib" && m.args && ["Iterable", "ArrayLike", "IterableIterator"].includes(m.decl.name)) parts.push(m.args[0]);
      else if (m.k === "tparam") {
        const c = m.constraint();
        const r = c && this.ctxElem(c, i);
        if (r) parts.push(r);
      }
    }
    return parts.length ? union(parts) : undefined;
  }

  private arrayLit(e: A.ArrayLit, ctx?: Type): Type {
    const tupleCtx = ctx && unionMembers(ctx).find((m): m is Tuple => m.k === "tuple");
    const types: Type[] = [];
    let spread = false;
    e.elements.forEach((el, i) => {
      if (el.kind === "Hole") {
        types.push(T.undefined);
        return;
      }
      if (el.kind === "Spread") {
        spread = true;
        const st = this.expr(el.arg, ctx);
        const it = this.iterElem(st);
        if (!it) {
          this.error(el.arg, `Type '${typeToString(st)}' must have a '[Symbol.iterator]()' method that returns an iterator.`);
          types.push(T.error);
        } else types.push(it);
        return;
      }
      types.push(this.expr(el, this.ctxElem(ctx, i)));
    });
    if (tupleCtx && !spread) return { k: "tuple", id: newId(), elems: types, optional: types.map(() => false), rest: false, ro: false };
    if (types.length === 0) return arrayOf(T.never);
    return arrayOf(union(types));
  }

  private objectLit(e: A.ObjectLit, ctx?: Type): Type {
    const props = new Map<string, Prop>();
    const index: IndexInfo[] = [];
    for (const p of e.props) {
      switch (p.kind) {
        case "Prop": {
          let name = staticKey(p.key);
          if (name === undefined && p.key.kind === "Computed") {
            const kt = this.expr(p.key.expr);
            if (kt.k === "lit" && typeof kt.value !== "boolean") name = String(kt.value);
            else {
              const vt = this.expr(p.value);
              index.push({ key: isNumberLike(kt) ? T.number : T.string, type: vt, readonly: false });
              continue;
            }
          }
          if (name === undefined) continue;
          const vt = this.expr(p.value, this.ctxProp(ctx, name));
          props.set(name, prop(name, vt, false, false, p));
          break;
        }
        case "Shorthand": {
          const vt = this.identExpr(p.name);
          props.set(p.name.name, prop(p.name.name, vt, false, false, p));
          break;
        }
        case "Method": {
          const name = staticKey(p.key);
          const ft = this.functionExpr(p, name === undefined ? undefined : this.ctxProp(ctx, name));
          if (name !== undefined) props.set(name, prop(name, ft, false, false, p));
          break;
        }
        case "Spread": {
          const st = this.expr(p.arg);
          const target = removeNullish(st);
          if (target.k === "any") {
            index.push({ key: T.string, type: T.error, readonly: false });
            break;
          }
          if (target.k === "never" && hasNullish(st)) break;
          const sm = target.k === "array" || target.k === "tuple" || isNumberLike(target) || isStringLike(target) ? undefined : this.resolvedMembers(target);
          if (!sm || target.k === "tparam") {
            if (target.k !== "tparam") this.error(p.arg, "Spread types may only be created from object types.");
            break;
          }
          const optionalAll = hasNullish(st);
          for (const [k, sp] of sm.props) props.set(k, optionalAll || sp.optional ? prop(k, sp.type, true, false, sp.decl) : prop(k, sp.type, false, false, sp.decl));
          index.push(...sm.index);
          break;
        }
        default:
          break;
      }
    }
    return obj(() => ({ props, calls: [], ctors: [], index }), { literal: true });
  }

  /** Fresh literals widened, inside lists and object literals too: what `let x = ...` holds. */
  widenDeep(t: Type, depth = 0): Type {
    if (depth > 5) return t;
    switch (t.k) {
      case "lit":
        return t.fresh ? baseOf(t) : t;
      case "union":
        return t.types.some((m) => (m.k === "lit" && m.fresh) || m.k === "obj" || m.k === "array" || m.k === "tuple") ? union(t.types.map((m) => this.widenDeep(m, depth + 1)), t.alias) : t;
      case "array": {
        const e = t.elem();
        const w = this.widenDeep(e, depth + 1);
        return w === e ? t : arrayOf(w, t.ro);
      }
      case "tuple":
        return t;
      case "obj": {
        if (!t.literal) return t;
        const m = t.members();
        let changed = false;
        const props = new Map<string, Prop>();
        for (const [k, p] of m.props) {
          const pt = p.type();
          const w = this.widenDeep(pt, depth + 1);
          if (w !== pt) changed = true;
          props.set(k, w === pt ? p : prop(k, w, p.optional, p.readonly, p.decl));
        }
        if (!changed) return t;
        return obj(() => ({ props, calls: m.calls, ctors: m.ctors, index: m.index }), { literal: true });
      }
      default:
        return t;
    }
  }

  // ---- functions ----

  contextualSig(ctx: Type | undefined): Sig | undefined {
    if (!ctx) return undefined;
    if (ctx.k === "tparam") return this.contextualSig(ctx.constraint());
    const callable = unionMembers(ctx).filter((m) => !isNullish(m) && this.callSigs(m).length > 0);
    if (callable.length !== 1) return undefined;
    const sigs = this.callSigs(callable[0]);
    return sigs[0];
  }

  private functionExpr(f: A.Arrow | A.FunctionExpr | A.Method, ctx?: Type): Type {
    const csig = this.contextualSig(ctx);
    const tps = (f.typeParams ?? []).map((tp) => this.boundOf(tp)?.decls.get(tp.name)).filter((s): s is Sym => !!s).map((s) => this.tparamOf(s));
    const visible = f.params.filter((p) => !(p.target.kind === "Ident" && p.target.name === "this"));
    const anyCtx = ctx?.k === "any";
    const params: Param[] = visible.map((p, i) => {
      let t: Type;
      if (p.type) t = this.paramDeclaredType(p, EMPTY_ENV);
      else if (anyCtx) t = ctx!;
      else if (csig && (p.rest ? true : this.paramTypeAt(csig, i) !== undefined)) {
        if (p.rest) {
          const rest: Type[] = [];
          const n = csig.params().length;
          for (let j = i; j < Math.max(n, i + 1); j++) {
            const pt = this.paramTypeAt(csig, j);
            if (pt) rest.push(pt);
          }
          t = arrayOf(rest.length ? union(rest) : T.unknown);
        } else t = this.paramTypeAt(csig, i)!;
        if (p.init) t = union([removeUndefined(t), widenLiterals(this.expr(p.init, t))]);
      } else if (p.init) t = widenLiterals(this.expr(p.init));
      else {
        this.implicitAny(p);
        t = T.error;
      }
      this.bindPattern(p.target, t, true);
      return { name: p.target.kind === "Ident" ? p.target.name : `__${i}`, type: t, optional: p.optional || !!p.init || p.rest, rest: p.rest };
    });
    const declared = f.returnType ? this.typeFromNode(f.returnType, EMPTY_ENV) : undefined;
    const ret = this.functionBody(f, declared, declared ? undefined : csig?.ret());
    const pred =
      f.returnType?.kind === "TypePredicate" && f.returnType.type && !f.returnType.asserts
        ? (() => {
            const pr = f.returnType as A.TypePredicate;
            const index = visible.findIndex((p) => p.target.kind === "Ident" && pr.param.kind === "Ident" && p.target.name === pr.param.name);
            const pt = this.typeFromNode(pr.type!, EMPTY_ENV);
            return index < 0 ? undefined : () => ({ index, type: pt });
          })()
        : undefined;
    const s = sig(params, declared ?? ret, { tparams: tps, method: f.kind === "Method", decl: f, pred });
    return fnType(s, { literal: true });
  }

  /** Checks a function's body and returns its return type: the declared one, or the one its returns give. */
  functionBody(f: A.FunctionLike, declared: Type | undefined, contextual?: Type): Type {
    if (!f.body) return declared ?? T.error;
    const isAsync = f.async;
    const declaredInner = declared && isAsync ? this.promiseArg(declared, f) : declared;
    const fc: FnCtx = { declared: declaredInner, contextual: contextual && isAsync ? this.awaited(contextual) : contextual, isAsync, returns: [], node: f };
    const savedFlow = this.flow;
    const savedBreaks = this.breaks;
    this.flow = this.inheritFlow(savedFlow);
    this.breaks = [];
    this.fnStack.push(fc);
    let endReachable: boolean;
    let returnsValue = false;
    try {
      if (f.body.kind === "Block") {
        for (const s of f.body.body) this.stmt(s);
        endReachable = this.flow !== null;
        returnsValue = fc.returns.length > 0 || this.returnedValue.has(f);
      } else {
        const t = this.expr(f.body, fc.declared ?? fc.contextual);
        if (fc.declared) this.assignTo(f.body, t, fc.declared, "return");
        fc.returns.push(t);
        endReachable = false;
        returnsValue = true;
      }
    } finally {
      this.fnStack.pop();
      this.flow = savedFlow;
      this.breaks = savedBreaks;
    }
    if (declared) {
      if (f.body.kind === "Block" && endReachable && declaredInner && !this.acceptsUndefined(declaredInner)) {
        const at = f.returnType ?? f;
        if (!returnsValue) this.error(at, "A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.");
        else this.error(at, "Function lacks ending return statement and return type does not include 'undefined'.");
      }
      return declared;
    }
    const types = [...fc.returns];
    if (!returnsValue) types.push(T.void);
    else if (endReachable) types.push(T.undefined);
    let r = union(types);
    const keep = fc.contextual && this.wantsLiterals(fc.contextual);
    if (!keep) r = this.widenDeep(r);
    return isAsync ? this.promiseOf(r) : r;
  }

  private returnedValue = new Set<A.Node>();

  private promiseArg(declared: Type, f: A.Node): Type {
    if (declared.k === "obj" && declared.decl?.file.home === "lib" && declared.decl.name === "Promise" && declared.args) return declared.args[0];
    if (declared.k === "any") return declared;
    this.error(f.kind === "FunctionDecl" || f.kind === "Function" || f.kind === "Arrow" || f.kind === "Method" ? (f.returnType ?? f) : f, `The return type of an async function or method must be the global Promise<T> type. Did you mean to write 'Promise<${typeToString(declared)}>'?`);
    return T.error;
  }

  private acceptsUndefined(t: Type): boolean {
    return unionMembers(t).some((m) => m.k === "undefined" || m.k === "void" || m.k === "any" || m.k === "unknown");
  }

  private wantsLiterals(t: Type): boolean {
    return unionMembers(t).some((m) => m.k === "lit" || m.k === "tpl" || m.k === "tparam");
  }

  /** Narrowings a function made inside a narrowed region keeps: those of names that are never assigned again. */
  private inheritFlow(f: Flow): Flow {
    const out = new Map<string, FlowEntry>();
    if (!f) return out;
    for (const [k, v] of f) if (v.root.kind === "const" || v.root.kind === "import" || ((v.root.kind === "param" || v.root.kind === "let") && !v.root.assigned)) out.set(k, v);
    return out;
  }

  /** Gives each name in a binding pattern its type, read out of `t`. */
  bindPattern(p: A.Pattern, t: Type, isParam = false): void {
    if (p.kind === "Ident") {
      const sym = this.boundOf(p)?.decls.get(p);
      if (sym) this.symTypes.set(sym, t);
      return;
    }
    const src = t.k === "any" ? t : t;
    if (p.kind === "ObjectPattern") {
      const used: string[] = [];
      for (const el of p.elements) {
        if (el.rest) {
          const sm = this.resolvedMembers(removeNullish(src));
          const restT = sm
            ? obj(() => {
                const out = emptyMembers();
                for (const [k, v] of sm.props) if (!used.includes(k)) out.props.set(k, v);
                out.index = sm.index;
                return out;
              }, { literal: true })
            : T.error;
          this.bindPattern(el.target, src.k === "any" ? src : restT);
          continue;
        }
        const name = el.key ? staticKey(el.key) : el.target.kind === "Ident" ? el.target.name : undefined;
        if (el.key?.kind === "Computed") this.expr(el.key.expr);
        let et: Type = T.error;
        if (name !== undefined) {
          used.push(name);
          if (src.k === "any") et = src;
          else {
            const readable = this.readable(el, src);
            const pr = this.getProp(readable, name);
            if (!pr) {
              const fromLiteral = el.init && readable.k === "obj" && readable.literal;
              if (fromLiteral) et = T.undefined;
              else if (readable.k !== "any") this.error(el.key ?? el.target, `Property '${name}' does not exist on type '${typeToString(readable)}'.`);
            } else et = pr.type();
          }
        }
        if (el.init) et = union([removeUndefined(et), this.widenDeep(this.expr(el.init, et))]);
        this.bindPattern(el.target, et);
      }
      void isParam;
      return;
    }
    p.elements.forEach((el, i) => {
      if (el.kind === "Hole") return;
      let et: Type;
      if (src.k === "any") et = src;
      else if (el.rest) {
        if (src.k === "tuple") et = { k: "tuple", id: newId(), elems: src.elems.slice(i), optional: src.optional.slice(i), rest: src.rest, ro: false };
        else et = arrayOf(this.iterElem(src) ?? T.error);
      } else if (src.k === "tuple") {
        if (i < src.elems.length && !(src.rest && i === src.elems.length - 1)) et = src.optional[i] ? union([src.elems[i], T.undefined]) : src.elems[i];
        else if (src.rest) et = src.elems[src.elems.length - 1];
        else {
          this.error(el, `Tuple type '${typeToString(src)}' of length '${src.elems.length}' has no element at index '${i}'.`);
          et = T.error;
        }
      } else {
        const it = this.iterElem(this.readable(el, src));
        if (!it) {
          this.error(el, `Type '${typeToString(src)}' must have a '[Symbol.iterator]()' method that returns an iterator.`);
          et = T.error;
        } else et = it;
      }
      if (el.init) et = union([removeUndefined(et), this.widenDeep(this.expr(el.init, et))]);
      this.bindPattern(el.target, et);
    });
  }

  // ---- assignment checks ----

  /** Reports `value` (of type `s`) not fitting `target`. Object literals are checked for fields the target lacks. */
  assignTo(value: A.Node, s: Type, target: Type, how: "assign" | "arg" | "return" | "prop", at?: number, display?: Type): boolean {
    const inner = value.kind === "Paren" ? (value as A.Paren).expr : value;
    if (inner.kind === "Object" && this.excess(inner, target)) return false;
    if (this.assignable(s, target)) return true;
    if (inner.kind === "Object" && this.elaborate(inner, s, target)) return false;
    const shown = this.showSource(s, target);
    const weak = removeUndefined(target);
    if (weak.k === "obj" && this.isWeak(weak.members()) && !this.sharesProps(s, weak.members()) && !hasNullish(s)) {
      this.error(value, `Type '${shown}' has no properties in common with type '${typeToString(weak)}'.`, at ?? value.start);
      return false;
    }
    const shownTarget = typeToString(display ?? target);
    const head = how === "arg" ? `Argument of type '${shown}' is not assignable to parameter of type '${shownTarget}'.` : `Type '${shown}' is not assignable to type '${shownTarget}'.`;
    const why = this.explain(s, target);
    this.error(value, why ? `${head} ${why}` : head, at ?? value.start);
    return false;
  }

  private showSource(s: Type, target: Type): string {
    const wantsLit = unionMembers(target).some((m) => m.k === "lit" || m.k === "tpl");
    return typeToString(wantsLit ? s : widenLiterals(mapUnion(s, (m) => (m.k === "lit" ? baseOf(m) : m))));
  }

  /** One level of why `s` doesn't fit `t`, as TypeScript adds it. */
  private explain(s: Type, t: Type): string | undefined {
    if (t.k !== "obj" || s.k === "union") return undefined;
    const tm = t.members();
    if (isNullish(s) || s.k === "lit" || s.k === "string" || s.k === "number") return undefined;
    const missing: string[] = [];
    for (const tp of tm.props.values()) if (!tp.optional && !this.getPropForRelation(s, tp.name)) missing.push(tp.name);
    if (missing.length === 1) return `Property '${missing[0]}' is missing in type '${typeToString(s)}' but required in type '${typeToString(t)}'.`;
    if (missing.length > 1) return `Type '${typeToString(s)}' is missing the following properties from type '${typeToString(t)}': ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? `, and ${missing.length - 4} more.` : ""}`;
    for (const tp of tm.props.values()) {
      const sp = this.getPropForRelation(s, tp.name);
      if (sp && !this.assignable(sp.type(), tp.type())) return `Types of property '${tp.name}' are incompatible. Type '${this.showSource(sp.type(), tp.type())}' is not assignable to type '${typeToString(tp.type())}'.`;
    }
    return undefined;
  }

  /** Points at the field of an object literal that doesn't fit, as TypeScript does. */
  private elaborate(o: A.ObjectLit, s: Type, target: Type): boolean {
    void s;
    if (target.k !== "obj" && target.k !== "inter") return false;
    let reported = false;
    for (const p of o.props) {
      if (p.kind !== "Prop" && p.kind !== "Shorthand") continue;
      const name = p.kind === "Prop" ? staticKey(p.key) : p.name.name;
      if (name === undefined) continue;
      const tp = this.getProp(target, name);
      if (!tp) continue;
      const valueNode = p.kind === "Prop" ? p.value : p.name;
      const vt = this.speculate(() => this.expr(valueNode, tp.type())).value;
      if (!this.assignable(vt, tp.type())) {
        const at = p.kind === "Prop" ? p.key : p.name;
        const inner = valueNode.kind === "Paren" ? valueNode.expr : valueNode;
        if (inner.kind === "Object" && this.elaborate(inner, vt, tp.type())) {
          reported = true;
          continue;
        }
        const why = this.explain(vt, tp.type());
        const head = `Type '${this.showSource(vt, tp.type())}' is not assignable to type '${typeToString(tp.type())}'.`;
        this.error(at, why ? `${head} ${why}` : head);
        reported = true;
      }
    }
    return reported;
  }

  /** Fields of an object literal that the target type doesn't have. Returns true if one was reported. */
  private excess(o: A.ObjectLit, target: Type): boolean {
    const targets = unionMembers(target).filter((m) => !isNullish(m));
    if (targets.length === 0 || targets.some((m) => m.k !== "obj" && m.k !== "inter")) return false;
    const resolved = targets.map((m) => this.resolvedMembers(m));
    if (resolved.some((m) => !m || (m.props.size === 0 && m.index.length === 0))) return false;
    if (resolved.some((m) => m!.index.some((ix) => ix.key.k === "string"))) return false;
    let reported = false;
    for (const p of o.props) {
      if (p.kind === "Spread") continue;
      const name = p.kind === "Shorthand" ? p.name.name : staticKey(p.key);
      if (name === undefined) {
        if (p.kind === "Prop" && p.key.kind === "Computed") {
          const kt = this.speculate(() => this.expr((p.key as A.Computed).expr)).value;
          if (kt.k === "lit") continue;
          if (!resolved.some((m) => m!.index.some((ix) => ix.key.k === "string"))) {
            this.error(p.key, `Type '{ [x: string]: ... }' is not assignable to type '${typeToString(target)}'. An index signature for type 'string' is missing in type '${typeToString(target)}'.`);
            reported = true;
          }
        }
        continue;
      }
      const found = targets.some((m) => this.getProp(m, name));
      if (!found) {
        const at = p.kind === "Shorthand" ? p.name : p.key;
        const shownKey = p.kind !== "Shorthand" && p.key.kind === "Computed" ? `[${JSON.stringify(name)}]` : name;
        this.error(at, `Object literal may only specify known properties, and '${shownKey}' does not exist in type '${typeToString(target)}'.`);
        reported = true;
        continue;
      }
      if (p.kind === "Prop") {
        const v = p.value.kind === "Paren" ? p.value.expr : p.value;
        if (v.kind === "Object") {
          const pt = this.ctxProp(target, name);
          if (pt && this.excess(v, pt)) reported = true;
        }
      }
    }
    return reported;
  }

  // ---- statements ----

  stmt(s: A.Statement): void {
    if (this.flow === null) {
      this.flow = new Map();
      this.stmtReachable(s);
      this.flow = null;
      return;
    }
    this.stmtReachable(s);
  }

  private stmtReachable(s: A.Statement): void {
    switch (s.kind) {
      case "VarDecl":
        for (const d of s.decls) this.varDeclarator(d, s.declKind);
        return;
      case "FunctionDecl":
        return this.functionDeclStmt(s);
      case "TypeAlias":
        this.typeFromNode(s.type, EMPTY_ENV);
        for (const tp of s.typeParams ?? []) if (tp.constraint) this.typeFromNode(tp.constraint, EMPTY_ENV);
        return;
      case "Interface":
        for (const e of s.extends) this.typeFromNode(e, EMPTY_ENV);
        this.checkMemberTypes(s.members);
        return;
      case "Import":
        return this.importStmt(s);
      case "ExportDefault":
        this.expr(s.expr);
        return;
      case "Block":
        for (const x of s.body) this.stmt(x);
        return;
      case "ExprStmt":
        this.expr(s.expr);
        return;
      case "If": {
        this.expr(s.test);
        const entry = this.flow!;
        this.flow = this.narrow(entry, s.test, true);
        this.stmt(s.then);
        const afterThen = this.flow;
        this.flow = this.narrow(entry, s.test, false);
        if (s.else) this.stmt(s.else);
        this.flow = join(afterThen, this.flow);
        return;
      }
      case "While":
      case "DoWhile":
      case "For":
      case "ForOf":
      case "ForIn":
        return this.loop(s);
      case "Return": {
        const fc = this.fnStack[this.fnStack.length - 1];
        if (s.arg) {
          const want = fc?.declared ?? fc?.contextual;
          const t = this.expr(s.arg, want);
          if (fc) {
            this.returnedValue.add(fc.node);
            if (fc.declared) this.assignTo(s.arg, t, fc.declared, "return");
            else fc.returns.push(t);
          }
        } else if (fc) {
          if (fc.declared && !this.acceptsUndefined(fc.declared)) this.error(s, `Type 'undefined' is not assignable to type '${typeToString(fc.declared)}'.`);
          if (!fc.declared) fc.returns.push(T.undefined);
        }
        this.flow = null;
        return;
      }
      case "Break": {
        const target = this.breaks[this.breaks.length - 1];
        if (target) target.flows.push(this.flow);
        this.flow = null;
        return;
      }
      case "Continue":
        this.flow = null;
        return;
      case "Throw":
        this.expr(s.arg);
        this.flow = null;
        return;
      case "Try":
        return this.tryStmt(s);
      case "Switch":
        return this.switchStmt(s);
      case "Labeled":
        return this.stmt(s.body);
      case "With":
        this.expr(s.object);
        return this.stmt(s.body);
      case "Namespace":
        for (const x of s.body) this.stmt(x);
        return;
      default:
        return;
    }
  }

  private checkMemberTypes(ms: A.TypeMember[]): void {
    for (const m of ms) {
      if (m.kind === "PropSig") {
        if (m.type) this.typeFromNode(m.type, EMPTY_ENV);
      } else if (m.kind === "IndexSig") {
        this.typeFromNode(m.keyType, EMPTY_ENV);
        this.typeFromNode(m.type, EMPTY_ENV);
      } else {
        for (const p of m.params) if (p.type) this.typeFromNode(p.type, EMPTY_ENV);
        if (m.returnType) this.typeFromNode(m.returnType.kind === "TypePredicate" && m.returnType.type ? m.returnType.type : m.returnType, EMPTY_ENV);
      }
    }
  }

  private importStmt(s: A.Import): void {
    const bf = this.boundOf(s);
    for (const spec of s.named ?? []) {
      const sym = bf?.decls.get(spec.local);
      if (!sym) continue;
      const from = s.source.value;
      const known = from.startsWith(".") ? this.p.resolveAlias(sym) !== undefined || !this.relativeExists(s) : this.p.modules.has(from) ? this.p.resolveAlias(sym) !== undefined : true;
      if (!known) this.error(spec.imported, `Module '"${from}"' has no exported member '${sym.importName}'.`);
    }
  }

  private relativeExists(s: A.Import): boolean {
    const bf = this.boundOf(s);
    if (!bf) return false;
    const from = s.source.value;
    const dir = bf.file.path.includes("/") ? bf.file.path.slice(0, bf.file.path.lastIndexOf("/")).split("/") : [];
    for (const part of from.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    const joined = dir.join("/");
    return this.p.files.has(joined.endsWith(".thx") ? joined : `${joined}.thx`);
  }

  private functionDeclStmt(f: A.FunctionDecl): void {
    if (!f.body) return;
    if (this.checkedDecls.has(f)) return;
    if (!f.returnType) {
      this.inferredReturn(f);
      return;
    }
    this.checkedDecls.add(f);
    const declared = this.typeFromNode(f.returnType, EMPTY_ENV);
    this.atTop(() => {
      this.bindDeclaredParams(f);
      this.functionBody(f, declared.k === "lit" ? declared : declared.k === "union" && f.returnType?.kind === "TypePredicate" ? declared : declared);
    });
  }

  /** A declared function's parameters as its body sees them. */
  private bindDeclaredParams(f: A.FunctionDecl | A.FunctionExpr): void {
    for (const p of f.params) {
      if (p.target.kind === "Ident" && p.target.name === "this") continue;
      let t: Type;
      if (p.type) t = this.paramDeclaredType(p, EMPTY_ENV);
      else if (p.init) t = widenLiterals(this.expr(p.init));
      else {
        this.implicitAny(p);
        t = T.error;
      }
      if (p.init && p.type) {
        const it = this.expr(p.init, t);
        this.assignTo(p.init, it, t, "assign");
        t = removeUndefined(t);
      }
      this.bindPattern(p.target, t, true);
    }
  }

  varDeclarator(d: A.VarDeclarator, kind: A.VarDecl["declKind"]): void {
    const names = patternNames(d.target);
    const bf = this.boundOf(d);
    const syms = names.map((id) => bf?.decls.get(id)).filter((s): s is Sym => !!s);
    if (this.checkedDecls.has(d) && syms.every((s) => s.topLevel)) {
      this.flowAfterDecl(d, syms);
      return;
    }
    this.checkedDecls.add(d);
    const declared = d.type ? this.typeFromNode(d.type, EMPTY_ENV) : undefined;
    let t: Type;
    let init: Type | undefined;
    if (d.init) {
      init = this.expr(d.init, declared);
      if (declared) this.assignTo(d.init, init, declared, "assign", d.target.start);
      t = declared ?? (kind === "const" ? this.widenConst(init) : this.widenDeep(init));
    } else if (declared) t = declared;
    else if (kind === "let" || kind === "var") {
      const sym = syms[0];
      const parts = sym ? sym.assignments.map((a) => this.widenDeep(this.speculate(() => this.expr(a)).value)) : [];
      t = union([T.undefined, ...parts]);
    } else t = T.error;
    this.bindPattern(d.target, t);
    if (d.target.kind === "Ident" && syms[0] && this.flow) {
      if (init && (declared?.k === "union" || !declared)) this.setFlow(`#${syms[0].id}`, d.target, declared ? this.narrowByAssign(declared, init) : t);
      else if (!d.init && !declared) this.setFlow(`#${syms[0].id}`, d.target, T.undefined);
    }
  }

  private flowAfterDecl(d: A.VarDeclarator, syms: Sym[]): void {
    void d;
    void syms;
  }

  /** `const x = ...` keeps a literal on its own but not inside lists and records. */
  private widenConst(t: Type): Type {
    if (t.k === "lit") return t;
    if (t.k === "union" && t.types.every((m) => m.k === "lit" || isNullish(m))) return t;
    return this.widenDeep(t);
  }

  narrowByAssign(declared: Type, assigned: Type): Type {
    if (declared.k !== "union") return declared.k === "unknown" || declared.k === "any" ? widenLiterals(assigned) : declared;
    const as = unionMembers(assigned);
    const kept = declared.types.filter((m) => as.some((a) => this.assignable(a, m)));
    if (kept.length === 0) return declared;
    const r = union(kept);
    if (r.k !== "union" && as.length === 1 && as[0].k === "lit" && this.assignable(as[0], r) && r.k !== "lit") return r;
    return r;
  }

  private loop(s: A.While | A.DoWhile | A.For | A.ForOf | A.ForIn): void {
    if (s.kind === "For" && s.init) {
      if (s.init.kind === "VarDecl") for (const d of s.init.decls) this.varDeclarator(d, s.init.declKind);
      else this.expr(s.init);
    }
    let elem: Type | undefined;
    if (s.kind === "ForOf" || s.kind === "ForIn") {
      const rt = this.expr(s.right);
      if (s.kind === "ForOf") {
        elem = this.iterElem(rt);
        if (!elem) {
          this.error(s.right, `Type '${typeToString(rt)}' must have a '[Symbol.iterator]()' method that returns an iterator.`);
          elem = T.error;
        }
      } else elem = T.string;
    }
    this.killAssigned(s);
    const entry = this.flow!;
    const target: BreakTarget = { kind: "loop", flows: [] };
    this.breaks.push(target);
    const infinite = (s.kind === "While" || s.kind === "For") && (!s.test || (s.test.kind === "Bool" && s.test.value));
    let after: Flow;
    try {
      if (s.kind === "ForOf" || s.kind === "ForIn") {
        this.flow = new Map(entry);
        if (s.left.kind === "VarDecl") {
          const d = s.left.decls[0];
          if (d) {
            if (d.type) this.typeFromNode(d.type, EMPTY_ENV);
            this.bindPattern(d.target, elem!);
          }
        } else this.expr(s.left);
        this.stmt(s.body);
        after = entry;
      } else if (s.kind === "DoWhile") {
        this.flow = new Map(entry);
        this.stmt(s.body);
        const end = join(this.flow, entry);
        this.flow = end;
        this.expr(s.test);
        after = end && this.narrow(end, s.test, false);
      } else {
        if (s.test) this.expr(s.test);
        this.flow = s.test ? this.narrow(entry, s.test, true) : new Map(entry);
        this.stmt(s.body);
        if (s.kind === "For" && s.update) {
          this.flow ??= new Map(entry);
          this.expr(s.update);
        }
        after = infinite ? null : s.test ? this.narrow(entry, s.test, false) : entry;
      }
    } finally {
      this.breaks.pop();
    }
    this.flow = target.flows.reduce<Flow>((a, b) => join(a, b), after);
  }

  /** Forgets what is known about names a loop assigns, since the loop may come round again. */
  private killAssigned(n: A.Node): void {
    if (!this.flow) return;
    const roots = new Set<Sym>();
    const bf = this.boundOf(n);
    const visit = (x: A.Node) => {
      if (x.kind === "Assign" || x.kind === "Update") {
        let target: A.Expr = x.kind === "Assign" ? x.left : x.arg;
        while (target.kind === "Member" || target.kind === "Index" || target.kind === "Paren") target = target.kind === "Paren" ? target.expr : target.object;
        if (target.kind === "Ident") {
          const sym = bf?.values.get(target);
          if (sym) roots.add(sym);
        }
      }
      forEach(x, visit);
    };
    visit(n);
    if (!roots.size) return;
    for (const [k, v] of [...this.flow]) if (roots.has(v.root)) this.flow.delete(k);
  }

  private tryStmt(s: A.Try): void {
    this.killAssigned(s.block);
    const entry = this.flow!;
    this.flow = new Map(entry);
    for (const x of s.block.body) this.stmt(x);
    const afterTry = this.flow;
    let afterCatch: Flow = null;
    if (s.handler) {
      this.flow = new Map(entry);
      if (s.param) this.bindPattern(s.param, T.unknown);
      if (s.paramType) this.typeFromNode(s.paramType, EMPTY_ENV);
      for (const x of s.handler.body) this.stmt(x);
      afterCatch = this.flow;
    }
    let after = s.handler ? join(afterTry, afterCatch) : afterTry;
    if (s.finalizer) {
      const done = after;
      this.flow = new Map(entry);
      for (const x of s.finalizer.body) this.stmt(x);
      const finEnd = this.flow;
      after = finEnd === null ? null : done;
    }
    this.flow = after;
  }

  private switchStmt(s: A.Switch): void {
    this.expr(s.disc);
    const entry = this.flow!;
    const target: BreakTarget = { kind: "switch", flows: [] };
    this.breaks.push(target);
    let fall: Flow = null;
    const testTypes: Type[] = [];
    let hasDefault = false;
    try {
      for (const c of s.cases) {
        let caseFlow: Flow;
        if (c.test) {
          this.flow = new Map(entry);
          const tt = this.expr(c.test);
          testTypes.push(tt);
          caseFlow = this.narrowEq(entry, s.disc, c.test, tt, true);
        } else {
          hasDefault = true;
          caseFlow = new Map(entry);
          for (let i = 0; i < s.cases.length; i++) {
            const other = s.cases[i];
            if (other.test && caseFlow) caseFlow = this.narrowEq(caseFlow, s.disc, other.test, this.speculate(() => this.expr(other.test!)).value, false);
          }
        }
        this.flow = join(caseFlow, fall);
        for (const x of c.body) this.stmt(x);
        fall = this.flow;
      }
    } finally {
      this.breaks.pop();
    }
    let after: Flow = target.flows.reduce<Flow>((a, b) => join(a, b), fall);
    if (!hasDefault) {
      let rest: Flow = new Map(entry);
      s.cases.forEach((c, i) => {
        if (c.test && rest) rest = this.narrowEq(rest, s.disc, c.test, testTypes[i], false);
      });
      if (rest && this.isExhausted(rest, s.disc)) rest = null;
      after = join(after, rest);
    }
    this.flow = after;
  }

  /** True when the switch's subject, or the record its field belongs to, has been narrowed to nothing. */
  private isExhausted(f: Flow, disc: A.Expr): boolean {
    if (!f) return true;
    let d = disc;
    while (d.kind === "Paren") d = d.expr;
    if (d.kind === "Unary" && d.op === "typeof") d = d.arg;
    const t = this.refType(d, f);
    if (t?.k === "never") return true;
    if ((d.kind === "Member" || d.kind === "Index") && this.refKey(d.object)) {
      const ot = this.refType(d.object, f);
      if (ot?.k === "never") return true;
    }
    return false;
  }

  // ---- narrowing ----

  refKey(e: A.Expr): string | undefined {
    switch (e.kind) {
      case "Paren":
        return this.refKey(e.expr);
      case "Ident": {
        const sym = this.boundOf(e)?.values.get(e);
        return sym ? `#${sym.id}` : undefined;
      }
      case "Member": {
        if (e.prop.kind !== "Ident") return undefined;
        const o = this.refKey(e.object);
        return o ? `${o}.${e.prop.name}` : undefined;
      }
      case "Index": {
        if (e.index.kind !== "Str" && e.index.kind !== "Num") return undefined;
        const o = this.refKey(e.object);
        return o ? `${o}.${String(e.index.value)}` : undefined;
      }
      default:
        return undefined;
    }
  }

  private rootSym(e: A.Expr): Sym | undefined {
    let x = e;
    while (x.kind === "Paren" || x.kind === "Member" || x.kind === "Index") x = x.kind === "Paren" ? x.expr : x.object;
    return x.kind === "Ident" ? this.boundOf(x)?.values.get(x) : undefined;
  }

  setFlow(key: string, e: A.Expr, t: Type): void {
    if (!this.flow) return;
    const root = this.rootSym(e);
    if (!root) return;
    for (const k of [...this.flow.keys()]) if (k.startsWith(key + ".")) this.flow.delete(k);
    this.flow.set(key, { t, root });
  }

  /** The type of a reference at a point, from what the flow knows or what was declared. Reports nothing. */
  private refType(e: A.Expr, f: Flow): Type | undefined {
    const key = this.refKey(e);
    if (key && f) {
      const n = f.get(key);
      if (n) return n.t;
    }
    switch (e.kind) {
      case "Paren":
        return this.refType(e.expr, f);
      case "Ident": {
        const sym = this.boundOf(e)?.values.get(e);
        return sym ? this.speculate(() => this.typeOfSym(sym)).value : undefined;
      }
      case "Member":
      case "Index": {
        const o = this.refType(e.object, f);
        if (!o) return undefined;
        const name = e.kind === "Member" ? (e.prop.kind === "Ident" ? e.prop.name : undefined) : e.index.kind === "Str" || e.index.kind === "Num" ? String(e.index.value) : undefined;
        if (name === undefined) return undefined;
        const base = removeNullish(o);
        const p = this.getProp(base, name);
        if (!p) return undefined;
        const t = p.type();
        return (e.optional || e.inChain) && hasNullish(o) ? union([t, T.undefined]) : t;
      }
      default:
        return undefined;
    }
  }

  private withNarrowed(f: Map<string, FlowEntry>, e: A.Expr, fn: (t: Type) => Type): Map<string, FlowEntry> {
    const key = this.refKey(e);
    const root = this.rootSym(e);
    if (!key || !root) return f;
    const cur = this.refType(e, f);
    if (!cur) return f;
    const next = fn(cur);
    if (next === cur) return f;
    const out = new Map(f);
    for (const k of [...out.keys()]) if (k.startsWith(key + ".")) out.delete(k);
    out.set(key, { t: next, root });
    return out;
  }

  /** What is known after `e` turned out truthy (`assume`) or falsy. */
  narrow(f: Map<string, FlowEntry>, e: A.Expr, assume: boolean): Map<string, FlowEntry> {
    switch (e.kind) {
      case "Paren":
        return this.narrow(f, e.expr, assume);
      case "Unary":
        if (e.op === "!") return this.narrow(f, e.arg, !assume);
        return f;
      case "Binary":
        switch (e.op) {
          case "&&":
            if (assume) return this.narrow(this.narrow(f, e.left, true), e.right, true);
            return join(this.narrow(f, e.left, false), this.narrow(this.narrow(f, e.left, true), e.right, false)) ?? f;
          case "||":
            if (assume) return join(this.narrow(f, e.left, true), this.narrow(this.narrow(f, e.left, false), e.right, true)) ?? f;
            return this.narrow(this.narrow(f, e.left, false), e.right, false);
          case "===":
          case "!==":
          case "==":
          case "!=": {
            const eq = (e.op === "===" || e.op === "==") === assume;
            const loose = e.op === "==" || e.op === "!=";
            const rt = this.speculate(() => this.expr(e.right)).value;
            const lt = this.speculate(() => this.expr(e.left)).value;
            let out = this.narrowEq(f, e.left, e.right, loose ? looseNull(rt) : rt, eq) ?? f;
            out = this.narrowEq(out, e.right, e.left, loose ? looseNull(lt) : lt, eq) ?? out;
            return out;
          }
          default:
            return f;
        }
      case "Call": {
        const s = this.resolvedSigs.get(e);
        const pred = s?.pred?.();
        if (!pred) return f;
        const arg = e.args[pred.index];
        if (!arg || arg.kind === "Spread") return f;
        return this.withNarrowed(f, arg, (cur) => {
          if (assume) {
            const kept = filterUnion(cur, (m) => this.assignable(m, pred.type));
            if (kept.k !== "never") return kept;
            if (cur.k === "unknown" || cur.k === "any") return pred.type;
            return pred.type;
          }
          return filterUnion(cur, (m) => !this.assignable(m, pred.type));
        });
      }
      case "Ident":
      case "Member":
      case "Index": {
        let out = this.withNarrowed(f, e, (cur) => (assume ? this.truthyPart(cur) : this.falsyPart(cur)));
        if ((e.kind === "Member" || e.kind === "Index") && this.refKey(e.object)) {
          const name = e.kind === "Member" ? (e.prop.kind === "Ident" ? e.prop.name : undefined) : e.index.kind === "Str" || e.index.kind === "Num" ? String(e.index.value) : undefined;
          if (name !== undefined)
            out = this.withNarrowed(out, e.object, (cur) => {
              if (cur.k !== "union") return cur;
              return filterUnion(cur, (m) => {
                if (isNullish(m)) return !assume;
                const p = this.getProp(m, name);
                if (!p) return true;
                const pt = p.type();
                return (assume ? this.truthyPart(pt) : this.falsyPart(pt)).k !== "never";
              });
            });
        }
        if (assume) {
          let x: A.Expr = e;
          while (x.kind === "Member" || x.kind === "Index") {
            const o: A.Expr = x.object;
            if (x.optional || x.inChain) out = this.withNarrowed(out, o, (cur) => removeNullish(cur));
            x = o;
          }
        }
        return out;
      }
      case "Assign":
        return this.narrow(f, e.left, assume);
      default:
        return f;
    }
  }

  /** What is known after `ref === other` turned out true (`eq`) or false. */
  narrowEq(f: Map<string, FlowEntry>, ref: A.Expr, otherNode: A.Expr, other: Type, eq: boolean): Map<string, FlowEntry> {
    let r = ref;
    while (r.kind === "Paren") r = r.expr;
    if (r.kind === "Unary" && r.op === "typeof") {
      if (other.k !== "lit" || typeof other.value !== "string") return f;
      const name = other.value;
      return this.withNarrowed(f, r.arg, (cur) => this.narrowTypeof(cur, name, eq));
    }
    void otherNode;
    const unit = other.k === "lit" || other.k === "null" || other.k === "undefined" || (other.k === "union" && other.types.every((m) => m.k === "null" || m.k === "undefined"));
    let out = f;
    if (this.refKey(r)) {
      out = this.withNarrowed(out, r, (cur) => {
        if (eq) {
          if (!unit) return cur;
          if (cur.k === "unknown") return other.k === "lit" ? regular(other) : other;
          return union(unionMembers(cur).flatMap((m) => (this.assignable(m, other) ? [m] : this.assignable(other.k === "lit" ? regular(other) : other, m) ? [other.k === "lit" ? regular(other) : other] : [])));
        }
        if (!unit) return cur;
        return filterUnion(cur, (m) => !(unionMembers(other).some((o) => (o.k === "lit" ? m.k === "lit" && m.value === o.value : m.k === o.k || (o.k === "undefined" && m.k === "void")))));
      });
    }
    if ((r.kind === "Member" || r.kind === "Index") && this.refKey(r.object)) {
      const name = r.kind === "Member" ? (r.prop.kind === "Ident" ? r.prop.name : undefined) : r.index.kind === "Str" || r.index.kind === "Num" ? String(r.index.value) : undefined;
      if (name !== undefined && unit) {
        out = this.withNarrowed(out, r.object, (cur) => {
          if (cur.k !== "union") return cur;
          return filterUnion(cur, (m) => {
            if (isNullish(m)) return !eq ? true : unionMembers(other).some((o) => o.k === "undefined") && (r as A.Member).optional;
            const p = this.getProp(m, name);
            if (!p) return !eq;
            const pt = p.type();
            if (eq) return unionMembers(pt).some((x) => this.assignable(x, other) || this.assignable(other, x));
            return !(pt.k === "lit" && other.k === "lit" && pt.value === other.value) && !(isNullish(pt) && pt.k === other.k);
          });
        });
      }
    }
    return out;
  }

  private narrowTypeof(cur: Type, name: string, eq: boolean): Type {
    const is = (m: Type): boolean | undefined => {
      switch (name) {
        case "string":
          return isStringLike(m);
        case "number":
          return isNumberLike(m);
        case "boolean":
          return isLitOf(m, "boolean");
        case "bigint":
          return m.k === "bigint";
        case "symbol":
          return m.k === "symbol";
        case "undefined":
          return m.k === "undefined" || m.k === "void";
        case "function":
          return m.k === "obj" && this.callSigs(m).length > 0;
        case "object":
          return m.k === "null" || m.k === "array" || m.k === "tuple" || m.k === "object" || (m.k === "obj" && this.callSigs(m).length === 0);
      }
      return undefined;
    };
    if (cur.k === "unknown" || cur.k === "any") {
      if (!eq) return cur;
      switch (name) {
        case "string":
          return T.string;
        case "number":
          return T.number;
        case "boolean":
          return BOOLEAN;
        case "undefined":
          return T.undefined;
        case "object":
          return union([T.object, T.null]);
        case "function":
          return this.libInterface("Function") ?? cur;
        default:
          return cur;
      }
    }
    return filterUnion(cur, (m) => {
      if (m.k === "tparam" || m.k === "unknown" || m.k === "any") return true;
      const r = is(m);
      return r === undefined ? true : r === eq;
    });
  }

  // ---- calls ----

  private callExpr(e: A.Call): Type {
    const callee = e.callee;
    if (callee.kind === "Super" || callee.kind === "ImportCall") {
      for (const a of e.args) this.expr(a.kind === "Spread" ? a.arg : a);
      return T.error;
    }
    const full = this.expr(callee);
    const { t: base0, added } = this.chainObject(e, full, callee);
    let base = base0;
    if (!e.optional && base.k !== "any" && hasNullish(base) && unionMembers(base).some((m) => !isNullish(m))) {
      const d = this.describe(callee);
      this.error(callee, d ? `Cannot invoke an object which is possibly 'undefined'.` : "Cannot invoke an object which is possibly 'undefined'.");
      base = removeNullish(base);
    }
    let r: Type;
    if (base.k === "any") {
      for (const a of e.args) this.expr(a.kind === "Spread" ? a.arg : a, base);
      r = base;
    } else {
      const sigs = this.callSigs(base);
      if (!sigs.length) {
        this.error(callee, `This expression is not callable. Type '${typeToString(base)}' has no call signatures.`);
        for (const a of e.args) this.expr(a.kind === "Spread" ? a.arg : a);
        r = T.error;
      } else r = this.resolveCall(e, sigs, e.args, e.typeArgs);
    }
    if (added) {
      this.chainBase.set(e, r);
      return union([r, T.undefined]);
    }
    return r;
  }

  private newExpr(e: A.New): Type {
    const ct = this.expr(e.callee);
    const args = e.args ?? [];
    if (ct.k === "any") {
      for (const a of args) this.expr(a.kind === "Spread" ? a.arg : a);
      return ct;
    }
    const a = this.apparent(ct);
    const sigs = a.k === "obj" ? a.members().ctors : [];
    if (!sigs.length) {
      if (this.callSigs(ct).length) this.error(e, "'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.");
      else this.error(e.callee, `This expression is not constructable. Type '${typeToString(ct)}' has no construct signatures.`);
      for (const x of args) this.expr(x.kind === "Spread" ? x.arg : x);
      return T.error;
    }
    return this.resolveCall(e, sigs, args, e.typeArgs);
  }

  private resolveCall(node: A.Call | A.New, sigs: Sig[], args: (A.Expr | A.Spread)[], typeArgNodes?: A.TypeNode[]): Type {
    const n = args.length;
    const spread = args.some((a) => a.kind === "Spread");
    const fits = (s: Sig) => {
      if (typeArgNodes && typeArgNodes.length > s.tparams.length) return false;
      if (spread) return true;
      const max = hasRest(s) ? Infinity : s.params().length;
      return n >= minArgs(s) && n <= max;
    };
    const candidates = sigs.filter(fits);
    if (!candidates.length) {
      const min = Math.min(...sigs.map(minArgs));
      const max = Math.max(...sigs.map((s) => (hasRest(s) ? Infinity : s.params().length)));
      const at = n > max ? args[max] : undefined;
      let msg: string;
      if (typeArgNodes && sigs.every((s) => typeArgNodes.length > s.tparams.length)) msg = `Expected ${Math.max(...sigs.map((s) => s.tparams.length))} type arguments, but got ${typeArgNodes.length}.`;
      else if (max === Infinity) msg = `Expected at least ${min} arguments, but got ${n}.`;
      else if (min === max) msg = `Expected ${min} argument${min === 1 ? "" : "s"}, but got ${n}.`;
      else msg = `Expected ${min}-${max} arguments, but got ${n}.`;
      this.error(at ?? node, msg, at ? at.start : node.start);
      for (const a of args) this.expr(a.kind === "Spread" ? a.arg : a);
      const s0 = sigs[0];
      return s0.tparams.length ? this.instantiateSig(s0, new Map(s0.tparams.map((tp) => [tp.id, T.error]))).ret() : s0.ret();
    }
    if (candidates.length === 1) return this.applySig(node, candidates[0], args, typeArgNodes);
    for (const c of candidates) {
      const { ok } = this.speculate(() => this.applySig(node, c, args, typeArgNodes));
      if (ok) return this.applySig(node, c, args, typeArgNodes);
    }
    const last = candidates[candidates.length - 1];
    let firstErr = "";
    const before = this.errors.length;
    const spec = this.spec;
    this.spec = 0;
    const errsBefore = this.errors.length;
    let r: Type;
    const saved = this.errors.splice(0);
    try {
      r = this.applySig(node, last, args, typeArgNodes);
      firstErr = this.errors[errsBefore - errsBefore]?.message ?? "";
    } finally {
      this.errors.length = 0;
      this.errors.push(...saved);
      this.spec = spec;
    }
    void before;
    const at = args.find((a) => a.kind !== "Spread") ?? node;
    this.error(at, `No overload matches this call.${firstErr ? ` The last overload gave the following error. ${firstErr}` : ""}`);
    return r;
  }

  private applySig(node: A.Call | A.New, s: Sig, args: (A.Expr | A.Spread)[], typeArgNodes?: A.TypeNode[]): Type {
    let inst = s;
    if (s.tparams.length) {
      let m: Mapper;
      if (typeArgNodes?.length) {
        m = new Map();
        s.tparams.forEach((tp, i) => {
          const tn = typeArgNodes[i];
          m.set(tp.id, tn ? this.typeFromNode(tn, EMPTY_ENV) : (tp.constraint() ?? T.unknown));
        });
      } else m = this.inferArgs(s, args);
      inst = this.instantiateSig(s, m);
    }
    this.resolvedSigs.set(node, inst);
    args.forEach((a, i) => {
      if (a.kind === "Spread") {
        const st = this.expr(a.arg);
        const it = this.iterElem(st);
        if (!it) this.error(a.arg, `Type '${typeToString(st)}' must have a '[Symbol.iterator]()' method that returns an iterator.`);
        else {
          const pt = this.paramTypeAt(inst, i);
          if (pt && st.k !== "tuple" && !this.assignable(it, pt)) this.error(a.arg, `Argument of type '${typeToString(st)}' is not assignable to parameter of type '${typeToString(pt)}'.`);
        }
        return;
      }
      const pt = this.paramTypeAt(inst, i);
      const at = this.expr(a, pt);
      if (pt) this.assignTo(a, at, pt, "arg");
    });
    return inst.ret();
  }

  private contextSensitive(e: A.Expr | A.Spread): boolean {
    switch (e.kind) {
      case "Arrow":
      case "Function":
        return e.params.some((p) => !p.type);
      case "Object":
        return e.props.some((p) => p.kind === "Method" || (p.kind === "Prop" && this.contextSensitive(p.value)));
      case "Array":
        return e.elements.some((x) => x.kind !== "Hole" && this.contextSensitive(x));
      case "Paren":
        return this.contextSensitive(e.expr);
      case "Cond":
        return this.contextSensitive(e.cons) || this.contextSensitive(e.alt);
      default:
        return false;
    }
  }

  /** Infers a generic signature's type arguments from the arguments of a call. */
  private inferArgs(s: Sig, args: (A.Expr | A.Spread)[]): Mapper {
    const ids = new Set(s.tparams.map((tp) => tp.id));
    const cands = new Map<number, Type[]>(s.tparams.map((tp) => [tp.id, []]));
    const infer = (p: Type, src: Type) => this.inferFrom(p, src, ids, cands, 0, new Set());
    const fixed = (): Mapper => {
      const m: Mapper = new Map();
      for (const tp of s.tparams) {
        const c = cands.get(tp.id)!;
        if (c.length) m.set(tp.id, this.fix(s, tp, c));
      }
      return m;
    };
    this.speculate(() => {
      args.forEach((a, i) => {
        if (a.kind === "Spread" || this.contextSensitive(a)) return;
        const pt = this.paramTypeAt(s, i);
        if (!pt) return;
        infer(pt, this.expr(a, pt));
      });
      args.forEach((a, i) => {
        if (a.kind === "Spread" || !this.contextSensitive(a)) return;
        const pt = this.paramTypeAt(s, i);
        if (!pt) return;
        const ctx = this.instantiate(pt, fixed());
        infer(pt, this.expr(a, ctx));
      });
    });
    const m: Mapper = new Map();
    for (const tp of s.tparams) {
      const c = cands.get(tp.id)!;
      m.set(tp.id, c.length ? this.fix(s, tp, c) : (s.tdefault?.(tp) ?? tp.constraint() ?? T.unknown));
    }
    return this.checkConstraints(s, m);
  }

  /** The type argument a type parameter's inferences give, chosen the way TypeScript does. */
  private fix(s: Sig, tp: TParam, cands: Type[]): Type {
    const real = cands.filter((c) => !(c.k === "any" && c.error));
    const list = real.length ? real : cands;
    const c = tp.constraint();
    const primitive = !!c && (c.k === "deferred" || unionMembers(c).some((m) => m.k === "string" || m.k === "number" || m.k === "lit"));
    const ret = s.ret();
    const topLevel = unionMembers(ret).some((m) => m.k === "tparam" && m.id === tp.id);
    const widen = !primitive && !topLevel;
    const base = list.map((x) => (widen ? this.widenDeep(x) : x));
    const flat = base.flatMap((x) => unionMembers(x));
    const sameLiteralBase = flat.every((x) => x.k === "lit") && flat.every((x) => typeof (x as { value: unknown }).value === typeof (flat[0] as { value: unknown }).value);
    if (sameLiteralBase || base.length === 1) return union(base);
    return base.reduce((acc, x) => (this.assignable(acc, x) ? x : acc));
  }

  /** Each inferred type argument that breaks its parameter's constraint becomes the constraint. */
  private checkConstraints(s: Sig, m: Mapper): Mapper {
    for (const tp of s.tparams) {
      const c = tp.constraint();
      const t = m.get(tp.id);
      if (!c || !t) continue;
      const ci = this.instantiate(c, m);
      if (!this.assignable(t, ci)) m.set(tp.id, ci);
    }
    return m;
  }

  private containsAny(t: Type, ids: Set<number>, depth = 0): boolean {
    if (depth > 4) return true;
    switch (t.k) {
      case "tparam":
        return ids.has(t.id);
      case "union":
      case "inter":
        return t.types.some((m) => this.containsAny(m, ids, depth + 1));
      case "array":
        return this.containsAny(t.elem(), ids, depth + 1);
      case "tuple":
        return t.elems.some((m) => this.containsAny(m, ids, depth + 1));
      case "obj":
        if (t.decl && t.args) return t.args.some((m) => this.containsAny(m, ids, depth + 1));
        return true;
      default:
        return false;
    }
  }

  private inferFrom(p: Type, src: Type, ids: Set<number>, cands: Map<number, Type[]>, depth: number, seen: Set<string>): void {
    if (depth > 8) return;
    const key = `${p.id}:${src.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rec = (a: Type, b: Type) => this.inferFrom(a, b, ids, cands, depth + 1, seen);
    if (p.k === "tparam") {
      if (ids.has(p.id) && !(src.k === "tparam" && ids.has(src.id))) cands.get(p.id)!.push(src);
      return;
    }
    if (p.k === "union") {
      const naked = p.types.filter((m): m is TParam => m.k === "tparam" && ids.has(m.id));
      const others = p.types.filter((m) => !(m.k === "tparam" && ids.has(m.id)));
      const srcs = unionMembers(src);
      const count = () => [...cands.values()].reduce((n, c) => n + c.length, 0);
      const unmatched = srcs.filter((sm) => {
        if (others.some((o) => !this.containsAny(o, ids) && this.assignable(sm, o))) return false;
        const before = count();
        for (const o of others) if (this.containsAny(o, ids)) this.inferFrom(o, sm, ids, cands, depth + 1, new Set(seen));
        return count() === before;
      });
      if (naked.length === 1 && unmatched.length) cands.get(naked[0].id)!.push(union(unmatched));
      return;
    }
    if (src.k === "union") {
      for (const sm of src.types) rec(p, sm);
      return;
    }
    if (p.k === "array") {
      if (src.k === "array") rec(p.elem(), src.elem());
      else if (src.k === "tuple") rec(p.elem(), union(src.elems));
      return;
    }
    if (p.k === "tuple") {
      if (src.k === "tuple") p.elems.forEach((e, i) => src.elems[i] && rec(e, src.elems[i]));
      else if (src.k === "array") for (const e of p.elems) rec(e, src.elem());
      return;
    }
    if (p.k === "inter") {
      for (const m of p.types) rec(m, src);
      return;
    }
    if (p.k !== "obj") return;
    if (p.decl && p.args && src.k === "obj" && src.decl === p.decl && src.args) {
      p.args.forEach((a, i) => src.args![i] && rec(a, src.args![i]));
      return;
    }
    const lib = this.libDeclName(p);
    if (lib && p.args && ["Iterable", "IterableIterator", "ArrayLike"].includes(lib)) {
      const e = this.iterElem(src);
      if (e) rec(p.args[0], e);
      return;
    }
    if (lib && p.args && lib === "PromiseLike" && src.k === "obj" && this.libDeclName(src) === "Promise" && src.args) {
      rec(p.args[0], src.args[0]);
      return;
    }
    const pm = p.members();
    const sm = src.k === "obj" || src.k === "inter" ? this.resolvedMembers(src) : undefined;
    if (!sm) return;
    for (const [k, pp] of pm.props) {
      const sp = sm.props.get(k);
      if (sp) rec(pp.type(), sp.type());
    }
    for (const ix of pm.index) {
      for (const sp of sm.props.values()) if (this.keyMatches(ix.key, sp.name)) rec(ix.type, sp.type());
      for (const six of sm.index) rec(ix.type, six.type);
    }
    if (pm.calls.length && sm.calls.length) {
      const ps = pm.calls[0];
      const ss = sm.calls[sm.calls.length - 1];
      const pps = ps.params();
      pps.forEach((_, i) => {
        const a = this.paramTypeAt(ps, i);
        const b = this.paramTypeAt(ss, i);
        if (a && b) rec(a, b);
      });
      rec(ps.ret(), ss.ret());
      const pp = ps.pred?.();
      const sp = ss.pred?.();
      if (pp && sp) rec(pp.type, sp.type);
    }
  }

  // ---- JSX ----

  private intrinsicPropsOf(tag: string): Obj {
    let t = this.intrinsicProps.get(tag);
    if (t) return t;
    const attrs = attrsOf(tag);
    t = obj(() => {
      const m = emptyMembers();
      for (const [name, kind] of Object.entries(attrs)) {
        if (name === "key") continue;
        const text = attrType(tag, name, kind);
        m.props.set(name, prop(name, () => union([this.typeFromText(text), T.undefined]), true));
      }
      m.props.set("key", prop("key", () => union([T.string, T.number, T.undefined]), true));
      m.props.set("children", prop("children", () => union([this.thxNode(), T.undefined]), true));
      const loose = () => union([T.string, T.number, BOOLEAN, T.undefined]);
      m.index.push({ key: this.typeFromText("`aria-${string}`"), type: loose(), readonly: false });
      m.index.push({ key: this.typeFromText("`data-${string}`"), type: loose(), readonly: false });
      return m;
    }, { name: `JSX.IntrinsicElements["${tag}"]` });
    this.intrinsicProps.set(tag, t);
    return t;
  }

  private textTypes = new Map<string, Type>();

  private typeFromText(text: string): Type {
    let t = this.textTypes.get(text);
    if (!t) {
      t = this.typeFromNode(parseType(text), EMPTY_ENV);
      this.textTypes.set(text, t);
    }
    return t;
  }

  private jsxElementExpr(e: A.JsxElement): Type {
    const name = e.name;
    if (name.kind === "Ident" && /^[a-z]/.test(name.name)) {
      if (!isElementAllowed(name.name)) {
        this.jsxAttrsLoose(e);
        return this.jsxElement();
      }
      this.jsxAttrs(e, this.intrinsicPropsOf(name.name), true);
      return this.jsxElement();
    }
    if (name.kind !== "Ident") {
      this.jsxAttrsLoose(e);
      return this.jsxElement();
    }
    const ct = this.identExpr(name);
    if (ct.k === "any") {
      this.jsxAttrsLoose(e);
      return this.jsxElement();
    }
    const sigs = this.callSigs(removeNullish(ct));
    if (!sigs.length) {
      this.error(name, `JSX element type '${name.name}' does not have any construct or call signatures.`);
      this.jsxAttrsLoose(e);
      return this.jsxElement();
    }
    let s = sigs[0];
    if (s.tparams.length) {
      const ids = new Set(s.tparams.map((tp) => tp.id));
      const cands = new Map<number, Type[]>(s.tparams.map((tp) => [tp.id, []]));
      const pt0 = this.paramTypeAt(s, 0);
      if (pt0)
        this.speculate(() => {
          for (const a of e.attrs) {
            if (a.kind !== "JsxAttr" || a.name.kind !== "Ident") continue;
            const v = a.value;
            if (!v || v.kind !== "JsxExprContainer" || !v.expr || this.contextSensitive(v.expr)) continue;
            const target = this.ctxProp(pt0, a.name.name);
            if (target) this.inferFrom(target, this.expr(v.expr, target), ids, cands, 0, new Set());
          }
        });
      const m: Mapper = new Map();
      for (const tp of s.tparams) {
        const c = cands.get(tp.id)!;
        m.set(tp.id, c.length ? this.fix(s, tp, c) : (s.tdefault?.(tp) ?? tp.constraint() ?? T.unknown));
      }
      s = this.instantiateSig(s, m);
    }
    const ret = s.ret();
    const node = this.thxNode();
    if (!this.assignable(ret, node)) this.error(name, `'${name.name}' cannot be used as a JSX component. Its type '${typeToString(ct)}' is not a valid JSX element type.`);
    const props = this.paramTypeAt(s, 0) ?? obj(emptyMembers);
    this.jsxAttrs(e, props, false);
    return this.jsxElement();
  }

  private jsxAttrsLoose(e: A.JsxElement): void {
    for (const a of e.attrs) {
      if (a.kind === "JsxSpreadAttr") this.expr(a.arg);
      else if (a.value && a.value.kind === "JsxExprContainer" && a.value.expr) this.expr(a.value.expr);
      else if (a.value && a.value.kind !== "Str" && a.value.kind !== "JsxExprContainer") this.expr(a.value);
    }
    if (e.children) this.jsxChildren(e.children, undefined, e);
  }

  private jsxAttrs(e: A.JsxElement, props: Type, intrinsic: boolean): void {
    const given = new Set<string>();
    const shownProps = intrinsic ? typeToString(props) : `IntrinsicAttributes & ${typeToString(props)}`;
    for (const a of e.attrs) {
      if (a.kind === "JsxSpreadAttr") {
        const st = this.expr(a.arg);
        const sm = this.resolvedMembers(removeNullish(st));
        if (sm) {
          for (const [k, sp] of sm.props) {
            given.add(k);
            const tp = this.getProp(props, k);
            if (tp && !this.assignable(sp.type(), tp.type())) this.error(a.arg, `Type '${typeToString(sp.type())}' is not assignable to type '${typeToString(tp.type())}'.`);
          }
        } else if (st.k !== "any") this.error(a.arg, "Spread types may only be created from object types.");
        continue;
      }
      if (a.name.kind !== "Ident") {
        if (a.value && a.value.kind === "JsxExprContainer" && a.value.expr) this.expr(a.value.expr);
        continue;
      }
      const n = a.name.name;
      given.add(n);
      const tp = n === "key" && !intrinsic ? prop("key", union([T.string, T.number, T.undefined]), true) : this.getProp(props, n);
      const target = tp?.type();
      let vt: Type;
      const v = a.value;
      if (!v) vt = TRUE;
      else if (v.kind === "Str") vt = lit(v.value, true);
      else if (v.kind === "JsxExprContainer") vt = v.expr ? this.expr(v.expr, target) : T.error;
      else vt = this.expr(v, target);
      if (!tp) {
        if (!intrinsic && props.k !== "any") this.error(a.name, `Type '{ ${n}: ${typeToString(widenLiterals(vt))}; }' is not assignable to type '${shownProps}'. Property '${n}' does not exist on type '${shownProps}'.`);
        continue;
      }
      const valueNode: A.Node = v ? (v.kind === "JsxExprContainer" ? (v.expr ?? v) : v) : a;
      this.assignTo(valueNode, vt, target!, "assign", a.name.start, tp.optional ? removeUndefined(target!) : undefined);
    }
    const kids = this.jsxKids(e.children ?? []);
    if (kids.length) {
      given.add("children");
      const cp = this.getProp(props, "children");
      if (!cp) {
        if (!intrinsic && props.k !== "any") this.error(e.name, `Type '{ children: ... }' has no properties in common with type '${shownProps}'.`);
        this.jsxChildren(e.children ?? [], undefined, e);
      } else this.jsxChildren(e.children ?? [], cp.type(), e);
    }
    if (!intrinsic && props.k !== "any") {
      const pm = this.resolvedMembers(props);
      if (pm)
        for (const [k, p] of pm.props)
          if (!p.optional && !given.has(k) && !hasNullish(p.type())) {
            this.error(e.name, `Property '${k}' is missing in type '{ ${[...given].join("; ")}${given.size ? ";" : ""} }' but required in type '${typeToString(props)}'.`);
            break;
          }
    }
  }

  private jsxKids(children: A.JsxChild[]): A.JsxChild[] {
    return children.filter((c) => {
      if (c.kind === "JsxText") return /[^\s]/.test(c.raw);
      if (c.kind === "JsxExprContainer") return !!c.expr;
      return true;
    });
  }

  private jsxChildren(children: A.JsxChild[], target: Type | undefined, parent: A.Node): void {
    void parent;
    const kids = this.jsxKids(children);
    const elemTarget = target ? this.ctxElem(target, 0) : undefined;
    for (const c of kids) {
      if (c.kind === "JsxText") {
        if (target && !this.assignable(T.string, target) && !(elemTarget && this.assignable(T.string, elemTarget))) this.error(c, `Type 'string' is not assignable to type '${typeToString(target)}'.`, c.start + (c.raw.length - c.raw.trimStart().length));
        continue;
      }
      const node = c.kind === "JsxExprContainer" ? c.expr! : c;
      const ct = this.expr(node, kids.length > 1 ? (elemTarget ?? target) : target);
      if (!target) continue;
      if (this.assignable(ct, target) || (elemTarget && this.assignable(ct, elemTarget))) continue;
      this.error(node, `Type '${this.showSource(ct, target)}' is not assignable to type '${typeToString(target)}'.`);
    }
  }
}

/** Every string a template type `s` stands for fits the pattern `t`, judged on two very different samples. */
function tplCovers(t: { quasis: string[]; holes: Type[] }, s: { quasis: string[]; holes: Type[] }): boolean {
  const sample = (fill: (h: Type) => string) => s.quasis.reduce((acc, q, i) => acc + q + (i < s.holes.length ? fill(s.holes[i]) : ""), "");
  return tplMatches(t, sample((h) => (h.k === "number" ? "0" : ""))) && tplMatches(t, sample((h) => (h.k === "number" ? "1.5" : "\u0001q")));
}

export function tplMatches(t: { quasis: string[]; holes: Type[] }, s: string): boolean {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = "^" + esc(t.quasis[0]);
  t.holes.forEach((h, i) => {
    re += h.k === "number" ? "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?" : "[\\s\\S]*";
    re += esc(t.quasis[i + 1]);
  });
  return new RegExp(re + "$").test(s);
}

/** What two flows agree on: a name keeps a narrowed type only if both narrowed it. */
function join(a: Flow, b: Flow): Flow {
  if (a === null) return b;
  if (b === null) return a;
  if (a === b) return a;
  const out = new Map<string, FlowEntry>();
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) continue;
    out.set(k, va.t === vb.t ? va : { t: union([va.t, vb.t]), root: va.root });
  }
  return out;
}

/** `x == null` matches undefined too. */
function looseNull(t: Type): Type {
  return t.k === "null" || t.k === "undefined" ? union([T.null, T.undefined]) : t;
}

function removeUndefined(t: Type): Type {
  return filterUnion(t, (m) => m.k !== "undefined");
}

const EXPR_KINDS = new Set(["Ident", "Num", "Str", "Bool", "Null", "Template", "TaggedTemplate", "This", "Super", "Regex", "BigInt", "ImportMeta", "NewTarget", "ClassExpr", "Array", "Object", "Function", "Arrow", "Unary", "Update", "Binary", "Assign", "Cond", "Call", "New", "Member", "Index", "Paren", "Await", "Yield", "As", "Satisfies", "NonNull", "ImportCall", "JsxElement", "JsxFragment"]);

function isExprNode(n: A.Node): boolean {
  return EXPR_KINDS.has(n.kind);
}

function leftmost(n: A.QualifiedName): A.Ident {
  let x: A.Ident | A.QualifiedName = n;
  while (x.kind === "QualifiedName") x = x.left;
  return x;
}

export function staticKey(k: A.PropKey): string | undefined {
  if (k.kind === "Ident") return k.name;
  if (k.kind === "Str") return k.value;
  if (k.kind === "Num") return String(k.value);
  if (k.kind === "Computed" && (k.expr.kind === "Str" || k.expr.kind === "Num")) return String(k.expr.value);
  return undefined;
}

function forEach(n: A.Node, fn: (c: A.Node) => void): void {
  for (const key in n) {
    if (key === "parent") continue;
    const v = (n as unknown as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === "object" && "kind" in x) fn(x as A.Node);
    } else if (v && typeof v === "object" && "kind" in (v as object)) fn(v as A.Node);
  }
}

function composeEnv(env: Env, m: Mapper, c: Checker): Env {
  const map: Mapper = new Map();
  for (const [k, v] of env.map) map.set(k, c.instantiate(v, m));
  for (const [k, v] of m) if (!map.has(k)) map.set(k, v);
  return { map, thisType: env.thisType };
}

export function checkProgram(p: ProgramFiles): ThixoError[] {
  return new Checker(p).check();
}
