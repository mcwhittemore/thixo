// A recursive-descent parser for the TypeScript and JSX that `.thx` files are written in, the declarations in `.d.ts`
// text, and the JavaScript the compiler emits. It reads more than the language allows, so that the compiler can say
// "classes are not in the language" instead of "unexpected token". It stops at the first syntax error.

import type * as A from "./ast.js";
import { setParents } from "./ast.js";
import { lineStartsOf, Scanner, SyntaxError_, type Token } from "./scanner.js";

export type ParseMode = "tsx" | "dts" | "js";

export interface ParseResult {
  file: A.SourceFile;
  error?: { message: string; pos: number };
}

const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export",
  "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super",
  "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with",
]);

const TYPE_KEYWORDS = new Set(["string", "number", "boolean", "unknown", "never", "void", "undefined", "null", "object", "any", "symbol", "bigint"]);

const BINARY_PREC: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "|": 4,
  "^": 5,
  "&": 6,
  "==": 7,
  "!=": 7,
  "===": 7,
  "!==": 7,
  "<": 8,
  ">": 8,
  "<=": 8,
  ">=": 8,
  instanceof: 8,
  in: 8,
  "<<": 9,
  ">>": 9,
  ">>>": 9,
  "+": 10,
  "-": 10,
  "*": 11,
  "/": 11,
  "%": 11,
  "**": 12,
};

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "&&=", "||=", "??="]);

const MODIFIERS = new Set(["export", "default", "declare", "async", "abstract", "public", "private", "protected", "readonly", "static", "override", "accessor", "const", "in", "out"]);

interface ArrowHead {
  typeParams?: A.TypeParam[];
  params: A.Param[];
  returnType?: A.TypeNode;
}

interface State {
  pos: number;
  tok: Token;
  prevEnd: number;
}

class Parser {
  private s: Scanner;
  private tok!: Token;
  private prevEnd = 0;
  private noIn = false;
  private inGenerator = false;

  constructor(
    private readonly text: string,
    private readonly mode: ParseMode,
  ) {
    this.s = new Scanner(text);
    this.advance();
  }

  // ---- tokens ----

  private advance(): Token {
    const t = this.tok;
    if (t) this.prevEnd = t.end;
    this.tok = this.s.next();
    return t;
  }

  private save(): State {
    return { pos: this.s.pos, tok: this.tok, prevEnd: this.prevEnd };
  }

  private restore(st: State): void {
    this.s.pos = st.pos;
    this.tok = st.tok;
    this.prevEnd = st.prevEnd;
  }

  /** Runs `fn`; on a syntax error or a falsy result, rewinds and returns undefined. */
  private tryParse<T>(fn: () => T | undefined): T | undefined {
    const st = this.save();
    const noIn = this.noIn;
    try {
      const r = fn();
      if (r !== undefined) return r;
    } catch (e) {
      if (!(e instanceof SyntaxError_)) throw e;
    }
    this.restore(st);
    this.noIn = noIn;
    return undefined;
  }

  private fail(message: string, pos = this.tok.start): never {
    throw new SyntaxError_(message, pos);
  }

  private is(value: string): boolean {
    return this.tok.type === "punct" && this.tok.value === value;
  }

  private atString(): boolean {
    return this.tok.type === "string";
  }

  private isName(value?: string): boolean {
    return this.tok.type === "name" && (value === undefined || (this.tok.value === value && !this.tok.escaped));
  }

