// Scopes and symbols. Binding a file records, for every name it reads, the declaration that name refers to, in the
// value space (what code reads) and the type space (what annotations name). The lib and each host module are bound
// once and kept; a program's files are bound on every compile.

import type * as A from "./syntax/ast.js";
import { forEachChild } from "./syntax/ast.js";

export type SymKind = "const" | "let" | "var" | "param" | "function" | "import" | "type" | "interface" | "typeParam" | "catch" | "namespace";

export type Home = "program" | "module" | "lib";

export interface Sym {
  id: number;
  name: string;
  kind: SymKind;
  /** Declaring nodes: a VarDeclarator, Param, FunctionDecl, Function, ImportSpec, TypeAlias, Interface, TypeParam,
   * Namespace or Try (for a catch binding). An interface or a function's overloads may have several. */
  decls: A.Node[];
  /** The name in the first declaration. */
  ident: A.Ident;
  file: BoundFile;
  value: boolean;
  type: boolean;
  /** Declared in the file's own scope. */
  topLevel: boolean;
  /** Assigned to, or updated with ++ or --, somewhere after its declaration. */
  assigned: boolean;
  /** For `let x;`: the right-hand sides of every `x = ...`. */
  assignments: A.Expr[];
  /** For an import: what it names. */
  importFrom?: string;
  importName?: string;
  importStyle?: "named" | "default" | "namespace";
  /** A namespace's members, such as JSX's. */
  members?: Map<string, Sym>;
}

export interface BoundFile {
  file: A.SourceFile;
  home: Home;
  /** Names read as values, by their identifier. */
  values: Map<A.Ident, Sym>;
  /** Names read as values that only name a type, such as an interface used in an expression. */
  typeOnlyValues: Map<A.Ident, Sym>;
  /** Names read as types: a type reference's first name, an `extends` target. */
  types: Map<A.Ident, Sym>;
  /** Declaring identifiers. */
  decls: Map<A.Ident, Sym>;
  /** Exported names. */
  exports: Map<string, Sym>;
  /** Names declared twice in one scope. */
  duplicates: A.Ident[];
}

interface Scope {
  values: Map<string, Sym>;
  types: Map<string, Sym>;
  parent?: Scope;
  /** A function's scope: where `var` goes. */
  fn: boolean;
}

let nextSymId = 1;

export interface GlobalScope {
  values: Map<string, Sym>;
  types: Map<string, Sym>;
}

function newScope(parent: Scope | undefined, fn = false): Scope {
  return { values: new Map(), types: new Map(), parent, fn };
}

/** The names a binding pattern declares. */
export function patternNames(p: A.Pattern): A.Ident[] {
  if (p.kind === "Ident") return [p];
  const out: A.Ident[] = [];
  for (const el of p.elements) if (el.kind === "BindingElement") out.push(...patternNames(el.target));
  return out;
}

/** References by identifier. A name the file's own scopes don't declare is looked up in the lib only when asked for,
 * so binding a file reads none of the lib. */
class Refs extends Map<A.Ident, Sym> {
  constructor(private readonly resolve: (id: A.Ident) => Sym | undefined) {
    super();
  }

  override get(id: A.Ident): Sym | undefined {
    const v = super.get(id);
    if (v !== undefined) return v;
    const r = this.resolve(id);
    if (r) super.set(id, r);
    return r;
  }
}

class Binder {
  readonly bf: BoundFile;
  private readonly deferred: Map<A.Ident, "value" | "type">;

  constructor(
    file: A.SourceFile,
    home: Home,
    private readonly global: GlobalScope | undefined,
  ) {
    const deferred = new Map<A.Ident, "value" | "type">();
    this.deferred = deferred;
    const g = global;
    this.bf = {
      file,
      home,
      values: new Refs((id) => (g && deferred.get(id) === "value" ? g.values.get(id.name) : undefined)),
      typeOnlyValues: new Refs((id) => (g && deferred.get(id) === "value" && !g.values.get(id.name) ? g.types.get(id.name) : undefined)),
      types: new Refs((id) => (g && deferred.get(id) === "type" ? g.types.get(id.name) : undefined)),
      decls: new Map(),
      exports: new Map(),
      duplicates: [],
    };
  }

