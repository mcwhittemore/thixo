// A second check on the compiler, written apart from it. It parses emitted code and accepts it only if it is the
// shape the compiler is meant to write: one default-exported function of `rt`, whose only way to touch anything is
// a call to one of rt's named members, and which names nothing it did not declare.

import type * as A from "../compiler/syntax/ast.js";
import { lineCol } from "../compiler/syntax/ast.js";
import { parse } from "../compiler/syntax/parser.js";

/** The members of `rt` compiled code may name. */
export const RT_NAMES: ReadonlySet<string> = new Set([
  "tick",
  "done",
  "push",
  "pop",
  "ctx",
  "back",
  "aw",
  "fn",
  "c",
  "m",
  "g",
  "s",
  "end",
  "r",
  "a",
  "sp",
  "iter",
  "list",
  "rest",
  "caught",
  "el",
  "frag",
  "addr",
  "app",
  "imp",
  "nw",
  "str",
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
]);

const BINARY = new Set([
  "+", "-", "*", "/", "%", "**", "<", ">", "<=", ">=", "===", "!==", "&&", "||", "??", "&", "|", "^", "<<", ">>", ">>>",
]);
const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "&&=", "||=", "??="]);
const BANNED_NAMES = new Set(["arguments", "eval"]);

interface Scope {
  names: Set<string>;
  parent?: Scope;
}