  private eat(value: string): boolean {
    if (this.is(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private eatName(value: string): boolean {
    if (this.isName(value)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.is(value)) this.fail(`'${value}' expected.`);
    return this.advance();
  }

  private expectName(value: string): void {
    if (!this.isName(value)) this.fail(`'${value}' expected.`);
    this.advance();
  }

  /** Looks at the token after the current one without moving. */
  private peek(): Token {
    const st = this.save();
    this.advance();
    const t = this.tok;
    this.restore(st);
    return t;
  }

  private canEndStatement(): boolean {
    return this.is(";") || this.is("}") || this.tok.type === "eof" || this.tok.nl;
  }

  private semicolon(): void {
    if (this.eat(";")) return;
    if (this.is("}") || this.tok.type === "eof" || this.tok.nl) return;
    this.fail("';' expected.");
  }

  private node<T extends A.Base>(start: number, fields: Omit<T, "start" | "end" | "parent">): T {
    return { ...fields, start, end: this.prevEnd } as unknown as T;
  }

  // ---- names ----

  private ident(allowReserved = false): A.Ident {
    if (this.tok.type !== "name") this.fail("Identifier expected.");
    if (!allowReserved && !this.tok.escaped && RESERVED.has(this.tok.value)) this.fail(`Identifier expected. '${this.tok.value}' is a reserved word that cannot be used here.`);
    const t = this.advance();
    return { kind: "Ident", name: t.value, escaped: !!t.escaped, start: t.start, end: t.end };
  }

  private propertyKey(): A.PropKey {
    const t = this.tok;
    if (t.type === "name") return this.ident(true);
    if (t.type === "string") {
      this.advance();
      return { kind: "Str", value: t.value, raw: this.text.slice(t.start, t.end), start: t.start, end: t.end };
    }
    if (t.type === "num") {
      this.advance();
      return { kind: "Num", value: t.num!, raw: t.value, start: t.start, end: t.end };
    }
    if (t.type === "private") {
      this.advance();
      return { kind: "PrivateName", name: t.value, start: t.start, end: t.end };
    }
    if (this.is("[")) {
      const start = t.start;
      this.advance();
      const noIn = this.noIn;
      this.noIn = false;
      const expr = this.assignment();
      this.noIn = noIn;
      this.expect("]");
      return this.node<A.Computed>(start, { kind: "Computed", expr });
    }
    this.fail("Property assignment expected.");
  }

  private isPropertyKeyStart(): boolean {
    return this.tok.type === "name" || this.tok.type === "string" || this.tok.type === "num" || this.tok.type === "private" || this.is("[");
  }

  // ---- file ----

  file(path: string): A.SourceFile {
    const statements: A.Statement[] = [];
    while (this.tok.type !== "eof") statements.push(this.statement());
    const file: A.SourceFile = { kind: "SourceFile", path, text: this.text, statements, lineStarts: lineStartsOf(this.text), start: 0, end: this.text.length };
    return file;
  }

  // ---- statements ----

  private modifiers(): A.Modifier[] {
    const mods: A.Modifier[] = [];
    while (this.tok.type === "name" && !this.tok.escaped) {
      const t = this.tok;
      const next = this.peek();
      const nextName = next.type === "name" ? next.value : undefined;
      let ok = false;
      if (t.value === "export") ok = next.type === "name";
      else if (t.value === "default") ok = mods.length > 0 && mods[mods.length - 1].name === "export" && ["function", "async", "class", "abstract", "interface"].includes(nextName ?? "");
      else if (t.value === "async") ok = nextName === "function" && !next.nl;
      else if (t.value === "const") ok = nextName === "enum";
      else if (t.value === "declare" || t.value === "abstract") ok = !next.nl && (next.type === "name" || next.type === "string");
      if (!ok) break;
      this.advance();
      mods.push({ kind: "Modifier", name: t.value, start: t.start, end: t.end });
    }
    return mods;
  }

  private statement(): A.Statement {
    const start = this.tok.start;
    const t = this.tok;
    if (t.type === "punct") {
      switch (t.value) {
        case "{":
          return this.block();
        case ";":
          this.advance();
          return this.node<A.Empty>(start, { kind: "Empty" });
        case "@": {
          this.advance();
          this.leftHandSide();
          return this.node<A.Unsupported>(start, { kind: "Decorator" });
        }
      }
    }
    if (t.type === "name" && !t.escaped) {
      switch (t.value) {
        case "import": {
          const next = this.peek();
          if (!(next.type === "punct" && (next.value === "(" || next.value === "."))) return this.importDecl();
          break;
        }
        case "export":
          return this.exportDecl();
        case "var":
        case "const": {
          const next = this.peek();
          if (t.value === "const" && next.type === "name" && next.value === "enum") return this.declaration(start, this.modifiers());
          return this.varStatement(start, []);
        }
        case "let": {
          const next = this.peek();
          if (next.type === "name" || (next.type === "punct" && (next.value === "[" || next.value === "{"))) return this.varStatement(start, []);
          break;
        }
        case "using": {
          const next = this.peek();
          if (next.type === "name" && !next.nl) return this.varStatement(start, []);
          break;
        }
        case "function":
        case "class":
        case "enum":
          return this.declaration(start, []);
        case "async": {
          const next = this.peek();
          if (next.type === "name" && next.value === "function" && !next.nl) return this.declaration(start, this.modifiers());
          break;
        }
        case "type": {
          const next = this.peek();
          if (next.type === "name" && !next.nl) return this.declaration(start, []);
          break;
        }
        case "interface":
        case "namespace":
        case "module":
        case "declare":
        case "abstract": {
          const next = this.peek();
          if (!next.nl && (next.type === "name" || next.type === "string")) return this.declaration(start, this.modifiers());
          break;
        }
        case "global": {
          const next = this.peek();
          if (next.type === "punct" && next.value === "{" && this.mode === "dts") return this.declaration(start, []);
          break;
        }
        case "if":
          return this.ifStatement();
        case "for":
          return this.forStatement();
        case "while": {
          this.advance();
          const test = this.parenExpr();
          const body = this.statement();
          return this.node<A.While>(start, { kind: "While", test, body });
        }
        case "do": {
          this.advance();
          const body = this.statement();
          this.expectName("while");
          const test = this.parenExpr();
          this.eat(";");
          return this.node<A.DoWhile>(start, { kind: "DoWhile", body, test });
        }
        case "return": {
          this.advance();
          const arg = this.canEndStatement() ? undefined : this.expression();
          this.semicolon();
          return this.node<A.Return>(start, { kind: "Return", arg });
        }
        case "break":
        case "continue": {
          this.advance();
          const label = !this.canEndStatement() && this.tok.type === "name" ? this.ident() : undefined;
          this.semicolon();
          return this.node<A.Jump>(start, { kind: t.value === "break" ? "Break" : "Continue", label });
        }
        case "throw": {
          this.advance();
          if (this.tok.nl) this.fail("Line break not permitted here.");
          const arg = this.expression();
          this.semicolon();
          return this.node<A.Throw>(start, { kind: "Throw", arg });
        }
        case "try":
          return this.tryStatement();
        case "switch":
          return this.switchStatement();
        case "with": {
          this.advance();
          const object = this.parenExpr();
          const body = this.statement();
          return this.node<A.With>(start, { kind: "With", object, body });
        }
        case "debugger":
          this.advance();
          this.semicolon();
          return this.node<A.Debugger>(start, { kind: "Debugger" });
      }
      const next = this.peek();
      if (next.type === "punct" && next.value === ":" && !RESERVED.has(t.value)) {
        const label = this.ident();
        this.advance();
        const body = this.statement();
        return this.node<A.Labeled>(start, { kind: "Labeled", label, body });
      }
    }
    const expr = this.expression();
    this.semicolon();
    return this.node<A.ExprStmt>(start, { kind: "ExprStmt", expr });
  }

  private block(): A.Block {
    const start = this.tok.start;
    this.expect("{");
    const body: A.Statement[] = [];
    while (!this.is("}")) {
      if (this.tok.type === "eof") this.fail("'}' expected.");
      body.push(this.statement());
    }
    this.advance();
    return this.node<A.Block>(start, { kind: "Block", body });
  }

  private parenExpr(): A.Expr {
    this.expect("(");
    const e = this.expression();
    this.expect(")");
    return e;
  }

  private ifStatement(): A.If {
    const start = this.tok.start;
    this.advance();
    const test = this.parenExpr();
    const then = this.statement();
    const els = this.eatName("else") ? this.statement() : undefined;
    return this.node<A.If>(start, { kind: "If", test, then, else: els });
  }

  private forStatement(): A.Statement {
    const start = this.tok.start;
    this.advance();
    const isAwait = this.eatName("await");
    this.expect("(");
    let init: A.VarDecl | A.Expr | undefined;
    if (!this.is(";")) {
      this.noIn = true;
      const t = this.tok;
      const next = t.type === "name" ? this.peek() : undefined;
      if (t.type === "name" && (t.value === "const" || t.value === "var" || (t.value === "let" && next && (next.type === "name" || (next.type === "punct" && (next.value === "[" || next.value === "{")))) || (t.value === "using" && next?.type === "name" && next.value !== "of"))) init = this.varDecl(t.start, [], false);
      else init = this.expression();
      this.noIn = false;
    }
    if (init && (this.isName("of") || this.isName("in"))) {
      const isOf = this.tok.value === "of";
      this.advance();
      const right = isOf ? this.assignment() : this.expression();
      this.expect(")");
      const body = this.statement();
      if (isOf) return this.node<A.ForOf>(start, { kind: "ForOf", left: init, right, body, await: isAwait });
      return this.node<A.ForIn>(start, { kind: "ForIn", left: init, right, body });
    }
    this.expect(";");
    const test = this.is(";") ? undefined : this.expression();
    this.expect(";");
    const update = this.is(")") ? undefined : this.expression();
    this.expect(")");
    const body = this.statement();
    return this.node<A.For>(start, { kind: "For", init, test, update, body });
  }

  private tryStatement(): A.Try {
    const start = this.tok.start;
    this.advance();
    const block = this.block();
    let param: A.Pattern | undefined;
    let paramType: A.TypeNode | undefined;
    let handler: A.Block | undefined;
    let catchStart: number | undefined;
    let finalizer: A.Block | undefined;
    if (this.isName("catch")) {
      catchStart = this.tok.start;
      this.advance();
      if (this.eat("(")) {
        param = this.bindingTarget();
        if (this.eat(":")) paramType = this.type();
        this.expect(")");
      }
      handler = this.block();
    }
    if (this.eatName("finally")) finalizer = this.block();
    if (!handler && !finalizer) this.fail("'catch' or 'finally' expected.");
    return this.node<A.Try>(start, { kind: "Try", block, param, paramType, handler, catchStart, finalizer });
  }

  private switchStatement(): A.Switch {
    const start = this.tok.start;
    this.advance();
    const disc = this.parenExpr();
    this.expect("{");
    const cases: A.SwitchCase[] = [];
    while (!this.eat("}")) {
      const cs = this.tok.start;
      let test: A.Expr | undefined;
      if (this.eatName("case")) test = this.expression();
      else if (!this.eatName("default")) this.fail("'case' or 'default' expected.");
      this.expect(":");
      const body: A.Statement[] = [];
      while (!this.isName("case") && !this.isName("default") && !this.is("}")) {
        if (this.tok.type === "eof") this.fail("'}' expected.");
        body.push(this.statement());
      }
      cases.push(this.node<A.SwitchCase>(cs, { kind: "SwitchCase", test, body }));
    }
    return this.node<A.Switch>(start, { kind: "Switch", disc, cases });
  }

  private varStatement(start: number, mods: A.Modifier[]): A.VarDecl {
    const d = this.varDecl(start, mods, this.mode === "dts" || mods.some((m) => m.name === "declare"));
    this.semicolon();
    d.end = this.prevEnd;
    return d;
  }

  private varDecl(start: number, mods: A.Modifier[], ambient: boolean): A.VarDecl {
    const kw = this.advance().value as A.VarDecl["declKind"];
    const decls: A.VarDeclarator[] = [];
    do {
      const ds = this.tok.start;
      const target = this.bindingTarget();
      const definite = this.is("!") && !this.tok.nl ? (this.advance(), true) : false;
      const type = this.eat(":") ? this.type() : undefined;
      const init = this.eat("=") ? this.assignment() : undefined;
      void ambient;
      decls.push(this.node<A.VarDeclarator>(ds, { kind: "VarDeclarator", target, type, init, definite }));
    } while (this.eat(","));
    return this.node<A.VarDecl>(start, { kind: "VarDecl", declKind: kw, decls, modifiers: mods });
  }

  private declaration(start: number, mods: A.Modifier[]): A.Statement {
    const t = this.tok;
    if (t.type !== "name") this.fail("Declaration expected.");
    switch (t.value) {
      case "function":
        return this.functionDecl(start, mods);
      case "var":
      case "let":
      case "const":
      case "using":
        if (t.value === "const" && this.peek().value === "enum") {
          this.advance();
          return this.skipDeclaration(start, "Enum");
        }
        return this.varStatement(start, mods);
      case "type": {
        this.advance();
        const name = this.ident();
        const typeParams = this.typeParamsOpt();
        this.expect("=");
        const type = this.type();
        this.semicolon();
        return this.node<A.TypeAlias>(start, { kind: "TypeAlias", name, typeParams, type, modifiers: mods });
      }
      case "interface": {
        this.advance();
        const name = this.ident();
        const typeParams = this.typeParamsOpt();
        const ext: A.TypeRef[] = [];
        if (this.eatName("extends"))
          do {
            const ty = this.typeRef();
            ext.push(ty);
          } while (this.eat(","));
        const members = this.typeMembers();
        return this.node<A.Interface>(start, { kind: "Interface", name, typeParams, extends: ext, members, modifiers: mods });
      }
      case "class":
        return this.skipDeclaration(start, "Class");
      case "enum":
        return this.skipDeclaration(start, "Enum");
      case "namespace":
      case "module":
      case "global": {
        const isGlobal = t.value === "global";
        if (!isGlobal) this.advance();
        let name: A.Ident;
        if (this.tok.type === "string") {
          const s = this.advance();
          name = { kind: "Ident", name: s.value, escaped: false, start: s.start, end: s.end };
        } else {
          name = this.ident(true);
          while (this.eat(".")) name = this.ident(true);
        }
        if (!this.is("{")) {
          this.semicolon();
          return this.node<A.Namespace>(start, { kind: "Namespace", name, body: [], modifiers: mods });
        }
        this.advance();
        const body: A.Statement[] = [];
        while (!this.eat("}")) {
          if (this.tok.type === "eof") this.fail("'}' expected.");
          body.push(this.statement());
        }
        return this.node<A.Namespace>(start, { kind: "Namespace", name, body, modifiers: mods });
      }
      case "abstract":
        this.advance();
        return this.declaration(start, mods);
    }
    this.fail("Declaration expected.");
  }

  /** Reads a class or an enum only far enough to find its end. */
  private skipDeclaration(start: number, kind: "Class" | "Enum"): A.Unsupported {
    let angles = 0;
    while (!(this.is("{") && angles === 0)) {
      if (this.tok.type === "eof") this.fail("'{' expected.");
      if (this.is("<")) angles++;
      else if (this.is(">")) angles--;
      if (this.is("{") || this.is("(") || this.is("[")) this.skipBalanced();
      else this.advance();
    }
    this.skipBalanced();
    return this.node<A.Unsupported>(start, { kind });
  }

  /** At `{`, `(` or `[`: skips to just past the matching close, following template literals and regular
   * expressions. */
  private skipBalanced(): void {
    const stack: string[] = [];
    const close: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
    const beforeExpr = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);
    let prev: Token | undefined;
    do {
      let t = this.tok;
      if (t.type === "eof") this.fail("'}' expected.");
      if (t.type === "punct" && (t.value === "/" || t.value === "/=") && (!prev || (prev.type === "punct" && !")]}".includes(prev.value)) || (prev.type === "name" && beforeExpr.has(prev.value)))) {
        t = this.s.regex(t.start, t.nl);
        this.tok = t;
      }
      if (t.type === "punct" && close[t.value]) stack.push(close[t.value]);
      else if (t.type === "punct" && (t.value === "}" || t.value === ")" || t.value === "]")) {
        if (stack[stack.length - 1] === "`}") {
          stack.pop();
          this.s.pos = t.end;
          const piece = this.s.templatePiece(t.start, t.nl);
          this.prevEnd = piece.end;
          if (!piece.tail) stack.push("`}");
          prev = piece;
          this.tok = this.s.next();
          continue;
        }
        stack.pop();
      } else if (t.type === "template" && !t.tail) stack.push("`}");
      prev = t;
      this.advance();
    } while (stack.length);
  }

  private functionDecl(start: number, mods: A.Modifier[]): A.FunctionDecl {
    this.expectName("function");
    const generator = this.eat("*");
    const name = this.tok.type === "name" && !this.is("(") ? this.ident() : undefined;
    const outerGen = this.inGenerator;
    this.inGenerator = generator;
    const typeParams = this.typeParamsOpt();
    const params = this.params();
    const returnType = this.eat(":") ? this.returnType() : undefined;
    let body: A.Block | undefined;
    if (this.is("{")) body = this.block();
    else this.semicolon();
    this.inGenerator = outerGen;
    const isAsync = mods.some((m) => m.name === "async");
    return this.node<A.FunctionDecl>(start, { kind: "FunctionDecl", name, typeParams, params, returnType, async: isAsync, generator, modifiers: mods, body });
  }

  private importDecl(): A.Statement {
    const start = this.tok.start;
    this.advance();
    let typeOnly = false;
    if (this.isName("type")) {
      const next = this.peek();
      if ((next.type === "name" && next.value !== "from") || (next.type === "punct" && (next.value === "{" || next.value === "*"))) {
        this.advance();
        typeOnly = true;
      } else if (next.type === "name" && next.value === "from") {
        const st = this.save();
        this.advance();
        this.advance();
        const isFrom = this.tok.type === "string";
        this.restore(st);
        if (!isFrom) {
          this.advance();
          typeOnly = true;
        }
      }
    }
    let defaultName: A.Ident | undefined;
    let namespace: A.Ident | undefined;
    let named: A.ImportSpec[] | undefined;
    if (this.tok.type === "string") {
      const source = this.stringLit();
      const attributes = this.importAttributes();
      this.semicolon();
      return this.node<A.Import>(start, { kind: "Import", source, typeOnly, attributes });
    }
    if (this.tok.type === "name") {
      defaultName = this.ident();
      if (this.is("=")) {
        while (!this.canEndStatement()) this.advance();
        this.semicolon();
        return this.node<A.Unsupported>(start, { kind: "ImportEquals" });
      }
      if (!this.eat(",")) {
        this.expectName("from");
        const source = this.stringLit();
        const attributes = this.importAttributes();
        this.semicolon();
        return this.node<A.Import>(start, { kind: "Import", source, typeOnly, defaultName, attributes });
      }
    }
    if (this.eat("*")) {
      this.expectName("as");
      namespace = this.ident();
    } else if (this.is("{")) {
      this.advance();
      named = [];
      while (!this.eat("}")) {
        const ss = this.tok.start;
        let specType = false;
        if (this.isName("type")) {
          const next = this.peek();
          if ((next.type === "name" && next.value !== "as") || next.type === "string") {
            this.advance();
            specType = true;
          }
        }
        let imported: A.Ident | A.Str;
        if (this.atString()) imported = this.stringLit();
        else imported = this.ident(true);
        let local: A.Ident;
        let renamed = false;
        if (this.eatName("as")) {
          local = this.ident();
          renamed = true;
        } else {
          if (imported.kind !== "Ident") this.fail("'as' expected.");
          if (RESERVED.has(imported.name) && !imported.escaped) this.fail(`Identifier expected. '${imported.name}' is a reserved word that cannot be used here.`, imported.start);
          local = imported;
        }
        named.push(this.node<A.ImportSpec>(ss, { kind: "ImportSpec", imported, local, typeOnly: specType, renamed }));
        if (!this.is("}")) this.expect(",");
      }
    } else this.fail("'{' expected.");
    this.expectName("from");
    const source = this.stringLit();
    const attributes = this.importAttributes();
    this.semicolon();
    return this.node<A.Import>(start, { kind: "Import", source, typeOnly, defaultName, namespace, named, attributes });
  }

  private importAttributes(): (A.Base & { kind: "ImportAttributes" }) | undefined {
    if (!(this.isName("with") || this.isName("assert")) || this.tok.nl) return undefined;
    const start = this.tok.start;
    this.advance();
    if (!this.is("{")) this.fail("'{' expected.");
    this.skipBalanced();
    return { kind: "ImportAttributes", start, end: this.prevEnd };
  }

  private stringLit(): A.Str {
    if (this.tok.type !== "string") this.fail("String literal expected.");
    const t = this.advance();
    return { kind: "Str", value: t.value, raw: this.text.slice(t.start, t.end), start: t.start, end: t.end };
  }

  private exportDecl(): A.Statement {
    const start = this.tok.start;
    const next = this.peek();
    if (next.type === "punct" && next.value === "=") {
      this.advance();
      this.advance();
      const expr = this.assignment();
      this.semicolon();
      return this.node<A.ExportEquals>(start, { kind: "ExportEquals", expr });
    }
    if ((next.type === "punct" && next.value === "*") || (next.type === "name" && next.value === "type" && this.peek2Is("*"))) {
      this.advance();
      this.eatName("type");
      this.advance();
      if (this.eatName("as")) this.ident(true);
      this.expectName("from");
      const source = this.stringLit();
      this.importAttributes();
      this.semicolon();
      return this.node<A.ExportAll>(start, { kind: "ExportAll", source });
    }
    if ((next.type === "punct" && next.value === "{") || (next.type === "name" && next.value === "type" && this.peek2IsBrace())) {
      this.advance();
      const typeOnly = this.eatName("type");
      this.expect("{");
      const specs: A.ExportSpec[] = [];
      while (!this.eat("}")) {
        const ss = this.tok.start;
        let specType = false;
        if (this.isName("type")) {
          const n = this.peek();
          if (n.type === "name" || n.type === "string") {
            this.advance();
            specType = true;
          }
        }
        const local: A.Ident | A.Str = this.tok.type === "string" ? this.stringLit() : this.ident(true);
        const exported: A.Ident | A.Str = this.eatName("as") ? (this.tok.type === "string" ? this.stringLit() : this.ident(true)) : local;
        specs.push(this.node<A.ExportSpec>(ss, { kind: "ExportSpec", local, exported, typeOnly: specType }));
        if (!this.is("}")) this.expect(",");
      }
      const source = this.eatName("from") ? this.stringLit() : undefined;
      if (source) this.importAttributes();
      this.semicolon();
      return this.node<A.ExportNamed>(start, { kind: "ExportNamed", specs, source, typeOnly });
    }
    if (next.type === "name" && next.value === "import") {
      this.advance();
      while (!this.canEndStatement()) this.advance();
      this.semicolon();
      return this.node<A.Unsupported>(start, { kind: "ImportEquals" });
    }
    if (next.type === "name" && next.value === "as") {
      this.advance();
      this.advance();
      this.expectName("namespace");
      const name = this.ident();
      this.semicolon();
      return this.node<A.Namespace>(start, { kind: "Namespace", name, body: [], modifiers: [] });
    }
    if (next.type === "name" && next.value === "default") {
      const st = this.save();
      const mods = this.modifiers();
      if (mods.some((m) => m.name === "default") && (this.isName("function") || this.isName("class") || this.isName("interface") || this.isName("abstract"))) return this.declaration(start, mods);
      this.restore(st);
      this.advance();
      this.advance();
      const expr = this.assignment();
      this.semicolon();
      return this.node<A.ExportDefault>(start, { kind: "ExportDefault", expr });
    }
    const mods = this.modifiers();
    if (!mods.length) this.fail("Declaration expected.");
    return this.declaration(start, mods);
  }

  private peek2IsBrace(): boolean {
    return this.peek2Is("{");
  }

  private peek2Is(value: string): boolean {
    const st = this.save();
    this.advance();
    this.advance();
    const r = this.is(value);
    this.restore(st);
    return r;
  }

  // ---- bindings and parameters ----

  private bindingTarget(): A.Pattern {
    const start = this.tok.start;
    if (this.is("{")) {
      this.advance();
      const elements: A.BindingElement[] = [];
      while (!this.eat("}")) {
        const es = this.tok.start;
        if (this.eat("...")) {
          const target = this.bindingTarget();
          elements.push(this.node<A.BindingElement>(es, { kind: "BindingElement", target, rest: true }));
        } else {
          const key = this.propertyKey();
          let target: A.Pattern;
          let k: A.PropKey | undefined = key;
          if (this.eat(":")) target = this.bindingTarget();
          else {
            if (key.kind !== "Ident") this.fail("':' expected.");
            if (RESERVED.has(key.name) && !key.escaped) this.fail(`Identifier expected. '${key.name}' is a reserved word that cannot be used here.`, key.start);
            target = key;
            k = undefined;
          }
          const init = this.eat("=") ? this.assignment() : undefined;
          elements.push(this.node<A.BindingElement>(es, { kind: "BindingElement", key: k, target, init, rest: false }));
        }
        if (!this.is("}")) this.expect(",");
      }
      return this.node<A.ObjectPattern>(start, { kind: "ObjectPattern", elements });
    }
    if (this.is("[")) {
      this.advance();
      const elements: (A.BindingElement | A.Hole)[] = [];
      while (!this.eat("]")) {
        const es = this.tok.start;
        if (this.is(",")) {
          this.advance();
          elements.push({ kind: "Hole", start: es, end: es });
          continue;
        }
        const rest = this.eat("...");
        const target = this.bindingTarget();
        const init = this.eat("=") ? this.assignment() : undefined;
        elements.push(this.node<A.BindingElement>(es, { kind: "BindingElement", target, init, rest }));
        if (!this.is("]")) this.expect(",");
      }
      return this.node<A.ArrayPattern>(start, { kind: "ArrayPattern", elements });
    }
    return this.ident();
  }

  private params(): A.Param[] {
    this.expect("(");
    const out: A.Param[] = [];
    while (!this.eat(")")) {
      out.push(this.param());
      if (!this.is(")")) this.expect(",");
    }
    return out;
  }

  private param(): A.Param {
    const start = this.tok.start;
    const mods: A.Modifier[] = [];
    while (this.tok.type === "name" && ["public", "private", "protected", "readonly", "override"].includes(this.tok.value)) {
      const next = this.peek();
      if (!(next.type === "name" || (next.type === "punct" && (next.value === "{" || next.value === "[")))) break;
      const t = this.advance();
      mods.push({ kind: "Modifier", name: t.value, start: t.start, end: t.end });
    }
    if (this.is("@")) this.fail("Decorators are not valid here.");
    const rest = this.eat("...");
    const target = this.isName("this") ? this.ident(true) : this.bindingTarget();
    const optional = this.eat("?");
    const type = this.eat(":") ? this.type() : undefined;
    const init = this.eat("=") ? this.assignment() : undefined;
    return this.node<A.Param>(start, { kind: "Param", target, type, init, rest, optional, modifiers: mods });
  }

  // ---- expressions ----

  expression(): A.Expr {
    const start = this.tok.start;
    let e = this.assignment();
    while (this.is(",")) {
      const opStart = this.tok.start;
      this.advance();
      const right = this.assignment();
      e = this.node<A.Binary>(start, { kind: "Binary", op: ",", opStart, left: e, right });
    }
    return e;
  }

  private assignment(): A.Expr {
    const start = this.tok.start;
    if (this.isName("yield") && this.inGenerator) {
      this.advance();
      const arg = this.canEndStatement() || this.is(")") || this.is("]") || this.is(",") ? undefined : this.assignment();
      return this.node<A.Yield>(start, { kind: "Yield", arg });
    }
    const arrow = this.arrowOpt();
    if (arrow) return arrow;
    const left = this.conditional();
    if (this.tok.type === "punct") {
      let op = this.tok.value;
      if (op === ">") {
        const joined = this.s.greater(this.tok);
        if (joined.value === ">>=" || joined.value === ">>>=") {
          op = joined.value;
          this.tok = joined;
        } else this.s.pos = this.tok.end;
      }
      if (ASSIGN_OPS.has(op)) {
        this.advance();
        const right = this.assignment();
        return this.node<A.Assign>(start, { kind: "Assign", op, left, right });
      }
    }
    return left;
  }

  private conditional(): A.Expr {
    const start = this.tok.start;
    const test = this.binary(0);
    if (!this.is("?")) return test;
    this.advance();
    const noIn = this.noIn;
    this.noIn = false;
    const cons = this.assignment();
    this.noIn = noIn;
    this.expect(":");
    const alt = this.assignment();
    return this.node<A.Cond>(start, { kind: "Cond", test, cons, alt });
  }

  private binaryOp(): string | undefined {
    const t = this.tok;
    if (t.type === "punct") {
      if (t.value === ">") {
        const joined = this.s.greater(t);
        if (joined.value === ">=" || joined.value === ">>" || joined.value === ">>>") {
          this.tok = joined;
          return joined.value;
        }
        this.s.pos = t.end;
        return joined.value === ">" ? ">" : undefined;
      }
      return BINARY_PREC[t.value] !== undefined ? t.value : undefined;
    }
    if (t.type === "name" && !t.escaped) {
      if (t.value === "instanceof") return t.value;
      if (t.value === "in" && !this.noIn) return t.value;
      if ((t.value === "as" || t.value === "satisfies") && !t.nl && this.mode !== "js") return t.value;
    }
    return undefined;
  }

  private binary(minPrec: number): A.Expr {
    const start = this.tok.start;
    let left = this.unary();
    while (true) {
      const op = this.binaryOp();
      if (!op) break;
      if (op === "as" || op === "satisfies") {
        if (8 <= minPrec) break;
        this.advance();
        if (op === "as" && this.isName("const")) {
          const t = this.advance();
          const type: A.TypeRef = { kind: "TypeRef", name: { kind: "Ident", name: "const", escaped: false, start: t.start, end: t.end }, start: t.start, end: t.end };
          left = this.node<A.As>(start, { kind: "As", expr: left, type });
        } else {
          const type = this.type();
          left = this.node<A.As>(start, { kind: op === "as" ? "As" : "Satisfies", expr: left, type });
        }
        continue;
      }
      const prec = BINARY_PREC[op];
      if (prec <= minPrec && !(op === "**" && prec === minPrec)) break;
      if (op === "**" && left.kind === "Unary") this.fail("An unary expression with the 'typeof', 'void', 'delete', '-', '+', '!' or '~' operator is not allowed in the left-hand side of an exponentiation expression. Consider enclosing the expression in parentheses.", left.start);
      const opStart = this.tok.start;
      this.advance();
      const right = op === "**" ? this.binary(prec - 1) : this.binary(prec);
      if (op === "??" || op === "||" || op === "&&") {
        const mixes = (e: A.Expr) => e.kind === "Binary" && (op === "??" ? e.op === "||" || e.op === "&&" : e.op === "??");
        if (mixes(left) || mixes(right)) this.fail(`'${op === "??" ? "||" : "??"}' and '${op}' operations cannot be mixed without parentheses.`, opStart);
      }
      left = this.node<A.Binary>(start, { kind: "Binary", op, opStart, left, right });
    }
    return left;
  }

  private unary(): A.Expr {
    const start = this.tok.start;
    const t = this.tok;
    if (t.type === "punct" && (t.value === "!" || t.value === "-" || t.value === "+" || t.value === "~")) {
      this.advance();
      const arg = this.unary();
      return this.node<A.Unary>(start, { kind: "Unary", op: t.value as A.Unary["op"], arg });
    }
    if (t.type === "punct" && (t.value === "++" || t.value === "--")) {
      this.advance();
      const arg = this.unary();
      return this.node<A.Update>(start, { kind: "Update", op: t.value as "++" | "--", prefix: true, arg });
    }
    if (t.type === "name" && !t.escaped && (t.value === "typeof" || t.value === "void" || t.value === "delete")) {
      this.advance();
      const arg = this.unary();
      return this.node<A.Unary>(start, { kind: "Unary", op: t.value, arg });
    }
    if (t.type === "name" && !t.escaped && t.value === "await") {
      const next = this.peek();
      if (this.startsExpression(next)) {
        this.advance();
        const arg = this.unary();
        return this.node<A.Await>(start, { kind: "Await", arg });
      }
    }
    if (t.type === "punct" && t.value === "<" && this.mode === "dts") {
      this.advance();
      this.type();
      this.expect(">");
      const expr = this.unary();
      return this.node<A.As>(start, { kind: "As", expr, type: { kind: "KeywordType", name: "unknown", start, end: start } });
    }
    const e = this.postfix();
    return e;
  }

  private startsExpression(t: Token): boolean {
    if (t.type === "eof") return false;
    if (t.type === "punct") return ["(", "[", "{", "!", "-", "+", "~", "++", "--", "<", "/", "/=", "@"].includes(t.value);
    if (t.type === "name") return !["in", "of", "as", "satisfies", "instanceof"].includes(t.value);
    return true;
  }

  private postfix(): A.Expr {
    const start = this.tok.start;
    const e = this.leftHandSide();
    if ((this.is("++") || this.is("--")) && !this.tok.nl) {
      const op = this.advance().value as "++" | "--";
      return this.node<A.Update>(start, { kind: "Update", op, prefix: false, arg: e });
    }
    return e;
  }

  private leftHandSide(): A.Expr {
    const start = this.tok.start;
    let e: A.Expr;
    if (this.isName("new")) e = this.newExpr();
    else if (this.isName("super")) {
      const t = this.advance();
      e = { kind: "Super", start: t.start, end: t.end };
    } else if (this.isName("import")) {
      const t = this.advance();
      if (this.eat(".")) {
        this.ident(true);
        e = this.node<A.Keyword>(start, { kind: "ImportMeta" });
      } else {
        const args = this.args() as A.Expr[];
        e = this.node<A.ImportCall>(t.start, { kind: "ImportCall", args });
      }
    } else e = this.primary();
    return this.suffixes(start, e, true);
  }

  private newExpr(): A.Expr {
    const start = this.tok.start;
    this.advance();
    if (this.eat(".")) {
      this.ident(true);
      return this.node<A.Keyword>(start, { kind: "NewTarget" });
    }
    let callee: A.Expr = this.isName("new") ? this.newExpr() : this.primary();
    callee = this.suffixes(callee.start, callee, false);
    let typeArgs: A.TypeNode[] | undefined;
    if (this.is("<")) typeArgs = this.tryParse(() => this.typeArgs());
    const args = this.is("(") ? this.args() : undefined;
    return this.node<A.New>(start, { kind: "New", callee, typeArgs, args });
  }

  private suffixes(start: number, e: A.Expr, allowCalls: boolean): A.Expr {
    let chain = false;
    while (true) {
      const t = this.tok;
      if (t.type === "punct" && t.value === ".") {
        this.advance();
        const prop = this.tok.type === "private" ? this.privateName() : this.ident(true);
        e = this.node<A.Member>(start, { kind: "Member", object: e, prop, optional: false, inChain: chain });
        continue;
      }
      if (t.type === "punct" && t.value === "?." && allowCalls) {
        this.advance();
        chain = true;
        if (this.is("[")) {
          this.advance();
          const index = this.expression();
          this.expect("]");
          e = this.node<A.Index>(start, { kind: "Index", object: e, index, optional: true, inChain: true });
        } else if (this.is("(") || this.is("<")) {
          const typeArgs = this.is("<") ? this.typeArgs() : undefined;
          const args = this.args();
          e = this.node<A.Call>(start, { kind: "Call", callee: e, typeArgs, args, optional: true, inChain: true });
        } else {
          const prop = this.tok.type === "private" ? this.privateName() : this.ident(true);
          e = this.node<A.Member>(start, { kind: "Member", object: e, prop, optional: true, inChain: true });
        }
        continue;
      }
      if (t.type === "punct" && t.value === "[") {
        this.advance();
        const noIn = this.noIn;
        this.noIn = false;
        const index = this.expression();
        this.noIn = noIn;
        this.expect("]");
        e = this.node<A.Index>(start, { kind: "Index", object: e, index, optional: false, inChain: chain });
        continue;
      }
      if (t.type === "punct" && t.value === "!" && !t.nl && this.mode !== "js") {
        const next = this.peek();
        if (next.type === "punct" && (next.value === "=" || next.value === "==" || next.value === "===")) break;
        this.advance();
        e = this.node<A.NonNull>(start, { kind: "NonNull", expr: e });
        continue;
      }
      if (t.type === "template") {
        if (chain) this.fail("Tagged template expressions are not permitted in an optional chain.");
        const quasi = this.template();
        e = this.node<A.TaggedTemplate>(start, { kind: "TaggedTemplate", tag: e, quasi });
        continue;
      }
      if (!allowCalls) break;
      if (t.type === "punct" && t.value === "(") {
        const args = this.args();
        e = this.node<A.Call>(start, { kind: "Call", callee: e, args, optional: false, inChain: chain });
        continue;
      }
      if (t.type === "punct" && t.value === "<" && this.mode !== "js") {
        const typeArgs = this.tryParse(() => {
          const ta = this.typeArgs();
          if (this.is("(") || this.tok.type === "template") return ta;
          return undefined;
        });
        if (typeArgs) {
          if (this.tok.type === "template") {
            const quasi = this.template();
            e = this.node<A.TaggedTemplate>(start, { kind: "TaggedTemplate", tag: e, quasi });
            continue;
          }
          const args = this.args();
          e = this.node<A.Call>(start, { kind: "Call", callee: e, typeArgs, args, optional: false, inChain: chain });
          continue;
        }
      }
      break;
    }
    return e;
  }

  private privateName(): A.PrivateName {
    const t = this.advance();
    return { kind: "PrivateName", name: t.value, start: t.start, end: t.end };
  }

  private args(): (A.Expr | A.Spread)[] {
    this.expect("(");
    const out: (A.Expr | A.Spread)[] = [];
    const noIn = this.noIn;
    this.noIn = false;
    while (!this.eat(")")) {
      const start = this.tok.start;
      if (this.eat("...")) {
        const arg = this.assignment();
        out.push(this.node<A.Spread>(start, { kind: "Spread", arg }));
      } else out.push(this.assignment());
      if (!this.is(")")) this.expect(",");
    }
    this.noIn = noIn;
    return out;
  }

  private template(): A.Template {
    const start = this.tok.start;
    const quasis: A.TemplateQuasi[] = [];
    const exprs: A.Expr[] = [];
    let piece = this.tok;
    if (piece.type !== "template") this.fail("Template literal expected.");
    this.advance();
    quasis.push({ cooked: piece.value, raw: piece.raw! });
    const noIn = this.noIn;
    this.noIn = false;
    while (!piece.tail) {
      exprs.push(this.expression());
      if (!this.is("}")) this.fail("'}' expected.");
      this.s.pos = this.tok.end;
      piece = this.s.templatePiece(this.tok.start, this.tok.nl);
      this.prevEnd = piece.end;
      this.tok = this.s.next();
      quasis.push({ cooked: piece.value, raw: piece.raw! });
    }
    this.noIn = noIn;
    return this.node<A.Template>(start, { kind: "Template", quasis, exprs });
  }

  private primary(): A.Expr {
    const t = this.tok;
    const start = t.start;
    switch (t.type) {
      case "num":
        this.advance();
        return { kind: "Num", value: t.num!, raw: t.value, start, end: t.end };
      case "string":
        this.advance();
        return { kind: "Str", value: t.value, raw: this.text.slice(t.start, t.end), start, end: t.end };
      case "template":
        return this.template();
      case "bigint":
        this.advance();
        return { kind: "BigInt", start, end: t.end };
      case "private":
        return this.privateName();
      case "name": {
        if (!t.escaped)
          switch (t.value) {
            case "true":
            case "false":
              this.advance();
              return { kind: "Bool", value: t.value === "true", start, end: t.end };
            case "null":
              this.advance();
              return { kind: "Null", start, end: t.end };
            case "this":
              this.advance();
              return { kind: "This", start, end: t.end };
            case "function":
              return this.functionExpr(start, false);
            case "async": {
              const next = this.peek();
              if (next.type === "name" && next.value === "function" && !next.nl) {
                this.advance();
                return this.functionExpr(start, true);
              }
              break;
            }
            case "class": {
              this.skipDeclaration(start, "Class");
              return this.node<A.Keyword>(start, { kind: "ClassExpr" });
            }
          }
        return this.ident();
      }
      case "punct":
        switch (t.value) {
          case "(": {
            this.advance();
            const noIn = this.noIn;
            this.noIn = false;
            const expr = this.expression();
            this.noIn = noIn;
            this.expect(")");
            return this.node<A.Paren>(start, { kind: "Paren", expr });
          }
          case "[":
            return this.arrayLit();
          case "{":
            return this.objectLit();
          case "/":
          case "/=": {
            const re = this.s.regex(t.start, t.nl);
            this.prevEnd = re.end;
            this.tok = this.s.next();
            return { kind: "Regex", start, end: re.end };
          }
          case "<":
            if (this.mode === "tsx") return this.jsx();
            break;
        }
    }
    this.fail("Expression expected.");
  }

  private functionExpr(start: number, isAsync: boolean): A.FunctionExpr {
    this.expectName("function");
    const generator = this.eat("*");
    const outerGen = this.inGenerator;
    this.inGenerator = generator;
    const name = this.tok.type === "name" ? this.ident() : undefined;
    const typeParams = this.typeParamsOpt();
    const params = this.params();
    const returnType = this.eat(":") ? this.returnType() : undefined;
    const body = this.block();
    this.inGenerator = outerGen;
    const mods: A.Modifier[] = isAsync ? [{ kind: "Modifier", name: "async", start, end: start + 5 }] : [];
    return this.node<A.FunctionExpr>(start, { kind: "Function", name, typeParams, params, returnType, async: isAsync, generator, modifiers: mods, body });
  }

  private arrayLit(): A.ArrayLit {
    const start = this.tok.start;
    this.advance();
    const elements: (A.Expr | A.Spread | A.Hole)[] = [];
    const noIn = this.noIn;
    this.noIn = false;
    while (!this.eat("]")) {
      const es = this.tok.start;
      if (this.is(",")) {
        this.advance();
        elements.push({ kind: "Hole", start: es, end: es });
        continue;
      }
      if (this.eat("...")) {
        const arg = this.assignment();
        elements.push(this.node<A.Spread>(es, { kind: "Spread", arg }));
      } else elements.push(this.assignment());
      if (!this.is("]")) this.expect(",");
    }
    this.noIn = noIn;
    return this.node<A.ArrayLit>(start, { kind: "Array", elements });
  }

  private objectLit(): A.ObjectLit {
    const start = this.tok.start;
    this.advance();
    const props: A.ObjectLit["props"] = [];
    const noIn = this.noIn;
    this.noIn = false;
    while (!this.eat("}")) {
      props.push(this.objectMember());
      if (!this.is("}")) this.expect(",");
    }
    this.noIn = noIn;
    return this.node<A.ObjectLit>(start, { kind: "Object", props });
  }

  private objectMember(): A.ObjectLit["props"][number] {
    const start = this.tok.start;
    if (this.eat("...")) {
      const arg = this.assignment();
      return this.node<A.Spread>(start, { kind: "Spread", arg });
    }
    const mods: A.Modifier[] = [];
    let isAsync = false;
    let generator = false;
    if (this.isName("async") || this.isName("get") || this.isName("set")) {
      const next = this.peek();
      const keyFollows = !next.nl && (next.type === "name" || next.type === "string" || next.type === "num" || next.type === "private" || (next.type === "punct" && (next.value === "[" || next.value === "*")));
      if (keyFollows) {
        const word = this.advance();
        if (word.value === "get" || word.value === "set") {
          const key = this.propertyKey();
          this.params();
          if (this.eat(":")) this.type();
          this.block();
          return this.node<A.Accessor>(start, { kind: word.value === "get" ? "Getter" : "Setter", key });
        }
        isAsync = true;
        mods.push({ kind: "Modifier", name: "async", start: word.start, end: word.end });
      }
    }
    if (this.eat("*")) generator = true;
    const key = this.propertyKey();
    const optional = this.eat("?");
    if (this.is("(") || this.is("<")) {
      const outerGen = this.inGenerator;
      this.inGenerator = generator;
      const typeParams = this.typeParamsOpt();
      const params = this.params();
      const returnType = this.eat(":") ? this.returnType() : undefined;
      const body = this.block();
      this.inGenerator = outerGen;
      return this.node<A.Method>(start, { kind: "Method", key, optional, typeParams, params, returnType, async: isAsync, generator, modifiers: mods, body });
    }
    if (this.eat(":")) {
      const value = this.assignment();
      return this.node<A.Prop>(start, { kind: "Prop", key, value });
    }
    if (key.kind !== "Ident") this.fail("':' expected.");
    if (RESERVED.has(key.name) && !key.escaped) this.fail(`Identifier expected. '${key.name}' is a reserved word that cannot be used here.`, key.start);
    const init = this.eat("=") ? this.assignment() : undefined;
    return this.node<A.Shorthand>(start, { kind: "Shorthand", name: key, init });
  }

  // ---- arrow functions ----

  private arrowOpt(): A.Arrow | undefined {
    const t = this.tok;
    let head: ArrowHead | undefined;
    if (t.type === "name" && !t.escaped && t.value === "async") {
      const next = this.peek();
      if (!next.nl && (next.type === "name" || (next.type === "punct" && (next.value === "(" || next.value === "<"))))
        head = this.tryParse(() => {
          this.advance();
          return this.arrowHead();
        });
      if (head) return this.arrowBody(t.start, true, head);
    }
    if (t.type === "name" && !t.escaped && !RESERVED.has(t.value)) {
      const next = this.peek();
      if (!(next.type === "punct" && next.value === "=>" && !next.nl)) return undefined;
      head = this.arrowHead();
    } else if (t.type === "punct" && (t.value === "(" || (t.value === "<" && this.mode !== "js"))) {
      if (t.value === "<" && this.mode === "tsx") {
        const st = this.save();
        this.advance();
        let generic = false;
        if (this.tok.type === "name") {
          const n = this.peek();
          generic = (n.type === "punct" && n.value === ",") || (n.type === "name" && n.value === "extends");
        }
        this.restore(st);
        if (!generic) return undefined;
      }
      head = this.tryParse(() => this.arrowHead());
    }
    return head ? this.arrowBody(t.start, false, head) : undefined;
  }

  /** Parameters, return type and `=>`; undefined when what follows is not an arrow function. */
  private arrowHead(): ArrowHead | undefined {
    let typeParams: A.TypeParam[] | undefined;
    let params: A.Param[];
    if (this.tok.type === "name") {
      const id = this.ident();
      params = [{ kind: "Param", target: id, rest: false, optional: false, modifiers: [], start: id.start, end: id.end }];
    } else {
      typeParams = this.typeParamsOpt();
      params = this.params();
    }
    let returnType: A.TypeNode | undefined;
    if (this.is(":")) {
      this.advance();
      returnType = this.returnType();
    }
    if (!this.is("=>") || this.tok.nl) return undefined;
    this.advance();
    return { typeParams, params, returnType };
  }

  private arrowBody(start: number, isAsync: boolean, head: ArrowHead): A.Arrow {
    const outerGen = this.inGenerator;
    this.inGenerator = false;
    let body: A.Block | A.Expr;
    if (this.is("{")) body = this.block();
    else body = this.assignment();
    this.inGenerator = outerGen;
    const mods: A.Modifier[] = isAsync ? [{ kind: "Modifier", name: "async", start, end: start + 5 }] : [];
    return this.node<A.Arrow>(start, { kind: "Arrow", ...head, async: isAsync, generator: false, modifiers: mods, body });
  }

  // ---- JSX ----

  private jsxTagName(): A.JsxTagName {
    if (this.tok.type !== "name") this.fail("Identifier expected.");
    const start = this.tok.start;
    const first = this.s.jsxName(this.tok);
    this.tok = first;
    this.advance();
    let name: A.JsxTagName = { kind: "Ident", name: first.value, escaped: !!first.escaped, start: first.start, end: first.end };
    if (this.is(":") && this.tok.start === first.end) {
      this.advance();
      const local = this.jsxIdent();
      return this.node<A.JsxNamespacedName>(start, { kind: "JsxNamespacedName", namespace: name as A.Ident, name: local });
    }
    while (this.is(".")) {
      this.advance();
      const prop = this.ident(true);
      name = this.node<A.JsxMemberName>(start, { kind: "JsxMemberName", object: name as A.Ident | A.JsxMemberName, prop });
    }
    return name;
  }

  private jsxIdent(): A.Ident {
    if (this.tok.type !== "name") this.fail("Identifier expected.");
    const t = this.s.jsxName(this.tok);
    this.tok = t;
    this.advance();
    return { kind: "Ident", name: t.value, escaped: !!t.escaped, start: t.start, end: t.end };
  }

  /** At the `>` that ends a tag: steps past it. Inside a parent's children the next thing is JSX text, so the
   * scanner is left just after the `>` for the parent to read on. */
  private endTag(child: boolean): void {
    if (!this.is(">")) this.fail("'>' expected.");
    if (child) {
      this.prevEnd = this.tok.end;
      this.s.pos = this.tok.end;
    } else this.advance();
  }

  private jsx(child = false): A.JsxElement | A.JsxFragment {
    const start = this.tok.start;
    this.expect("<");
    if (this.is(">")) {
      const children = this.jsxChildren();
      this.expect("<");
      this.expect("/");
      if (!this.is(">")) this.fail("Expected corresponding closing tag for JSX fragment.");
      this.endTag(child);
      return this.node<A.JsxFragment>(start, { kind: "JsxFragment", children });
    }
    const name = this.jsxTagName();
    const typeArgs = this.is("<") ? this.typeArgs() : undefined;
    const attrs: (A.JsxAttr | A.JsxSpreadAttr)[] = [];
    while (!this.is("/") && !this.is(">")) {
      const as = this.tok.start;
      if (this.is("{")) {
        this.advance();
        this.expect("...");
        const arg = this.assignment();
        this.expect("}");
        attrs.push(this.node<A.JsxSpreadAttr>(as, { kind: "JsxSpreadAttr", arg }));
        continue;
      }
      let attrName: A.Ident | A.JsxNamespacedName = this.jsxIdent();
      if (this.is(":") && this.tok.start === attrName.end) {
        this.advance();
        const local = this.jsxIdent();
        attrName = this.node<A.JsxNamespacedName>(as, { kind: "JsxNamespacedName", namespace: attrName, name: local });
      }
      let value: A.JsxAttr["value"];
      if (this.is("=")) {
        const str = this.s.jsxStringAfter(this.tok.end);
        if (str) {
          this.prevEnd = str.end;
          this.tok = this.s.next();
          value = { kind: "Str", value: str.value, raw: this.text.slice(str.start, str.end), start: str.start, end: str.end };
        } else {
          this.advance();
          if (this.is("{")) value = this.jsxExprContainer(false);
          else if (this.is("<")) value = this.jsx();
          else this.fail("'{' expected.");
        }
      }
      attrs.push(this.node<A.JsxAttr>(as, { kind: "JsxAttr", name: attrName, value }));
    }
    if (this.is("/")) {
      this.advance();
      this.endTag(child);
      return this.node<A.JsxElement>(start, { kind: "JsxElement", name, typeArgs, attrs });
    }
    const children = this.jsxChildren();
    this.expect("<");
    this.expect("/");
    const close = this.jsxTagName();
    if (jsxNameText(close) !== jsxNameText(name)) this.fail(`Expected corresponding JSX closing tag for '${jsxNameText(name)}'.`, close.start);
    this.endTag(child);
    return this.node<A.JsxElement>(start, { kind: "JsxElement", name, typeArgs, attrs, children });
  }

  /** At the `>` that opens an element's children: reads them up to the `<` of `</`, which becomes the current token. */
  private jsxChildren(): A.JsxChild[] {
    const children: A.JsxChild[] = [];
    this.s.pos = this.tok.end;
    this.prevEnd = this.tok.end;
    while (true) {
      const t = this.s.jsxChild();
      if (t.type === "eof") this.fail("JSX element has no corresponding closing tag.", t.start);
      if (t.type === "jsxText") {
        children.push({ kind: "JsxText", raw: t.value, start: t.start, end: t.end });
        continue;
      }
      this.tok = t;
      if (t.value === "{") {
        children.push(this.jsxExprContainer(true));
        continue;
      }
      const save = this.s.pos;
      const after = this.s.next();
      this.s.pos = save;
      if (after.type === "punct" && after.value === "/") return children;
      children.push(this.jsx(true));
    }
  }

  private jsxExprContainer(child: boolean): A.JsxExprContainer {
    const start = this.tok.start;
    this.expect("{");
    const spread = this.eat("...");
    let expr: A.Expr | undefined;
    if (!this.is("}")) expr = this.expression();
    if (!this.is("}")) this.fail("'}' expected.");
    if (child) {
      this.prevEnd = this.tok.end;
      this.s.pos = this.tok.end;
    } else this.advance();
    return { kind: "JsxExprContainer", expr, spread, start, end: this.prevEnd };
  }

  // ---- types ----

  private typeParamsOpt(): A.TypeParam[] | undefined {
    if (!this.is("<")) return undefined;
    this.advance();
    const out: A.TypeParam[] = [];
    while (!this.eatGreater()) {
      const start = this.tok.start;
      const mods: A.Modifier[] = [];
      while ((this.isName("in") || this.isName("out") || this.isName("const")) && this.peek().type === "name") {
        const t = this.advance();
        mods.push({ kind: "Modifier", name: t.value, start: t.start, end: t.end });
      }
      const name = this.ident();
      const constraint = this.eatName("extends") ? this.type() : undefined;
      const def = this.eat("=") ? this.type() : undefined;
      out.push(this.node<A.TypeParam>(start, { kind: "TypeParam", name, constraint, default: def, modifiers: mods }));
      if (!this.is(">")) this.expect(",");
    }
    return out;
  }

  private eatGreater(): boolean {
    if (this.is(">")) {
      this.advance();
      return true;
    }
    return false;
  }

  private typeArgs(): A.TypeNode[] {
    this.expect("<");
    const out: A.TypeNode[] = [];
    while (!this.eatGreater()) {
      out.push(this.type());
      if (!this.is(">")) this.expect(",");
    }
    return out;
  }

  private returnType(): A.TypeNode {
    const start = this.tok.start;
    if (this.isName("asserts")) {
      const next = this.peek();
      if (next.type === "name" && !next.nl) {
        this.advance();
        const param = this.isName("this") ? this.thisType() : this.ident();
        const type = this.eatName("is") ? this.type() : undefined;
        return this.node<A.TypePredicate>(start, { kind: "TypePredicate", param, type, asserts: true });
      }
    }
    if (this.tok.type === "name") {
      const next = this.peek();
      if (next.type === "name" && next.value === "is" && !next.nl) {
        const param = this.isName("this") ? this.thisType() : this.ident();
        this.advance();
        const type = this.type();
        return this.node<A.TypePredicate>(start, { kind: "TypePredicate", param, type, asserts: false });
      }
    }
    return this.type();
  }

  private thisType(): A.KeywordType {
    const t = this.advance();
    return { kind: "KeywordType", name: "this", start: t.start, end: t.end };
  }

  type(): A.TypeNode {
    const start = this.tok.start;
    const fn = this.functionTypeOpt();
    if (fn) return fn;
    const check = this.unionType();
    if (this.isName("extends") && !this.tok.nl) {
      this.advance();
      const extendsType = this.functionTypeOpt() ?? this.unionType();
      this.expect("?");
      const trueType = this.type();
      this.expect(":");
      const falseType = this.type();
      return this.node<A.ConditionalType>(start, { kind: "ConditionalType", check, extendsType, trueType, falseType });
    }
    return check;
  }

  private functionTypeOpt(): A.FunctionType | undefined {
    const start = this.tok.start;
    let ctor = false;
    if (this.isName("abstract") && this.peek().value === "new") this.advance();
    if (this.isName("new")) {
      this.advance();
      ctor = true;
    }
    if (!ctor && !this.is("(") && !this.is("<")) return undefined;
    const parse = () => {
      const typeParams = this.typeParamsOpt();
      const params = this.params();
      if (!this.is("=>")) return undefined;
      this.advance();
      const returnType = this.returnType();
      return this.node<A.FunctionType>(start, { kind: ctor ? "ConstructorType" : "FunctionType", typeParams, params, returnType });
    };
    if (ctor) {
      const r = parse();
      if (!r) this.fail("'=>' expected.");
      return r;
    }
    return this.tryParse(parse);
  }

  private unionType(): A.TypeNode {
    const start = this.tok.start;
    const leading = this.eat("|");
    const types = [this.intersectionType()];
    while (this.eat("|")) types.push(this.intersectionType());
    if (types.length === 1 && !leading) return types[0];
    if (types.length === 1) return types[0];
    return this.node<A.UnionType>(start, { kind: "UnionType", types });
  }

  private intersectionType(): A.TypeNode {
    const start = this.tok.start;
    this.eat("&");
    const types = [this.typeOperator()];
    while (this.eat("&")) types.push(this.typeOperator());
    if (types.length === 1) return types[0];
    return this.node<A.UnionType>(start, { kind: "IntersectionType", types });
  }

  private typeOperator(): A.TypeNode {
    const start = this.tok.start;
    if (this.tok.type === "name" && (this.tok.value === "keyof" || this.tok.value === "readonly" || this.tok.value === "unique")) {
      const next = this.peek();
      if (!(next.type === "punct" && [")", ",", "]", ">", "=", ";", "|", "&", "}", "?", ":"].includes(next.value)) && next.type !== "eof") {
        const op = this.advance().value as A.TypeOperator["op"];
        const type = this.typeOperator();
        return this.node<A.TypeOperator>(start, { kind: "TypeOperator", op, type });
      }
    }
    if (this.isName("infer")) {
      this.advance();
      const name = this.ident();
      if (this.isName("extends")) {
        const c = this.tryParse(() => {
          this.advance();
          const t = this.type();
          if (this.is("?")) return undefined;
          return t;
        });
        void c;
      }
      return this.node<A.InferType>(start, { kind: "InferType", name });
    }
    let t = this.primaryType();
    while (!this.tok.nl && this.is("[")) {
      this.advance();
      if (this.eat("]")) {
        t = this.node<A.ArrayType>(start, { kind: "ArrayType", elem: t });
        continue;
      }
      const index = this.type();
      this.expect("]");
      t = this.node<A.IndexedAccessType>(start, { kind: "IndexedAccessType", object: t, index });
    }
    return t;
  }

  private typeRef(): A.TypeRef {
    const start = this.tok.start;
    let name: A.Ident | A.QualifiedName = this.ident(true);
    while (this.is(".")) {
      this.advance();
      const right = this.ident(true);
      name = this.node<A.QualifiedName>(start, { kind: "QualifiedName", left: name, right });
    }
    const args = this.is("<") && !this.tok.nl ? this.typeArgs() : undefined;
    return this.node<A.TypeRef>(start, { kind: "TypeRef", name, args });
  }

  private primaryType(): A.TypeNode {
    const t = this.tok;
    const start = t.start;
    if (t.type === "name" && !t.escaped) {
      if (TYPE_KEYWORDS.has(t.value)) {
        const next = this.peek();
        if (!(next.type === "punct" && next.value === ".")) {
          this.advance();
          return { kind: "KeywordType", name: t.value as A.KeywordType["name"], start, end: t.end };
        }
      }
      if (t.value === "this") return this.thisType();
      if (t.value === "true" || t.value === "false") {
        this.advance();
        return { kind: "LiteralType", value: t.value === "true", start, end: t.end };
      }
      if (t.value === "typeof") {
        this.advance();
        if (this.isName("import")) this.fail("`typeof import(...)` is not supported.");
        let name: A.Ident | A.QualifiedName = this.ident(true);
        while (this.is(".")) {
          this.advance();
          const right = this.ident(true);
          name = this.node<A.QualifiedName>(start, { kind: "QualifiedName", left: name, right });
        }
        if (this.is("<") && !this.tok.nl) this.typeArgs();
        return this.node<A.TypeQuery>(start, { kind: "TypeQuery", name });
      }
      if (t.value === "import") {
        this.advance();
        this.expect("(");
        this.stringLit();
        this.expect(")");
        while (this.eat(".")) this.ident(true);
        if (this.is("<")) this.typeArgs();
        return this.node<A.ImportType>(start, { kind: "ImportType" });
      }
      return this.typeRef();
    }
    if (t.type === "string") {
      this.advance();
      return { kind: "LiteralType", value: t.value, start, end: t.end };
    }
    if (t.type === "num") {
      this.advance();
      return { kind: "LiteralType", value: t.num!, start, end: t.end };
    }
    if (t.type === "template") return this.templateType();
    if (t.type === "punct") {
      switch (t.value) {
        case "-": {
          this.advance();
          if (this.tok.type !== "num") this.fail("Type expected.");
          const n = this.advance();
          return this.node<A.LiteralType>(start, { kind: "LiteralType", value: -n.num! });
        }
        case "(": {
          this.advance();
          const type = this.type();
          this.expect(")");
          return this.node<A.ParenType>(start, { kind: "ParenType", type });
        }
        case "[":
          return this.tupleType();
        case "{": {
          const mapped = this.tryParse(() => this.mappedType());
          if (mapped) return mapped;
          const members = this.typeMembers();
          return this.node<A.TypeLiteral>(start, { kind: "TypeLiteral", members });
        }
      }
    }
    this.fail("Type expected.");
  }

  private templateType(): A.TemplateType {
    const start = this.tok.start;
    const quasis: string[] = [];
    const types: A.TypeNode[] = [];
    let piece = this.tok;
    this.advance();
    quasis.push(piece.value);
    while (!piece.tail) {
      types.push(this.type());
      if (!this.is("}")) this.fail("'}' expected.");
      this.s.pos = this.tok.end;
      piece = this.s.templatePiece(this.tok.start, this.tok.nl);
      this.prevEnd = piece.end;
      this.tok = this.s.next();
      quasis.push(piece.value);
    }
    return this.node<A.TemplateType>(start, { kind: "TemplateType", quasis, types });
  }

  private tupleType(): A.TupleType {
    const start = this.tok.start;
    this.advance();
    const elements: A.TupleElement[] = [];
    while (!this.eat("]")) {
      const es = this.tok.start;
      const rest = this.eat("...");
      let name: A.Ident | undefined;
      if (this.tok.type === "name") {
        const next = this.peek();
        if (next.type === "punct" && (next.value === ":" || (next.value === "?" && this.peekIsColonAfterQuestion()))) name = this.ident(true);
      }
      let optional = false;
      if (name) {
        optional = this.eat("?");
        this.expect(":");
      }
      let type = this.type();
      if (!name && this.is("?")) {
        this.advance();
        optional = true;
      }
      if (type.kind === "ParenType") type = type;
      elements.push(this.node<A.TupleElement>(es, { kind: "TupleElement", name, type, optional, rest }));
      if (!this.is("]")) this.expect(",");
    }
    return this.node<A.TupleType>(start, { kind: "TupleType", elements });
  }

  private peekIsColonAfterQuestion(): boolean {
    const st = this.save();
    this.advance();
    this.advance();
    const r = this.is(":");
    this.restore(st);
    return r;
  }

  private mappedType(): A.MappedType | undefined {
    const start = this.tok.start;
    this.expect("{");
    if (this.is("+") || this.is("-")) this.advance();
    this.eatName("readonly");
    if (!this.is("[")) return undefined;
    this.advance();
    const param = this.ident();
    if (!this.isName("in")) return undefined;
    this.advance();
    const constraint = this.type();
    if (this.eatName("as")) this.type();
    this.expect("]");
    if (this.is("+") || this.is("-")) this.advance();
    this.eat("?");
    const type = this.eat(":") ? this.type() : undefined;
    this.eat(";") || this.eat(",");
    this.expect("}");
    return this.node<A.MappedType>(start, { kind: "MappedType", param, constraint, type });
  }

  private typeMembers(): A.TypeMember[] {
    this.expect("{");
    const out: A.TypeMember[] = [];
    while (!this.eat("}")) {
      if (this.tok.type === "eof") this.fail("'}' expected.");
      out.push(this.typeMember());
      if (!this.eat(";") && !this.eat(",") && !this.is("}") && !this.tok.nl) this.fail("';' expected.");
    }
    return out;
  }

  private typeMember(): A.TypeMember {
    const start = this.tok.start;
    if (this.is("(") || this.is("<")) {
      const typeParams = this.typeParamsOpt();
      const params = this.params();
      const returnType = this.eat(":") ? this.returnType() : undefined;
      return this.node<A.CallSig>(start, { kind: "CallSig", typeParams, params, returnType });
    }
    if (this.isName("new")) {
      const next = this.peek();
      if (next.type === "punct" && (next.value === "(" || next.value === "<")) {
        this.advance();
        const typeParams = this.typeParamsOpt();
        const params = this.params();
        const returnType = this.eat(":") ? this.returnType() : undefined;
        return this.node<A.CallSig>(start, { kind: "ConstructSig", typeParams, params, returnType });
      }
    }
    let readonly = false;
    if (this.isName("readonly")) {
      const next = this.peek();
      if (next.type === "name" || next.type === "string" || next.type === "num" || (next.type === "punct" && next.value === "[")) {
        this.advance();
        readonly = true;
      }
    }
    if ((this.isName("get") || this.isName("set")) && this.peek().type === "name") {
      const next = this.peek();
      if (!next.nl) this.fail("Getters and setters are not supported in types.");
    }
    if (this.is("[")) {
      const sig = this.tryParse(() => {
        this.advance();
        if (this.tok.type !== "name") return undefined;
        const param = this.ident(true);
        if (!this.is(":")) return undefined;
        this.advance();
        const keyType = this.type();
        this.expect("]");
        this.expect(":");
        const type = this.type();
        return this.node<A.IndexSig>(start, { kind: "IndexSig", param, keyType, type, readonly });
      });
      if (sig) return sig;
    }
    const key = this.propertyKey();
    const optional = this.eat("?");
    if (this.is("(") || this.is("<")) {
      const typeParams = this.typeParamsOpt();
      const params = this.params();
      const returnType = this.eat(":") ? this.returnType() : undefined;
      return this.node<A.MethodSig>(start, { kind: "MethodSig", key, optional, typeParams, params, returnType });
    }
    const type = this.eat(":") ? this.type() : undefined;
    return this.node<A.PropSig>(start, { kind: "PropSig", key, optional, readonly, type });
  }

  /** Parses a type on its own, for the checker's built-in types. */
  typeOnly(): A.TypeNode {
    const t = this.type();
    if (this.tok.type !== "eof") this.fail("Unexpected token.");
    return t;
  }
}

function jsxNameText(n: A.JsxTagName): string {
  if (n.kind === "Ident") return n.name;
  if (n.kind === "JsxNamespacedName") return `${n.namespace.name}:${n.name.name}`;
  return `${jsxNameText(n.object)}.${n.prop.name}`;
}

export function parse(text: string, path: string, mode: ParseMode): ParseResult {
  try {
    const p = new Parser(text, mode);
    const file = p.file(path);
    setParents(file);
    return { file };
  } catch (e) {
    if (!(e instanceof SyntaxError_)) throw e;
    const file: A.SourceFile = { kind: "SourceFile", path, text, statements: [], lineStarts: lineStartsOf(text), start: 0, end: text.length };
    return { file, error: { message: e.message, pos: e.pos } };
  }
}

/** Parses the text of one type, such as `"Url | \`https://${string}\`"`. Throws on a syntax error. */
export function parseType(text: string): A.TypeNode {
  const p = new Parser(text, "dts");
  const t = p.typeOnly();
  const root: A.SourceFile = { kind: "SourceFile", path: "(type)", text, statements: [], lineStarts: lineStartsOf(text), start: 0, end: text.length };
  setParents(t);
  t.parent = root;
  return t;
}