  private declare(scope: Scope, id: A.Ident, kind: SymKind, decl: A.Node, space: { value: boolean; type: boolean }, top: boolean): Sym {
    const existing = (space.value ? scope.values.get(id.name) : undefined) ?? (space.type ? scope.types.get(id.name) : undefined);
    if (existing) {
      const overload = (n: A.Node) => n.kind === "FunctionDecl" && !n.body;
      const merges =
        existing.kind === kind &&
        (kind === "interface" || kind === "namespace" || (kind === "function" && (overload(decl) || overload(existing.decls[existing.decls.length - 1]))));
      if (merges) {
        existing.decls.push(decl);
        this.bf.decls.set(id, existing);
        return existing;
      }
      this.bf.duplicates.push(id);
    }
    const sym: Sym = { id: nextSymId++, name: id.name, kind, decls: [decl], ident: id, file: this.bf, value: space.value, type: space.type, topLevel: top, assigned: false, assignments: [] };
    if (space.value) scope.values.set(id.name, sym);
    if (space.type) scope.types.set(id.name, sym);
    this.bf.decls.set(id, sym);
    return sym;
  }

  /** A name in the file's own scopes. */
  private lookup(scope: Scope | undefined, name: string, space: "values" | "types"): Sym | undefined {
    for (let s = scope; s; s = s.parent) {
      const sym = s[space].get(name);
      if (sym) return sym;
    }
    return undefined;
  }

  private refValue(scope: Scope, id: A.Ident): void {
    const sym = this.lookup(scope, id.name, "values");
    if (sym) this.bf.values.set(id, sym);
    else {
      const t = this.lookup(scope, id.name, "types");
      if (t) this.bf.typeOnlyValues.set(id, t);
      else if (this.global) this.deferred.set(id, "value");
    }
  }

  private refType(scope: Scope, id: A.Ident): void {
    const sym = this.lookup(scope, id.name, "types");
    if (sym) this.bf.types.set(id, sym);
    else if (this.global) this.deferred.set(id, "type");
  }

  // ---- hoisting ----

  private hoist(stmts: readonly A.Statement[], scope: Scope, top: boolean): void {
    for (const s of stmts) this.hoistOne(s, scope, top);
  }

  private hoistOne(s: A.Statement, scope: Scope, top: boolean): void {
    const exported = "modifiers" in s && (s.modifiers as A.Modifier[]).some((m) => m.name === "export");
    switch (s.kind) {
      case "VarDecl": {
        let target = scope;
        if (s.declKind === "var") while (!target.fn && target.parent) target = target.parent;
        const kind: SymKind = s.declKind === "const" || s.declKind === "using" ? "const" : s.declKind === "let" ? "let" : "var";
        for (const d of s.decls)
          for (const id of patternNames(d.target)) {
            const sym = this.declare(target, id, kind, d, { value: true, type: false }, top);
            if (exported && top) this.bf.exports.set(id.name, sym);
          }
        return;
      }
      case "FunctionDecl":
        if (s.name) {
          const sym = this.declare(scope, s.name, "function", s, { value: true, type: false }, top);
          if (exported && top && !s.modifiers.some((m) => m.name === "default")) this.bf.exports.set(s.name.name, sym);
        }
        return;
      case "TypeAlias":
      case "Interface": {
        const sym = this.declare(scope, s.name, s.kind === "TypeAlias" ? "type" : "interface", s, { value: false, type: true }, top);
        if (exported && top) this.bf.exports.set(s.name.name, sym);
        return;
      }
      case "Namespace": {
        const sym = this.declare(scope, s.name, "namespace", s, { value: false, type: true }, top);
        if (exported && top) this.bf.exports.set(s.name.name, sym);
        return;
      }
      case "Import": {
        const from = s.source.value;
        const add = (local: A.Ident, imported: string, style: Sym["importStyle"], decl: A.Node) => {
          const sym = this.declare(scope, local, "import", decl, { value: true, type: true }, top);
          sym.importFrom = from;
          sym.importName = imported;
          sym.importStyle = style;
        };
        if (s.defaultName) add(s.defaultName, "default", "default", s);
        if (s.namespace) add(s.namespace, "*", "namespace", s);
        for (const spec of s.named ?? []) add(spec.local, spec.imported.kind === "Ident" ? spec.imported.name : spec.imported.value, "named", spec);
        return;
      }
    }
  }