export function verifyOutput(code: string): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const parsed = parse(code, "program.js", "js");
  if (parsed.error) return { ok: false, errors: [`syntax: ${parsed.error.message}`] };
  const sf = parsed.file;

  const where = (n: A.Node) => {
    const p = lineCol(sf, n.start);
    return `${p.line}:${p.column}`;
  };
  const fail = (n: A.Node, what: string) => {
    errors.push(`${where(n)} ${what}`);
  };

  const root = sf.statements[0];
  const mods = root && "modifiers" in root ? (root.modifiers as A.Modifier[]).map((m) => m.name) : [];
  if (
    sf.statements.length !== 1 ||
    root.kind !== "FunctionDecl" ||
    root.name ||
    root.generator ||
    mods.length !== 2 ||
    mods[0] !== "export" ||
    mods[1] !== "default" ||
    root.params.length !== 1 ||
    root.params[0].target.kind !== "Ident" ||
    root.params[0].target.name !== "rt" ||
    root.params[0].init ||
    root.params[0].rest ||
    !root.body
  ) {
    return { ok: false, errors: ["the module must be exactly `export default function (rt) { ... }`"] };
  }
  const first = root.body.body[0];
  if (!first || first.kind !== "ExprStmt" || first.expr.kind !== "Str" || first.expr.value !== "use strict")
    errors.push("the function body must start with \"use strict\"");

  const rootScope: Scope = { names: new Set(["rt"]) };

  const resolves = (name: string, scope: Scope | undefined): Scope | undefined => {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s;
    return undefined;
  };

  const declare = (id: A.Node, scope: Scope) => {
    if (id.kind !== "Ident") {
      fail(id, "a declaration binds something other than a plain name");
      return;
    }
    if (id.name === "rt") fail(id, "`rt` is declared again");
    if (BANNED_NAMES.has(id.name)) fail(id, `\`${id.name}\` is declared`);
    scope.names.add(id.name);
  };

  const hoist = (stmts: readonly A.Statement[], scope: Scope) => {
    for (const s of stmts) {
      if (s.kind === "FunctionDecl" && s.name) declare(s.name, scope);
      if (s.kind === "VarDecl") for (const d of s.decls) declare(d.target, scope);
    }
  };

  const block = (stmts: readonly A.Statement[], parent: Scope, inAsync = false, scope: Scope = { names: new Set(), parent }) => {
    hoist(stmts, scope);
    for (const s of stmts) statement(s, scope, inAsync);
  };

  const fnLike = (f: A.FunctionDecl | A.FunctionExpr, scope: Scope, inAsync: boolean) => {
    const fscope: Scope = { names: new Set(), parent: scope };
    if (f.kind === "Function" && f.name) declare(f.name, fscope);
    for (const p of f.params) {
      if (p.init) fail(p, "a parameter has a default value");
      declare(p.target, fscope);
    }
    if (!f.body || f.body.kind !== "Block") {
      fail(f, "a function without a block body");
      return;
    }
    hoist(f.body.body, fscope);
    for (const s of f.body.body) statement(s, fscope, inAsync);
  };

  const varList = (list: A.VarDecl, scope: Scope, inAsync: boolean) => {
    if (list.declKind !== "const" && list.declKind !== "let") fail(list, "a declaration that is not `const` or `let`");
    for (const d of list.decls) {
      if (d.target.kind !== "Ident") fail(d, "a destructuring declaration");
      if (d.init) expression(d.init, scope, inAsync);
    }
  };

  function statement(s: A.Statement, scope: Scope, inAsync = false): void {
    switch (s.kind) {
      case "VarDecl":
        if (s.modifiers.length) fail(s, "a modifier on a declaration");
        return varList(s, scope, inAsync);
      case "FunctionDecl":
        if (s.generator || s.modifiers.length) fail(s, "a generator, async or exported inner function");
        return fnLike(s, scope, false);
      case "ExprStmt":
        return expression(s.expr, scope, inAsync);
      case "If":
        expression(s.test, scope, inAsync);
        statement(s.then, scope, inAsync);
        if (s.else) statement(s.else, scope, inAsync);
        return;
      case "While":
      case "DoWhile":
        expression(s.test, scope, inAsync);
        return statement(s.body, scope, inAsync);
      case "For": {
        const fs: Scope = { names: new Set(), parent: scope };
        if (s.init) {
          if (s.init.kind === "VarDecl") {
            for (const d of s.init.decls) declare(d.target, fs);
            varList(s.init, fs, inAsync);
          } else expression(s.init, fs, inAsync);
        }
        if (s.test) expression(s.test, fs, inAsync);
        if (s.update) expression(s.update, fs, inAsync);
        return statement(s.body, fs, inAsync);
      }
      case "ForOf": {
        if (s.await) fail(s, "`for await`");
        const fs: Scope = { names: new Set(), parent: scope };
        expression(s.right, scope, inAsync);
        if (s.left.kind !== "VarDecl" || s.left.decls.length !== 1) fail(s, "a for-of without one declaration");
        else {
          declare(s.left.decls[0].target, fs);
          varList(s.left, fs, inAsync);
        }
        return statement(s.body, fs, inAsync);
      }
      case "Return":
        if (s.arg) expression(s.arg, scope, inAsync);
        return;
      case "Break":
      case "Continue":
        if (s.label) fail(s, "a label");
        return;
      case "Throw":
        return expression(s.arg, scope, inAsync);
      case "Try": {
        block(s.block.body, scope, inAsync);
        if (s.handler) {
          const cs: Scope = { names: new Set(), parent: scope };
          if (s.param) declare(s.param, cs);
          block(s.handler.body, cs, inAsync);
        }
        if (s.finalizer) block(s.finalizer.body, scope, inAsync);
        return;
      }
      case "Block":
        return block(s.body, scope, inAsync);
      case "Switch": {
        expression(s.disc, scope, inAsync);
        const cs: Scope = { names: new Set(), parent: scope };
        for (const c of s.cases) hoist(c.body, cs);
        for (const c of s.cases) {
          if (c.test) expression(c.test, cs, inAsync);
          for (const st of c.body) statement(st, cs, inAsync);
        }
        return;
      }
      case "Empty":
        return;
      default:
        fail(s, `statement kind ${s.kind}`);
    }
  }

  const isRtMember = (e: A.Expr, scope: Scope): boolean =>
    e.kind === "Member" &&
    !e.optional &&
    !e.inChain &&
    e.object.kind === "Ident" &&
    e.object.name === "rt" &&
    resolves("rt", scope) === rootScope &&
    e.prop.kind === "Ident" &&
    RT_NAMES.has(e.prop.name);

  const isAsyncThunk = (e: A.Expr): e is A.Paren & { expr: A.Arrow & { body: A.Block } } =>
    e.kind === "Paren" && e.expr.kind === "Arrow" && e.expr.params.length === 0 && e.expr.async && e.expr.body.kind === "Block";

  const text = (n: A.Node) => code.slice(n.start, n.end).slice(0, 40);

  function expression(e: A.Expr, scope: Scope, inAsync: boolean): void {
    switch (e.kind) {
      case "Ident":
        if (BANNED_NAMES.has(e.name)) fail(e, `\`${e.name}\` is named`);
        if (!resolves(e.name, scope)) fail(e, `\`${e.name}\` is not declared`);
        return;
      case "Num":
      case "Str":
      case "Bool":
      case "Null":
        return;
      case "Paren":
        return expression(e.expr, scope, inAsync);
      case "Member":
        if (!isRtMember(e, scope)) fail(e, `a field read other than rt.<member>: \`${text(e)}\``);
        return;
      case "Call": {
        if (e.optional || e.inChain) fail(e, "an optional call");
        if (isRtMember(e.callee, scope)) {
          // ok
        } else if (isAsyncThunk(e.callee) && e.args.length === 0) {
          const as: Scope = { names: new Set(), parent: scope };
          const body = e.callee.expr.body;
          hoist(body.body, as);
          for (const s of body.body) statement(s, as, true);
          return;
        } else fail(e, `a call of something other than rt.<member>: \`${text(e.callee)}\``);
        for (const a of e.args) {
          if (a.kind === "Spread") fail(a, "a spread argument");
          else expression(a, scope, inAsync);
        }
        return;
      }
      case "Assign":
        if (e.left.kind !== "Ident") fail(e, "an assignment to something other than a name");
        else if (e.left.name === "rt") fail(e, "an assignment to rt");
        if (!ASSIGN.has(e.op)) fail(e, `the operator ${e.op}`);
        expression(e.left, scope, inAsync);
        expression(e.right, scope, inAsync);
        return;
      case "Binary":
        if (!BINARY.has(e.op)) fail(e, `the operator ${e.op}`);
        expression(e.left, scope, inAsync);
        expression(e.right, scope, inAsync);
        return;
      case "Update":
        if (e.arg.kind !== "Ident" || e.arg.name === "rt") fail(e, "++ or -- on something other than a name");
        return expression(e.arg, scope, inAsync);
      case "Unary":
        if (e.op === "void") {
          if (e.arg.kind !== "Num" || e.arg.raw !== "0") fail(e, "void of something other than 0");
          return;
        }
        if (e.op === "delete") {
          fail(e, "expression kind delete");
          return;
        }
        return expression(e.arg, scope, inAsync);
      case "Cond":
        expression(e.test, scope, inAsync);
        expression(e.cons, scope, inAsync);
        expression(e.alt, scope, inAsync);
        return;
      case "Await":
        if (!inAsync) fail(e, "await outside the compiler's async wrapper");
        return expression(e.arg, scope, inAsync);
      case "Function":
        if (e.generator || e.modifiers.length) fail(e, "a generator or async function expression");
        return fnLike(e, scope, false);
      case "Array":
        for (const el of e.elements) {
          if (el.kind === "Spread" || el.kind === "Hole") fail(el, "a spread or hole in a list");
          else expression(el, scope, inAsync);
        }
        return;
      default:
        fail(e, `expression kind ${e.kind}`);
    }
  }

  block(root.body.body.slice(1), rootScope);
  return errors.length ? { ok: false, errors } : { ok: true };
}
