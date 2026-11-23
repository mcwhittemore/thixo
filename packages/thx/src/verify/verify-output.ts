// A second check on the compiler, written apart from it. It parses emitted code and accepts it only if it is the
// shape the compiler is meant to write: one default-exported function of `rt`, whose only way to touch anything is
// a call to one of rt's named members, and which names nothing it did not declare.

import ts from "typescript";

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
  "asset",
  "imp",
  "nw",
  "plugin",
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
  const sf = ts.createSourceFile("plugin.js", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  for (const d of parseDiagnostics) errors.push(`syntax: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  if (errors.length) return { ok: false, errors };

  const where = (n: ts.Node) => {
    const p = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    return `${p.line + 1}:${p.character + 1}`;
  };
  const fail = (n: ts.Node, what: string) => {
    errors.push(`${where(n)} ${what}`);
  };

  const root = sf.statements[0];
  const mods = root && ts.canHaveModifiers(root) ? (ts.getModifiers(root) ?? []).map((m) => m.kind) : [];
  if (
    sf.statements.length !== 1 ||
    !ts.isFunctionDeclaration(root) ||
    root.name ||
    root.asteriskToken ||
    mods.length !== 2 ||
    mods[0] !== ts.SyntaxKind.ExportKeyword ||
    mods[1] !== ts.SyntaxKind.DefaultKeyword ||
    root.parameters.length !== 1 ||
    !ts.isIdentifier(root.parameters[0].name) ||
    root.parameters[0].name.text !== "rt" ||
    root.parameters[0].initializer ||
    root.parameters[0].dotDotDotToken ||
    !root.body
  ) {
    return { ok: false, errors: ["the module must be exactly `export default function (rt) { ... }`"] };
  }
  const first = root.body.statements[0];
  if (!first || !ts.isExpressionStatement(first) || !ts.isStringLiteral(first.expression) || first.expression.text !== "use strict")
    errors.push("the function body must start with \"use strict\"");

  const rootScope: Scope = { names: new Set(["rt"]) };

  const resolves = (name: string, scope: Scope | undefined): Scope | undefined => {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s;
    return undefined;
  };

  const declare = (id: ts.Node, scope: Scope) => {
    if (!ts.isIdentifier(id)) {
      fail(id, "a declaration binds something other than a plain name");
      return;
    }
    if (id.text === "rt") fail(id, "`rt` is declared again");
    if (BANNED_NAMES.has(id.text)) fail(id, `\`${id.text}\` is declared`);
    scope.names.add(id.text);
  };

  const hoist = (stmts: readonly ts.Statement[], scope: Scope) => {
    for (const s of stmts) {
      if (ts.isFunctionDeclaration(s) && s.name) declare(s.name, scope);
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) declare(d.name, scope);
    }
  };

  const block = (stmts: readonly ts.Statement[], parent: Scope, inAsync = false, scope: Scope = { names: new Set(), parent }) => {
    hoist(stmts, scope);
    for (const s of stmts) statement(s, scope, inAsync);
  };

  const fnLike = (f: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction, scope: Scope, inAsync: boolean) => {
    const fscope: Scope = { names: new Set(), parent: scope };
    if (ts.isFunctionExpression(f) && f.name) declare(f.name, fscope);
    for (const p of f.parameters) {
      if (p.initializer) fail(p, "a parameter has a default value");
      declare(p.name, fscope);
    }
    if (!f.body || !ts.isBlock(f.body)) {
      fail(f, "a function without a block body");
      return;
    }
    hoist(f.body.statements, fscope);
    for (const s of f.body.statements) statement(s, fscope, inAsync);
  };

  const varList = (list: ts.VariableDeclarationList, scope: Scope, inAsync: boolean) => {
    if (!(list.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) fail(list, "a declaration that is not `const` or `let`");
    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) fail(d, "a destructuring declaration");
      if (d.initializer) expression(d.initializer, scope, inAsync);
    }
  };

  function statement(s: ts.Statement, scope: Scope, inAsync = false): void {
    switch (s.kind) {
      case ts.SyntaxKind.VariableStatement:
        if (ts.getModifiers(s as ts.VariableStatement)?.length) fail(s, "a modifier on a declaration");
        return varList((s as ts.VariableStatement).declarationList, scope, inAsync);
      case ts.SyntaxKind.FunctionDeclaration: {
        const f = s as ts.FunctionDeclaration;
        if (f.asteriskToken || ts.getModifiers(f)?.length) fail(f, "a generator, async or exported inner function");
        return fnLike(f, scope, false);
      }
      case ts.SyntaxKind.ExpressionStatement:
        return expression((s as ts.ExpressionStatement).expression, scope, inAsync);
      case ts.SyntaxKind.IfStatement: {
        const i = s as ts.IfStatement;
        expression(i.expression, scope, inAsync);
        statement(i.thenStatement, scope, inAsync);
        if (i.elseStatement) statement(i.elseStatement, scope, inAsync);
        return;
      }
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement: {
        const w = s as ts.WhileStatement;
        expression(w.expression, scope, inAsync);
        return statement(w.statement, scope, inAsync);
      }
      case ts.SyntaxKind.ForStatement: {
        const f = s as ts.ForStatement;
        const fs: Scope = { names: new Set(), parent: scope };
        if (f.initializer) {
          if (ts.isVariableDeclarationList(f.initializer)) {
            for (const d of f.initializer.declarations) declare(d.name, fs);
            varList(f.initializer, fs, inAsync);
          } else expression(f.initializer, fs, inAsync);
        }
        if (f.condition) expression(f.condition, fs, inAsync);
        if (f.incrementor) expression(f.incrementor, fs, inAsync);
        return statement(f.statement, fs, inAsync);
      }
      case ts.SyntaxKind.ForOfStatement: {
        const f = s as ts.ForOfStatement;
        if (f.awaitModifier) fail(f, "`for await`");
        const fs: Scope = { names: new Set(), parent: scope };
        expression(f.expression, scope, inAsync);
        if (!ts.isVariableDeclarationList(f.initializer) || f.initializer.declarations.length !== 1) fail(f, "a for-of without one declaration");
        else {
          declare(f.initializer.declarations[0].name, fs);
          varList(f.initializer, fs, inAsync);
        }
        return statement(f.statement, fs, inAsync);
      }
      case ts.SyntaxKind.ReturnStatement: {
        const r = s as ts.ReturnStatement;
        if (r.expression) expression(r.expression, scope, inAsync);
        return;
      }
      case ts.SyntaxKind.BreakStatement:
      case ts.SyntaxKind.ContinueStatement:
        if ((s as ts.BreakStatement).label) fail(s, "a label");
        return;
      case ts.SyntaxKind.ThrowStatement:
        return expression((s as ts.ThrowStatement).expression, scope, inAsync);
      case ts.SyntaxKind.TryStatement: {
        const t = s as ts.TryStatement;
        block(t.tryBlock.statements, scope, inAsync);
        if (t.catchClause) {
          const cs: Scope = { names: new Set(), parent: scope };
          if (t.catchClause.variableDeclaration) declare(t.catchClause.variableDeclaration.name, cs);
          block(t.catchClause.block.statements, cs, inAsync);
        }
        if (t.finallyBlock) block(t.finallyBlock.statements, scope, inAsync);
        return;
      }
      case ts.SyntaxKind.Block:
        return block((s as ts.Block).statements, scope, inAsync);
      case ts.SyntaxKind.SwitchStatement: {
        const sw = s as ts.SwitchStatement;
        expression(sw.expression, scope, inAsync);
        const cs: Scope = { names: new Set(), parent: scope };
        for (const c of sw.caseBlock.clauses) hoist(c.statements, cs);
        for (const c of sw.caseBlock.clauses) {
          if (ts.isCaseClause(c)) expression(c.expression, cs, inAsync);
          for (const st of c.statements) statement(st, cs, inAsync);
        }
        return;
      }
      case ts.SyntaxKind.EmptyStatement:
        return;
      default:
        fail(s, `statement kind ${ts.SyntaxKind[s.kind]}`);
    }
  }

  const isRtMember = (e: ts.Expression, scope: Scope): boolean =>
    ts.isPropertyAccessExpression(e) &&
    !e.questionDotToken &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "rt" &&
    resolves("rt", scope) === rootScope &&
    ts.isIdentifier(e.name) &&
    RT_NAMES.has(e.name.text);

  const isAsyncThunk = (e: ts.Expression): e is ts.ParenthesizedExpression =>
    ts.isParenthesizedExpression(e) &&
    ts.isArrowFunction(e.expression) &&
    e.expression.parameters.length === 0 &&
    !!ts.getModifiers(e.expression)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
    ts.isBlock(e.expression.body);

  function expression(e: ts.Expression, scope: Scope, inAsync: boolean): void {
    switch (e.kind) {
      case ts.SyntaxKind.Identifier: {
        const id = e as ts.Identifier;
        if (BANNED_NAMES.has(id.text)) fail(id, `\`${id.text}\` is named`);
        if (!resolves(id.text, scope)) fail(id, `\`${id.text}\` is not declared`);
        return;
      }
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.TrueKeyword:
      case ts.SyntaxKind.FalseKeyword:
      case ts.SyntaxKind.NullKeyword:
        return;
      case ts.SyntaxKind.ParenthesizedExpression:
        return expression((e as ts.ParenthesizedExpression).expression, scope, inAsync);
      case ts.SyntaxKind.PropertyAccessExpression:
        if (!isRtMember(e, scope)) fail(e, `a field read other than rt.<member>: \`${e.getText(sf).slice(0, 40)}\``);
        return;
      case ts.SyntaxKind.CallExpression: {
        const c = e as ts.CallExpression;
        if (c.questionDotToken) fail(c, "an optional call");
        if (isRtMember(c.expression, scope)) {
          // ok
        } else if (isAsyncThunk(c.expression) && c.arguments.length === 0) {
          const arrow = c.expression.expression as ts.ArrowFunction;
          const as: Scope = { names: new Set(), parent: scope };
          const body = arrow.body as ts.Block;
          hoist(body.statements, as);
          for (const s of body.statements) statement(s, as, true);
          return;
        } else fail(c, `a call of something other than rt.<member>: \`${c.expression.getText(sf).slice(0, 40)}\``);
        for (const a of c.arguments) {
          if (ts.isSpreadElement(a)) fail(a, "a spread argument");
          else expression(a, scope, inAsync);
        }
        return;
      }
      case ts.SyntaxKind.BinaryExpression: {
        const b = e as ts.BinaryExpression;
        const op = b.operatorToken.getText(sf);
        if (ASSIGN.has(op)) {
          if (!ts.isIdentifier(b.left)) fail(b, "an assignment to something other than a name");
          else if (b.left.text === "rt") fail(b, "an assignment to rt");
        } else if (!BINARY.has(op)) fail(b, `the operator ${op}`);
        expression(b.left, scope, inAsync);
        expression(b.right, scope, inAsync);
        return;
      }
      case ts.SyntaxKind.PrefixUnaryExpression:
      case ts.SyntaxKind.PostfixUnaryExpression: {
        const u = e as ts.PrefixUnaryExpression;
        const inc = u.operator === ts.SyntaxKind.PlusPlusToken || u.operator === ts.SyntaxKind.MinusMinusToken;
        if (inc && (!ts.isIdentifier(u.operand) || u.operand.text === "rt")) fail(u, "++ or -- on something other than a name");
        return expression(u.operand, scope, inAsync);
      }
      case ts.SyntaxKind.TypeOfExpression:
        return expression((e as ts.TypeOfExpression).expression, scope, inAsync);
      case ts.SyntaxKind.VoidExpression: {
        const v = (e as ts.VoidExpression).expression;
        if (!ts.isNumericLiteral(v) || v.text !== "0") fail(e, "void of something other than 0");
        return;
      }
      case ts.SyntaxKind.ConditionalExpression: {
        const c = e as ts.ConditionalExpression;
        expression(c.condition, scope, inAsync);
        expression(c.whenTrue, scope, inAsync);
        expression(c.whenFalse, scope, inAsync);
        return;
      }
      case ts.SyntaxKind.AwaitExpression:
        if (!inAsync) fail(e, "await outside the compiler's async wrapper");
        return expression((e as ts.AwaitExpression).expression, scope, inAsync);
      case ts.SyntaxKind.FunctionExpression: {
        const f = e as ts.FunctionExpression;
        if (f.asteriskToken || ts.getModifiers(f)?.length) fail(f, "a generator or async function expression");
        return fnLike(f, scope, false);
      }
      case ts.SyntaxKind.ArrayLiteralExpression:
        for (const el of (e as ts.ArrayLiteralExpression).elements) {
          if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) fail(el, "a spread or hole in a list");
          else expression(el, scope, inAsync);
        }
        return;
      default:
        fail(e, `expression kind ${ts.SyntaxKind[e.kind]}`);
    }
  }

  block(root.body.statements.slice(1), rootScope);
  return errors.length ? { ok: false, errors } : { ok: true };
}