  // ---- walking ----

  bindFile(scope: Scope): void {
    const f = this.bf.file;
    this.hoist(f.statements, scope, true);
    for (const s of f.statements) this.stmt(s, scope);
    for (const s of f.statements)
      if (s.kind === "ExportNamed" && !s.source)
        for (const spec of s.specs) {
          if (spec.local.kind !== "Ident") continue;
          const sym = scope.values.get(spec.local.name) ?? scope.types.get(spec.local.name);
          if (sym) {
            this.bf.decls.set(spec.local, sym);
            this.bf.exports.set(spec.exported.kind === "Ident" ? spec.exported.name : spec.exported.value, sym);
          }
        }
  }

  private block(stmts: readonly A.Statement[], scope: Scope): void {
    this.hoist(stmts, scope, false);
    for (const s of stmts) this.stmt(s, scope);
  }

  private stmt(s: A.Statement, scope: Scope): void {
    switch (s.kind) {
      case "VarDecl":
        for (const d of s.decls) {
          this.patternDefaults(d.target, scope);
          if (d.type) this.type(d.type, scope);
          if (d.init) this.expr(d.init, scope);
        }
        return;
      case "FunctionDecl":
        return this.fn(s, scope);
      case "TypeAlias": {
        const ts = this.typeParams(s.typeParams, scope);
        this.type(s.type, ts);
        return;
      }
      case "Interface": {
        const ts = this.typeParams(s.typeParams, scope);
        for (const e of s.extends) this.type(e, ts);
        for (const m of s.members) this.member(m, ts);
        return;
      }
      case "Namespace": {
        const inner = newScope(scope);
        this.hoist(s.body, inner, false);
        const sym = this.bf.decls.get(s.name);
        if (sym) {
          sym.members ??= new Map();
          for (const [k, v] of inner.types) sym.members.set(k, v);
          for (const [k, v] of inner.values) sym.members.set(k, v);
        }
        for (const st of s.body) this.stmt(st, inner);
        return;
      }
      case "Block":
        return this.block(s.body, newScope(scope));
      case "ExprStmt":
        return this.expr(s.expr, scope);
      case "If":
        this.expr(s.test, scope);
        this.stmtIn(s.then, scope);
        if (s.else) this.stmtIn(s.else, scope);
        return;
      case "While":
      case "DoWhile":
        this.expr(s.test, scope);
        return this.stmtIn(s.body, scope);
      case "For": {
        const fs = newScope(scope);
        if (s.init) {
          if (s.init.kind === "VarDecl") {
            this.hoistOne(s.init, fs, false);
            this.stmt(s.init, fs);
          } else this.expr(s.init, fs);
        }
        if (s.test) this.expr(s.test, fs);
        if (s.update) this.expr(s.update, fs);
        return this.stmtIn(s.body, fs);
      }
      case "ForOf":
      case "ForIn": {
        this.expr(s.right, scope);
        const fs = newScope(scope);
        if (s.left.kind === "VarDecl") {
          this.hoistOne(s.left, fs, false);
          this.stmt(s.left, fs);
        } else this.expr(s.left, scope);
        return this.stmtIn(s.body, fs);
      }
      case "Return":
        if (s.arg) this.expr(s.arg, scope);
        return;
      case "Throw":
        return this.expr(s.arg, scope);
      case "Try": {
        this.block(s.block.body, newScope(scope));
        if (s.handler) {
          const cs = newScope(scope);
          if (s.param) {
            for (const id of patternNames(s.param)) this.declare(cs, id, "catch", s, { value: true, type: false }, false);
            this.patternDefaults(s.param, cs);
          }
          if (s.paramType) this.type(s.paramType, cs);
          this.block(s.handler.body, cs);
        }
        if (s.finalizer) this.block(s.finalizer.body, newScope(scope));
        return;
      }
      case "Switch": {
        this.expr(s.disc, scope);
        const cs = newScope(scope);
        for (const c of s.cases) this.hoist(c.body, cs, false);
        for (const c of s.cases) {
          if (c.test) this.expr(c.test, cs);
          for (const st of c.body) this.stmt(st, cs);
        }
        return;
      }
      case "Labeled":
        return this.stmtIn(s.body, scope);
      case "With":
        this.expr(s.object, scope);
        return this.stmtIn(s.body, scope);
      case "ExportDefault":
      case "ExportEquals":
        return this.expr(s.expr, scope);
      default:
        return;
    }
  }

  /** A statement in a position that is not a block, such as an `if` branch without braces. */
  private stmtIn(s: A.Statement, scope: Scope): void {
    if (s.kind === "Block") return this.stmt(s, scope);
    const inner = newScope(scope);
    this.hoistOne(s, inner, false);
    this.stmt(s, inner);
  }

  private typeParams(tps: A.TypeParam[] | undefined, scope: Scope): Scope {
    if (!tps?.length) return scope;
    const ts = newScope(scope);
    for (const tp of tps) this.declare(ts, tp.name, "typeParam", tp, { value: false, type: true }, false);
    for (const tp of tps) {
      if (tp.constraint) this.type(tp.constraint, ts);
      if (tp.default) this.type(tp.default, ts);
    }
    return ts;
  }

  private fn(f: A.FunctionLike, scope: Scope): void {
    let outer = scope;
    if (f.kind === "Function" && f.name) {
      outer = newScope(scope);
      this.declare(outer, f.name, "function", f, { value: true, type: false }, false);
    }
    const ts = this.typeParams(f.typeParams, outer);
    const fs = newScope(ts, true);
    this.params(f.params, fs);
    if (f.returnType) this.type(f.returnType, fs);
    if (!f.body) return;
    if (f.body.kind === "Block") this.block(f.body.body, fs);
    else this.expr(f.body, fs);
  }

  private params(params: A.Param[], scope: Scope): void {
    for (const p of params) for (const id of patternNames(p.target)) if (id.name !== "this") this.declare(scope, id, "param", p, { value: true, type: false }, false);
    for (const p of params) {
      if (p.type) this.type(p.type, scope);
      this.patternDefaults(p.target, scope);
      if (p.init) this.expr(p.init, scope);
    }
  }

  /** Default values and computed keys inside a binding pattern. */
  private patternDefaults(p: A.Pattern, scope: Scope): void {
    if (p.kind === "Ident") return;
    for (const el of p.elements) {
      if (el.kind !== "BindingElement") continue;
      if (el.key?.kind === "Computed") this.expr(el.key.expr, scope);
      if (el.init) this.expr(el.init, scope);
      this.patternDefaults(el.target, scope);
    }
  }

  private key(k: A.PropKey, scope: Scope): void {
    if (k.kind === "Computed") this.expr(k.expr, scope);
  }

  private expr(e: A.Node, scope: Scope): void {
    switch (e.kind) {
      case "Ident":
        return this.refValue(scope, e);
      case "Member":
        return this.expr(e.object, scope);
      case "Function":
      case "Arrow":
        return this.fn(e, scope);
      case "Object":
        for (const p of e.props) {
          if (p.kind === "Prop") {
            this.key(p.key, scope);
            this.expr(p.value, scope);
          } else if (p.kind === "Shorthand") {
            this.refValue(scope, p.name);
            if (p.init) this.expr(p.init, scope);
          } else if (p.kind === "Method") {
            this.key(p.key, scope);
            this.fn(p, scope);
          } else if (p.kind === "Spread") this.expr(p.arg, scope);
          else this.key(p.key, scope);
        }
        return;
      case "Assign":
        if (e.left.kind === "Ident") {
          const sym = this.lookup(scope, e.left.name, "values");
          if (sym && sym.file === this.bf) {
            sym.assigned = true;
            if (e.op === "=") sym.assignments.push(e.right);
          }
        }
        this.expr(e.left, scope);
        return this.expr(e.right, scope);
      case "Update":
        if (e.arg.kind === "Ident") {
          const sym = this.lookup(scope, e.arg.name, "values");
          if (sym && sym.file === this.bf) sym.assigned = true;
        }
        return this.expr(e.arg, scope);
      case "As":
      case "Satisfies":
        this.expr(e.expr, scope);
        return this.type(e.type, scope);
      case "Call":
      case "New":
        this.expr(e.callee, scope);
        for (const t of e.typeArgs ?? []) this.type(t, scope);
        for (const a of e.args ?? []) this.expr(a, scope);
        return;
      case "JsxElement": {
        const n = e.name;
        if (n.kind === "Ident" && !/^[a-z]/.test(n.name)) this.refValue(scope, n);
        else if (n.kind === "JsxMemberName") {
          let o: A.Ident | A.JsxMemberName = n;
          while (o.kind === "JsxMemberName") o = o.object;
          this.refValue(scope, o);
        }
        for (const t of e.typeArgs ?? []) this.type(t, scope);
        for (const a of e.attrs) {
          if (a.kind === "JsxSpreadAttr") this.expr(a.arg, scope);
          else if (a.value) this.expr(a.value, scope);
        }
        for (const c of e.children ?? []) this.expr(c, scope);
        return;
      }
      case "JsxExprContainer":
        if (e.expr) this.expr(e.expr, scope);
        return;
      case "JsxText":
      case "PrivateName":
        return;
      default:
        forEachChild(e, (c) => this.expr(c, scope));
    }
  }

  private member(m: A.TypeMember, scope: Scope): void {
    switch (m.kind) {
      case "PropSig":
        this.key(m.key, scope);
        if (m.type) this.type(m.type, scope);
        return;
      case "MethodSig":
      case "CallSig":
      case "ConstructSig": {
        if (m.kind === "MethodSig") this.key(m.key, scope);
        const ts = this.typeParams(m.typeParams, scope);
        const ps = newScope(ts, true);
        this.params(m.params, ps);
        if (m.returnType) this.type(m.returnType, ps);
        return;
      }
      case "IndexSig":
        this.type(m.keyType, scope);
        this.type(m.type, scope);
        return;
    }
  }

  private type(t: A.TypeNode, scope: Scope): void {
    switch (t.kind) {
      case "TypeRef": {
        let n: A.Ident | A.QualifiedName = t.name;
        while (n.kind === "QualifiedName") n = n.left;
        this.refType(scope, n);
        for (const a of t.args ?? []) this.type(a, scope);
        return;
      }
      case "TypeQuery": {
        let n: A.Ident | A.QualifiedName = t.name;
        while (n.kind === "QualifiedName") n = n.left;
        return this.refValue(scope, n);
      }
      case "FunctionType":
      case "ConstructorType": {
        const ts = this.typeParams(t.typeParams, scope);
        const ps = newScope(ts, true);
        this.params(t.params, ps);
        return this.type(t.returnType, ps);
      }
      case "TypeLiteral":
        for (const m of t.members) this.member(m, scope);
        return;
      case "MappedType": {
        const ms = newScope(scope);
        const tp = { kind: "TypeParam", name: t.param, modifiers: [], start: t.param.start, end: t.param.end } as A.TypeParam;
        this.declare(ms, t.param, "typeParam", tp, { value: false, type: true }, false);
        this.type(t.constraint, scope);
        if (t.type) this.type(t.type, ms);
        return;
      }
      case "ConditionalType": {
        const cs = newScope(scope);
        const infers: A.InferType[] = [];
        const find = (n: A.Node) => {
          if (n.kind === "InferType") infers.push(n);
          forEachChild(n, find);
        };
        find(t.extendsType);
        for (const i of infers) {
          const tp = { kind: "TypeParam", name: i.name, modifiers: [], start: i.start, end: i.end } as A.TypeParam;
          this.declare(cs, i.name, "typeParam", tp, { value: false, type: true }, false);
        }
        this.type(t.check, scope);
        this.type(t.extendsType, cs);
        this.type(t.trueType, cs);
        return this.type(t.falseType, scope);
      }
      case "TypePredicate":
        if (t.type) this.type(t.type, scope);
        return;
      case "InferType":
        return;
      default:
        forEachChild(t, (c) => this.type(c as A.TypeNode, scope));
    }
  }
}

/** Binds one declaration of the lib into the global scope every other file sees. */
export function bindLibPart(file: A.SourceFile, global: GlobalScope): BoundFile {
  const b = new Binder(file, "lib", undefined);
  b.bindFile({ values: global.values, types: global.types, fn: true });
  return b.bf;
}

export function bindFile(file: A.SourceFile, home: Home, global: GlobalScope): BoundFile {
  const b = new Binder(file, home, global);
  b.bindFile(newScope(undefined, true));
  return b.bf;
}
