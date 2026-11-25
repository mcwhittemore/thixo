// The syntax pass and the code generator, as one walk. Every node kind the walk knows is handled by a case that
// checks it and writes its JavaScript; every other kind is an error. Nothing reaches the output that this file did
// not write.

import type { CompileEnv, ThixoError } from "../contract.js";
import { attrKind, isElementAllowed, type AttrKind } from "../runtime/allowlist.js";
import type { BoundFile, Sym } from "./bind.js";
import { BUILTIN_GLOBALS, CONSTRUCTIBLE } from "./lib-dts.js";
import type { ProgramFiles } from "./program.js";
import { resolveRelative } from "./program.js";
import type * as A from "./syntax/ast.js";
import { forEachChild, isFunctionLike, lineCol, sourceFileOf } from "./syntax/ast.js";

/** Field names that read through to what is behind a value in JavaScript. Never fields in the language. */
export const FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "caller",
  "callee",
  "arguments",
  "__thxUrl",
]);

const RESERVED_NAMES = new Set(["arguments", "eval", "undefined", "NaN", "Infinity"]);

const BINARY_OPS = new Set(["+", "-", "*", "/", "%", "**", "<", ">", "<=", ">=", "===", "!==", "&&", "||", "??", "&", "|", "^", "<<", ">>", ">>>"]);

/** What the walk learns about the program while it writes the code. */
export interface Facts {
  imports: { file: string; spec: string; name: string; node: A.Node }[];
  /** Outside addresses written out as links (`<a href>`). */
  links: Set<string>;
  /** True once the entry file's default export was written. */
  entry: boolean;
}

interface FnCtx {
  /** Temp holding the async function's budget context, for awaits. */
  asyncCtx?: string;
}

/** Node kinds, and a few operators, that are not in the language, by how an error names them. */
const KIND_NAMES: Record<string, string> = {
  Class: "Classes",
  ClassExpr: "Classes",
  This: "`this`",
  Super: "`super`",
  With: "`with`",
  Labeled: "Labels",
  delete: "`delete`",
  void: "`void`",
  TaggedTemplate: "Tagged templates",
  Regex: "Regular expressions",
  Getter: "Getters",
  Setter: "Setters",
  Yield: "Generators",
  ForIn: "`for ... in`",
  Debugger: "`debugger`",
  Enum: "Enums",
  Namespace: "Namespaces",
  ImportMeta: "`new.target` and `import.meta`",
  NewTarget: "`new.target` and `import.meta`",
  BigInt: "BigInt literals",
  Decorator: "Decorators",
  ImportEquals: "`import x = require(...)`",
  ExportEquals: "`export =`",
  PrivateName: "Private names",
};

const KIND_HINTS: Record<string, string> = {
  Class: "Write a function instead. Components are functions.",
  This: "Pass the value as a parameter.",
  Regex: "Use string methods: includes, startsWith, endsWith, indexOf, split, replaceAll.",
  ForIn: "Use `for (const key of Object.keys(record))`.",
  delete: "Build a new record without the field: `const { field, ...rest } = record`.",
  Getter: "Use a plain field or a function.",
  Setter: "Use a plain field or a function.",
  Yield: "Build a list and return it.",
  Enum: 'Use a union of string literals: `type Tone = "info" | "warning"`.',
  Labeled: "Move the inner loop into a function and return from it.",
};

type Where = A.Node | { start: number };

export class Emitter {
  readonly errors: ThixoError[] = [];
  readonly facts: Facts = { imports: [], links: new Set(), entry: false };
  private temp = 0;
  private fnStack: FnCtx[] = [];
  private sf!: A.SourceFile;
  private path = "";
  private fileIndex = 0;

  constructor(
    private readonly p: ProgramFiles,
    private readonly entry: string,
    private readonly env: CompileEnv,
    private readonly order: string[],
  ) {}

  // ---- errors ----

  error(node: Where, code: string, message: string, hint?: string): string {
    const sf = "kind" in node ? sourceFileOf(node) : this.sf;
    const pos = lineCol(sf, node.start);
    this.errors.push({ file: sf.path, line: pos.line, column: pos.column, code, message, ...(hint ? { hint } : {}) });
    return "(void 0)";
  }

  private notInLanguage(node: A.Node, key: string = node.kind): string {
    const what = KIND_NAMES[key] ?? `\`${key}\``;
    const verb = what.endsWith("s") && !what.startsWith("`") ? "are" : "is";
    return this.error(node, "thixo/not-in-language", `${what} ${verb} not in the language.`, KIND_HINTS[key]);
  }

  private t(): string {
    return `t${++this.temp}`;
  }

  private boundOf(node: A.Node): BoundFile {
    return this.p.bound.get(sourceFileOf(node).path)!;
  }

  // ---- files ----

  emitFile(path: string): string {
    this.path = path;
    this.fileIndex = this.order.indexOf(path);
    this.sf = this.p.files.get(path)!;
    this.scanTypesAndComments(this.sf);
    const out: string[] = [];
    for (const stmt of this.sf.statements) out.push(this.topLevel(stmt));
    return out.filter(Boolean).join("\n");
  }

  /** Function declarations at the top of every file, so each can be registered before any code runs. */
  topLevelFunctionNames(path: string): string[] {
    const sf = this.p.files.get(path)!;
    const names: string[] = [];
    for (const stmt of sf.statements) if (stmt.kind === "FunctionDecl" && stmt.name && stmt.body) names.push(this.declName(stmt.name));
    return names;
  }

  private scanTypesAndComments(sf: A.SourceFile): void {
    const directive = /@ts-(ignore|expect-error|nocheck)\b/g;
    for (let m = directive.exec(sf.text); m; m = directive.exec(sf.text)) {
      const pos = lineCol(sf, m.index);
      this.errors.push({
        file: this.path,
        line: pos.line,
        column: pos.column,
        code: "thixo/ts-directive",
        message: `\`@ts-${m[1]}\` is not allowed: the type check is part of the wall and can't be switched off.`,
        hint: "Fix the type error it was hiding.",
      });
    }
    const visit = (node: A.Node): void => {
      if (node.kind === "KeywordType" && node.name === "any")
        this.error(node, "thixo/no-any", "`any` is not in the language: it switches the type check off.", "Write the real type, or `unknown` and narrow it.");
      else if (node.kind === "ImportType") this.error(node, "thixo/not-in-language", "`import(...)` types are not in the language.", "Import the type at the top of the file.");
      else if (node.kind === "ConditionalType")
        this.error(node, "thixo/not-in-language", "Conditional types are not in the language.", "Write the type out, or use a union.");
      else if (node.kind === "MappedType")
        this.error(node, "thixo/not-in-language", "Mapped types are not in the language.", "Write the fields out, or use `Record<string, T>`, `Partial<T>`, `Pick<T, K>` or `Omit<T, K>`.");
      else if (node.kind === "InferType") this.error(node, "thixo/not-in-language", "`infer` is not in the language.", "Write the type out.");
      forEachChild(node, visit);
    };
    visit(sf);
  }

  // ---- names ----

  private checkIdentifierText(id: A.Ident): void {
    const raw = sourceFileOf(id).text.slice(id.start, id.end);
    if (id.escaped)
      this.error(id, "thixo/identifier", `The name \`${raw}\` uses an escape. Names are written out in plain letters.`, `Write \`${id.name}\`.`);
    else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id.name))
      this.error(id, "thixo/identifier", `The name \`${id.name}\` has characters outside A-Z, a-z, 0-9, _ and $.`);
  }

  private nameForSym(sym: Sym): string {
    if (sym.file.home !== "program") throw new Error("declaration outside the program");
    const path = sym.file.file.path;
    if (sym.decls[0].kind !== "Function" && sym.topLevel) return `u${this.order.indexOf(path)}_${sym.name}`;
    return `l_${sym.name}`;
  }

  /** The emitted name of a declaration's name identifier. */
  private declName(id: A.Ident): string {
    this.checkIdentifierText(id);
    if (RESERVED_NAMES.has(id.name))
      return this.error(id, "thixo/identifier", `\`${id.name}\` can't be used as a name in the language.`, "Choose another name.");
    const sym = this.boundOf(id).decls.get(id);
    if (!sym) throw new Error(`no symbol for the declaration of ${id.name}`);
    return this.nameForSym(sym);
  }

  /** The emitted form of an identifier that reads a value. */
  private ref(id: A.Ident): string {
    this.checkIdentifierText(id);
    const bound = this.boundOf(id);
    const sym = bound.values.get(id);
    if (id.name === "undefined" && !sym) return "(void 0)";
    if (!sym) {
      // A program's own type used as a value: the type check names the mistake. A lib type is a global that does
      // not exist as a value, such as `Function`.
      if (bound.typeOnlyValues.get(id)?.file.home === "program") return "(void 0)";
      return this.noGlobal(id);
    }
    if (sym.file.home === "lib") {
      if (!BUILTIN_GLOBALS.has(id.name)) return this.noGlobal(id);
      if (id.name === "NaN") return "(0 / 0)";
      if (id.name === "Infinity") return "(1 / 0)";
      return `rt.${id.name}`;
    }
    if (sym.file.home !== "program") return this.noGlobal(id);
    const path = sym.file.file.path;
    if (sym.kind === "import") {
      if (sym.importStyle !== "named") return this.error(id, "thixo/import", "Only named imports are in the language.");
      const spec = sym.importFrom!;
      const rel = resolveRelative(path, spec, this.p.files);
      if (rel !== undefined) {
        const target = this.p.resolveAlias(sym);
        if (!target || target.file.home !== "program") return this.error(id, "thixo/import", `\`${id.name}\` is not exported by \`${spec}\`.`);
        return this.nameForSym(target);
      }
      return `u${this.order.indexOf(path)}_${sym.name}`;
    }
    return this.nameForSym(sym);
  }

  private noGlobal(id: A.Ident): string {
    const name = id.name;
    const hints: Record<string, string> = {
      window: "A program reaches the page only through what it imports.",
      document: "Render elements with JSX instead.",
      fetch: "There is no network in the language. Use what the host's modules give you.",
      XMLHttpRequest: "There is no network in the language. Use what the host's modules give you.",
      WebSocket: "There is no network in the language. Use what the host's modules give you.",
      setTimeout: 'Timers are not in the language. Use `useFrame` from "thixo" to run on every frame.',
      setInterval: 'Timers are not in the language. Use `useFrame` from "thixo" to run on every frame.',
      requestAnimationFrame: 'Use `useFrame` from "thixo": `useFrame((t) => setTime(t))`.',
      localStorage: "Keep state with `useState`.",
      sessionStorage: "Keep state with `useState`.",
      console: "There is no console. Show the value in the component while you work on it.",
      require: "Import with `import { name } from \"module\"`.",
      Symbol: "Symbols are not in the language.",
      Reflect: "Reflect is not in the language.",
      Proxy: "Proxy is not in the language.",
      RegExp: "Regular expressions are not in the language. Use string methods.",
      Function: "Code from a string is not in the language.",
      eval: "Code from a string is not in the language.",
      globalThis: "There are no globals in the language.",
      self: "There are no globals in the language.",
    };
    return this.error(
      id,
      "thixo/no-global",
      `\`${name}\` does not exist in the language. A program can name only what it imports, what it declares and the language's built-ins.`,
      hints[name] ?? `Import it from a module the host provides, or declare it. The built-ins are ${[...BUILTIN_GLOBALS].join(", ")}.`,
    );
  }

  // ---- top level ----

  private topLevel(stmt: A.Statement): string {
    const isEntry = this.path === this.entry;
    switch (stmt.kind) {
      case "Import":
        return this.importDecl(stmt);
      case "Interface":
      case "TypeAlias":
        return this.typeDecl(stmt);
      case "FunctionDecl": {
        const isDefault = stmt.modifiers.some((m) => m.name === "default");
        if (!isDefault) {
          this.checkModifiers(stmt.modifiers, ["export", "async"]);
          return this.functionDecl(stmt);
        }
        this.checkModifiers(stmt.modifiers, ["export", "default"]);
        if (!isEntry) return this.error(stmt, "thixo/entry", `Only \`${this.entry}\` has a default export.`, "Export named values from other files.");
        if (!stmt.name) return this.error(stmt, "thixo/entry", "The default export is a named function: `export default function App() { ... }`.");
        this.facts.entry = true;
        return `${this.functionDecl(stmt)}\nconst t0 = rt.app(${this.declName(stmt.name)});`;
      }
      case "VarDecl": {
        this.checkModifiers(stmt.modifiers, ["export"]);
        if (stmt.declKind !== "const")
          return this.error(stmt, "thixo/top-level", "Only `const` may be declared at the top of a file.", "Keep changing values inside a component with `useState`.");
        return stmt.decls.map((d) => this.topConst(d)).join("\n");
      }
      case "ExportEquals":
        return this.notInLanguage(stmt);
      case "ExportDefault":
        if (!isEntry) return this.error(stmt, "thixo/entry", `Only \`${this.entry}\` has a default export.`, "Export named values from other files.");
        return this.defaultExport(stmt);
      case "ExportAll":
        return this.error(stmt, "thixo/import", "`export ... from` is not in the language.", "Import the value, then export it.");
      case "ExportNamed": {
        if (stmt.source) return this.error(stmt, "thixo/import", "`export ... from` is not in the language.", "Import the value, then export it.");
        for (const el of stmt.specs) {
          if (el.exported.kind !== "Ident" || el.local.kind !== "Ident") this.error(el, "thixo/import", "Export names are written as plain names.");
          else this.checkIdentifierText(el.exported);
        }
        return "";
      }
      case "Empty":
        return "";
      case "ExprStmt":
      case "If":
      case "ForOf":
      case "While":
      case "For":
        return this.error(
          stmt,
          "thixo/top-level",
          "Code at the top of a file is not in the language: the build reads a file without running it.",
          "Move it into a function, or into the component.",
        );
    }
    return this.notInLanguage(stmt);
  }

  private checkModifiers(mods: readonly A.Modifier[], allowed: string[]): void {
    for (const m of mods) if (!allowed.includes(m.name)) this.error(m, "thixo/not-in-language", `\`${m.name}\` is not allowed here.`);
  }

  private typeDecl(stmt: A.Interface | A.TypeAlias): string {
    this.checkModifiers(stmt.modifiers, ["export"]);
    return "";
  }

  private importDecl(stmt: A.Import): string {
    const spec = stmt.source.value;
    if (stmt.attributes) this.error(stmt.attributes, "thixo/import", "Import attributes are not in the language.");
    if (!stmt.defaultName && !stmt.namespace && !stmt.named) return this.error(stmt, "thixo/import", "An import must name what it imports: `import { name } from \"module\"`.");
    if (stmt.defaultName) this.error(stmt.defaultName, "thixo/import", "Default imports are not in the language.", `Write \`import { name } from "${spec}"\`.`);
    if (stmt.namespace) this.error(stmt.namespace, "thixo/import", "`import * as` is not in the language.", `Write \`import { name } from "${spec}"\`.`);
    const relative = spec.startsWith("./") || spec.startsWith("../");
    if (relative) {
      if (resolveRelative(this.path, spec, this.p.files) === undefined) {
        const names = [...this.p.files.keys()];
        return this.error(stmt.source, "thixo/missing-file", `\`${spec}\` is not one of this program's files.`, `The program has: ${names.join(", ")}. Every file of a program ends in .thx, so \`${spec}\` is read from ${spec.replace(/^\.\//, "").replace(/\.thx$/, "")}.thx; a .ts or .tsx file is not part of it.`);
      }
    } else if (!Object.prototype.hasOwnProperty.call(this.env.modules, spec)) {
      const known = Object.keys(this.env.modules).join(", ");
      const hint = spec === "react" ? 'Hooks come from "thixo": `import { useState } from "thixo"`.' : `A program can import: ${known}.`;
      return this.error(stmt.source, "thixo/unknown-import", `\`${spec}\` can't be imported. A program imports only "thixo", the modules its host provides, and its own files.`, hint);
    }
    if (!stmt.named) return "";
    const out: string[] = [];
    const bound = this.boundOf(stmt);
    for (const el of stmt.named) {
      this.checkIdentifierText(el.local);
      if (el.renamed && el.imported.kind !== "Ident") {
        this.error(el.imported, "thixo/import", "Import names are written as plain names.");
        continue;
      }
      if (RESERVED_NAMES.has(el.local.name)) {
        this.error(el.local, "thixo/identifier", `\`${el.local.name}\` can't be used as a name in the language.`);
        continue;
      }
      const imported = el.imported.kind === "Ident" ? el.imported.name : el.imported.value;
      const typeOnly = stmt.typeOnly || el.typeOnly;
      if (!typeOnly) this.facts.imports.push({ file: this.path, spec, name: imported, node: el });
      if (relative || typeOnly) continue;
      const sym = bound.decls.get(el.local);
      const target = sym ? this.p.resolveAlias(sym) : undefined;
      if (!target || !target.value) continue;
      out.push(`const u${this.fileIndex}_${el.local.name} = rt.imp(${JSON.stringify(spec)}, ${JSON.stringify(imported)});`);
    }
    return out.join("\n");
  }

  private topConst(d: A.VarDeclarator): string {
    if (d.definite) this.error(d, "thixo/not-in-language", "`!` on a declaration is not in the language.");
    if (!d.init) return this.error(d, "thixo/top-level", "A `const` needs a value.");
    return this.varDecl(d, "const");
  }

  // ---- the entry ----

  private defaultExport(stmt: A.ExportDefault): string {
    const e = stmt.expr;
    if (e.kind !== "Ident" && e.kind !== "Function" && e.kind !== "Arrow")
      return this.error(stmt, "thixo/entry", "The default export is the program's component.", "export default function App() { return <div />; }");
    this.facts.entry = true;
    return `const t0 = rt.app(${this.expr(e)});`;
  }

  // ---- statements ----

  private statements(stmts: readonly A.Statement[]): string {
    const regs: string[] = [];
    for (const s of stmts) if (s.kind === "FunctionDecl" && s.name && s.body) regs.push(`rt.fn(${this.declName(s.name)});`);
    return [...regs, ...stmts.map((s) => this.stmt(s))].join("\n");
  }

  private body(stmt: A.Statement, prefix = ""): string {
    if (stmt.kind === "Block") return `{\n${prefix}${this.statements(stmt.body)}\n}`;
    return `{\n${prefix}${this.stmt(stmt)}\n}`;
  }

  private stmt(node: A.Statement): string {
    switch (node.kind) {
      case "Block":
        return `{\n${this.statements(node.body)}\n}`;
      case "Empty":
        return ";";
      case "ExprStmt":
        return `${this.expr(node.expr)};`;
      case "VarDecl": {
        this.checkModifiers(node.modifiers, []);
        const kind = this.declKind(node);
        return node.decls.map((d) => this.varDecl(d, kind)).join("\n");
      }
      case "FunctionDecl": {
        this.checkModifiers(node.modifiers, ["async"]);
        const parent = node.parent;
        if (!parent || (parent.kind !== "Block" && parent.kind !== "SourceFile"))
          return this.error(node, "thixo/not-in-language", "A function declared here is not in the language.", "Declare it inside a block or use `const f = () => ...`.");
        return this.functionDecl(node);
      }
      case "If": {
        const els = node.else ? ` else ${this.body(node.else)}` : "";
        return `if (${this.expr(node.test)}) ${this.body(node.then)}${els}`;
      }
      case "While":
        return `while (${this.expr(node.test)}) ${this.body(node.body, "rt.tick();\n")}`;
      case "DoWhile":
        return `do ${this.body(node.body, "rt.tick();\n")} while (${this.expr(node.test)});`;
      case "For":
        return this.forStmt(node);
      case "ForOf":
        return this.forOf(node);
      case "Return":
        if (this.fnStack.length === 0) return this.error(node, "thixo/not-in-language", "`return` outside a function.");
        return node.arg ? `return ${this.expr(node.arg)};` : "return;";
      case "Break":
      case "Continue":
        if (node.label) return this.error(node, "thixo/not-in-language", "Labels are not in the language.", KIND_HINTS.Labeled);
        return node.kind === "Break" ? "break;" : "continue;";
      case "Throw":
        return `throw ${this.expr(node.arg)};`;
      case "Try":
        return this.tryStmt(node);
      case "Switch":
        return this.switchStmt(node);
      case "Interface":
      case "TypeAlias":
        return this.typeDecl(node);
      default:
        return this.notInLanguage(node);
    }
  }

  private declKind(list: A.VarDecl): "const" | "let" {
    if (list.declKind === "const") return "const";
    if (list.declKind === "let") return "let";
    this.error(list, "thixo/not-in-language", "`var` and `using` are not in the language.", "Use `const`, or `let` for a value that changes.");
    return "let";
  }

  private varDecl(d: A.VarDeclarator, kind: "const" | "let"): string {
    if (d.definite) this.error(d, "thixo/not-in-language", "`!` on a declaration is not in the language.");
    if (d.target.kind === "Ident") {
      const name = this.declName(d.target);
      if (!d.init) {
        if (kind === "const") return this.error(d, "thixo/not-in-language", "A `const` needs a value.");
        return `let ${name};`;
      }
      return `${kind} ${name} = ${this.expr(d.init)};`;
    }
    if (!d.init) return this.error(d, "thixo/not-in-language", "A destructuring declaration needs a value.");
    const t = this.t();
    return [`const ${t} = ${this.expr(d.init)};`, ...this.pattern(d.target, t, kind)].join("\n");
  }

  /** Statements that bind every name in a destructuring pattern from the value in `src`. */
  private pattern(pat: A.Pattern, src: string, kind: "const" | "let"): string[] {
    if (pat.kind === "Ident") return [`${kind} ${this.declName(pat)} = ${src};`];
    const out: string[] = [];
    const bind = (el: A.BindingElement, value: string) => {
      if (el.init) {
        const t = this.t();
        out.push(`const ${t} = ${value};`);
        value = `(${t} === void 0 ? ${this.expr(el.init)} : ${t})`;
      }
      if (el.target.kind === "Ident") out.push(`${kind} ${this.declName(el.target)} = ${value};`);
      else {
        const t = this.t();
        out.push(`const ${t} = ${value};`);
        out.push(...this.pattern(el.target, t, kind));
      }
    };
    if (pat.kind === "ObjectPattern") {
      const keys: string[] = [];
      for (const el of pat.elements) {
        if (el.rest) {
          if (el.target.kind !== "Ident") {
            this.error(el, "thixo/not-in-language", "A rest element binds a plain name.");
            continue;
          }
          out.push(`${kind} ${this.declName(el.target)} = rt.rest(${src}, [${keys.join(", ")}]);`);
          continue;
        }
        let key: string;
        if (!el.key) {
          if (el.target.kind !== "Ident") {
            this.error(el, "thixo/not-in-language", "This pattern is not in the language.");
            continue;
          }
          key = this.keyLiteral(el.target, el.target.name);
        } else if (el.key.kind === "Computed") {
          const t = this.t();
          out.push(`const ${t} = ${this.expr(el.key.expr)};`);
          key = t;
        } else {
          const k = this.staticKey(el.key);
          if (k === undefined) {
            this.error(el.key, "thixo/not-in-language", "This key is not in the language.");
            continue;
          }
          key = this.keyLiteral(el.key, k);
        }
        keys.push(key);
        bind(el, `rt.g(${src}, ${key})`);
      }
      return out;
    }
    const list = this.t();
    out.push(`const ${list} = rt.list(${src});`);
    pat.elements.forEach((el, i) => {
      if (el.kind === "Hole") return;
      if (el.rest) {
        if (el.target.kind !== "Ident") {
          this.error(el, "thixo/not-in-language", "A rest element binds a plain name.");
          return;
        }
        out.push(`${kind} ${this.declName(el.target)} = rt.m(${list}, "slice", [${i}]);`);
        return;
      }
      bind(el, `rt.g(${list}, ${i})`);
    });
    return out;
  }

  private forStmt(s: A.For): string {
    let init = "";
    if (s.init) {
      if (s.init.kind === "VarDecl") {
        const kind = this.declKind(s.init);
        const parts = s.init.decls.map((d) => {
          if (d.target.kind !== "Ident") return this.error(d, "thixo/not-in-language", "Destructuring in a `for` header is not in the language.", "Destructure inside the loop body.");
          return d.init ? `${this.declName(d.target)} = ${this.expr(d.init)}` : this.declName(d.target);
        });
        init = `${kind} ${parts.join(", ")}`;
      } else init = this.expr(s.init);
    }
    const cond = s.test ? this.expr(s.test) : "";
    const inc = s.update ? this.expr(s.update) : "";
    return `for (${init}; ${cond}; ${inc}) ${this.body(s.body, "rt.tick();\n")}`;
  }

  private forOf(s: A.ForOf): string {
    if (s.await) return this.error(s, "thixo/not-in-language", "`for await` is not in the language.", "Await each value inside the loop.");
    const iter = `rt.iter(${this.expr(s.right)})`;
    if (s.left.kind !== "VarDecl")
      return this.error(s.left, "thixo/not-in-language", "A `for ... of` loop declares its variable: `for (const item of list)`.");
    const kind = this.declKind(s.left);
    const d = s.left.decls[0];
    if (d.target.kind === "Ident") return `for (${kind} ${this.declName(d.target)} of ${iter}) ${this.body(s.body, "rt.tick();\n")}`;
    const t = this.t();
    const binds = this.pattern(d.target, t, kind).join("\n");
    return `for (const ${t} of ${iter}) ${this.body(s.body, `rt.tick();\n${binds}\n`)}`;
  }

  private tryStmt(s: A.Try): string {
    let out = `try {\n${this.statements(s.block.body)}\n}`;
    if (s.handler) {
      const t = this.t();
      let prefix = `rt.caught(${t});\n`;
      if (s.param) {
        if (s.paramType) this.error(s.paramType, "thixo/not-in-language", "A catch variable has no type annotation.");
        prefix = this.pattern(s.param, `rt.caught(${t})`, "const").join("\n") + "\n";
      }
      out += ` catch (${t}) {\n${prefix}${this.statements(s.handler.body)}\n}`;
    }
    if (s.finalizer) {
      this.checkFinally(s.finalizer);
      out += ` finally {\n${this.statements(s.finalizer.body)}\n}`;
    }
    return out;
  }

  /** A `finally` that returns, throws or jumps would swallow the error that stops a program. */
  private checkFinally(block: A.Block): void {
    const visit = (n: A.Node, inLoop: boolean): void => {
      if (isFunctionLike(n)) return;
      if (n.kind === "Return" || n.kind === "Throw" || ((n.kind === "Break" || n.kind === "Continue") && !inLoop)) {
        this.error(n, "thixo/not-in-language", "A `finally` block can't return, throw, break or continue.", "Move that code after the `try` statement.");
        return;
      }
      const loop = inLoop || n.kind === "For" || n.kind === "ForOf" || n.kind === "ForIn" || n.kind === "While" || n.kind === "DoWhile" || n.kind === "Switch";
      forEachChild(n, (c) => visit(c, loop));
    };
    visit(block, false);
  }

  private switchStmt(s: A.Switch): string {
    const clauses = s.cases.map((c) => {
      for (const st of c.body) if (st.kind === "FunctionDecl") this.error(st, "thixo/not-in-language", "Declare functions outside the `switch`.");
      const head = c.test ? `case ${this.expr(c.test)}:` : "default:";
      return `${head}\n${c.body.map((st) => this.stmt(st)).join("\n")}`;
    });
    return `switch (${this.expr(s.disc)}) {\n${clauses.join("\n")}\n}`;
  }

  // ---- functions ----

  private functionDecl(f: A.FunctionDecl): string {
    if (!f.name) return this.error(f, "thixo/not-in-language", "A function declaration needs a name.");
    if (!f.body) return this.error(f, "thixo/not-in-language", "Overload signatures are not in the language.");
    return this.fn(f, this.declName(f.name));
  }

  /** A program function. Every one counts against the budget when it is entered and tracks its call depth. */
  private fn(f: A.FunctionLike, name = ""): string {
    if (f.generator) return this.error(f, "thixo/not-in-language", "Generators are not in the language.", KIND_HINTS.Yield);
    const isAsync = f.async;
    for (const m of f.modifiers)
      // `default` is checked where the entry's default export is read, at the top of a file.
      if (m.name !== "async" && m.name !== "export" && !(m.name === "default" && f.kind === "FunctionDecl" && f.parent?.kind === "SourceFile"))
        this.error(m, "thixo/not-in-language", `\`${m.name}\` is not allowed on a function.`);
    if (!f.body) return this.error(f, "thixo/not-in-language", "A function needs a body.");
    const params: string[] = [];
    const prologue: { p: A.Param; t: string }[] = [];
    for (const p of f.params) {
      if (p.modifiers.length) this.error(p, "thixo/not-in-language", "Parameter modifiers are not in the language.");
      if (p.target.kind === "Ident" && p.target.name === "this") {
        this.error(p, "thixo/not-in-language", "A `this` parameter is not in the language.");
        continue;
      }
      if (p.rest) {
        if (p.target.kind !== "Ident") {
          this.error(p, "thixo/not-in-language", "A rest parameter binds a plain name.");
          continue;
        }
        params.push(`...${this.declName(p.target)}`);
        continue;
      }
      if (p.target.kind === "Ident" && !p.init) {
        params.push(this.declName(p.target));
        continue;
      }
      const t = this.t();
      params.push(t);
      prologue.push({ p, t });
    }
    const ctx: FnCtx = {};
    const depth = this.t();
    let inner: string;
    if (isAsync) ctx.asyncCtx = this.t();
    this.fnStack.push(ctx);
    try {
      const pro = prologue
        .map(({ p, t }) => {
          const value = p.init ? `(${t} === void 0 ? ${this.expr(p.init)} : ${t})` : t;
          if (p.target.kind === "Ident") return `let ${this.declName(p.target)} = ${value};`;
          const v = this.t();
          return [`const ${v} = ${value};`, ...this.pattern(p.target, v, "let")].join("\n");
        })
        .join("\n");
      const bodyCode = f.body.kind === "Block" ? this.statements(f.body.body) : `return ${this.expr(f.body)};`;
      inner = `${pro}\n${bodyCode}`;
    } finally {
      this.fnStack.pop();
    }
    const core = isAsync ? `return rt.done((async () => {\nconst ${ctx.asyncCtx} = rt.ctx();\n${inner}\n})());` : inner;
    return `function ${name}(${params.join(", ")}) {\nrt.tick();\nconst ${depth} = rt.push();\ntry {\n${core}\n} finally {\nrt.pop(${depth});\n}\n}`;
  }

  // ---- expressions ----

  private staticKey(name: A.PropKey): string | undefined {
    if (name.kind === "Ident") {
      this.checkIdentifierText(name);
      return name.name;
    }
    if (name.kind === "Str") return name.value;
    if (name.kind === "Num") return String(Number(name.raw.replace(/_/g, "")));
    return undefined;
  }

  /** A field name as a JavaScript string literal, refusing the names that reach behind a value. */
  private keyLiteral(node: Where, key: string): string {
    if (FORBIDDEN_FIELDS.has(key)) {
      this.error(node, "thixo/forbidden-field", `\`${key}\` is not a field in the language: a record has only the fields it was given.`, "Use another name.");
      return '""';
    }
    return JSON.stringify(key);
  }

  private optionalEnd(node: A.Member | A.Index | A.Call, code: string): string {
    if (!node.inChain) return code;
    const parent = node.parent;
    const continues =
      !!parent &&
      ((parent.kind === "Member" && parent.object === node) || (parent.kind === "Index" && parent.object === node) || (parent.kind === "Call" && parent.callee === node)) &&
      parent.inChain;
    return continues ? code : `rt.end(${code})`;
  }

  private args(list: readonly (A.Expr | A.Spread)[]): string {
    return `[${list.map((a) => (a.kind === "Spread" ? `rt.sp(${this.expr(a.arg)})` : this.expr(a))).join(", ")}]`;
  }

  expr(node: A.Expr): string {
    switch (node.kind) {
      case "Ident":
        return this.ref(node);
      case "Num":
        return String(Number(node.raw.replace(/_/g, "")));
      case "Str":
        return JSON.stringify(node.value);
      case "Bool":
        return node.value ? "true" : "false";
      case "Null":
        return "null";
      case "Template": {
        if (node.exprs.length === 0) return JSON.stringify(node.quasis[0].cooked);
        const parts = [JSON.stringify(node.quasis[0].cooked)];
        node.exprs.forEach((e, i) => parts.push(`rt.str(${this.expr(e)})`, JSON.stringify(node.quasis[i + 1].cooked)));
        return `(${parts.join(" + ")})`;
      }
      case "Paren":
        return `(${this.expr(node.expr)})`;
      case "Satisfies":
        return this.expr(node.expr);
      case "As":
        return this.error(node, "thixo/no-as", "Type assertions (`as`, `<T>value`) are not in the language: they switch the type check off.", "Give the value its real type, or narrow it with a check such as `typeof x === \"string\"`.");
      case "NonNull":
        return this.error(node, "thixo/no-non-null", "The non-null `!` is not in the language: it switches the type check off.", "Check the value first: `if (x !== undefined) { ... }`, or use `?.` and `??`.");
      case "Member": {
        if (node.prop.kind === "PrivateName") return this.notInLanguage(node.prop);
        if (node.object.kind === "Super") return this.notInLanguage(node.object);
        this.checkIdentifierText(node.prop);
        const key = this.keyLiteral(node.prop, node.prop.name);
        const code = `rt.g(${this.expr(node.object)}, ${key}${node.optional ? ", 1" : ""})`;
        return this.optionalEnd(node, code);
      }
      case "Index": {
        const key = this.computedKey(node.index);
        const code = `rt.g(${this.expr(node.object)}, ${key}${node.optional ? ", 1" : ""})`;
        return this.optionalEnd(node, code);
      }
      case "Call":
        return this.call(node);
      case "ImportCall":
        return this.error(node, "thixo/no-dynamic-import", "`import()` is not in the language: the build must see every import.", 'Import at the top of the file: `import { name } from "module"`.');
      case "New": {
        if (node.callee.kind !== "Ident" || !CONSTRUCTIBLE.has(node.callee.name))
          return this.error(node, "thixo/no-new", "`new` works only on `Date`, `Map`, `Set` and `Error`.", "Call a function that returns the value instead.");
        const ctor = this.ref(node.callee);
        return `rt.nw(${ctor}, ${this.args(node.args ?? [])})`;
      }
      case "Array": {
        const items = node.elements.map((el) => {
          if (el.kind === "Hole") return this.error(el, "thixo/not-in-language", "Holes in a list are not in the language.", "Write `undefined` in the gap.");
          if (el.kind === "Spread") return `rt.sp(${this.expr(el.arg)})`;
          return this.expr(el);
        });
        return `rt.a(${items.join(", ")})`;
      }
      case "Object":
        return this.objectLiteral(node);
      case "Arrow":
      case "Function": {
        const name = node.name ? this.declName(node.name) : "";
        return `rt.fn(${this.fn(node, name)})`;
      }
      case "Unary":
        return this.prefix(node);
      case "Update":
        return this.update(node.arg, node.op, node.prefix);
      case "Binary":
        return this.binary(node);
      case "Assign":
        return this.assign(node);
      case "Cond":
        return `(${this.expr(node.test)} ? ${this.expr(node.cons)} : ${this.expr(node.alt)})`;
      case "Await": {
        const ctx = this.fnStack[this.fnStack.length - 1];
        if (!ctx?.asyncCtx) return this.error(node, "thixo/not-in-language", "`await` works only inside an `async` function.");
        return `rt.back(${ctx.asyncCtx}, await rt.aw(${this.expr(node.arg)}))`;
      }
      case "JsxElement":
        return this.jsxElement(node);
      case "JsxFragment":
        return `rt.frag(${this.jsxChildren(node.children)})`;
      default:
        return this.notInLanguage(node);
    }
  }

  private computedKey(arg: A.Expr): string {
    if (arg.kind === "Str") return this.keyLiteral(arg, arg.value);
    if (arg.kind === "Template" && arg.exprs.length === 0) return this.keyLiteral(arg, arg.quasis[0].cooked);
    return this.expr(arg);
  }

  private call(c: A.Call): string {
    const callee = c.callee;
    if (callee.kind === "Super") return this.notInLanguage(callee);
    if (callee.kind === "Member" && callee.prop.kind !== "PrivateName") {
      this.checkIdentifierText(callee.prop);
      const flags = (callee.optional ? 1 : 0) | (c.optional ? 2 : 0);
      const code = `rt.m(${this.expr(callee.object)}, ${this.keyLiteral(callee.prop, callee.prop.name)}, ${this.args(c.args)}${flags ? `, ${flags}` : ""})`;
      return this.optionalEnd(c, code);
    }
    if (callee.kind === "Index") {
      const flags = (callee.optional ? 1 : 0) | (c.optional ? 2 : 0);
      const code = `rt.m(${this.expr(callee.object)}, ${this.computedKey(callee.index)}, ${this.args(c.args)}${flags ? `, ${flags}` : ""})`;
      return this.optionalEnd(c, code);
    }
    const code = `rt.c(${this.expr(callee)}, ${this.args(c.args)}${c.optional ? ", 1" : ""})`;
    return this.optionalEnd(c, code);
  }

  private objectLiteral(o: A.ObjectLit): string {
    const parts: string[] = [];
    for (const prop of o.props) {
      if (prop.kind === "Spread") {
        parts.push(`rt.sp(${this.expr(prop.arg)})`);
        continue;
      }
      if (prop.kind === "Shorthand") {
        if (prop.init) {
          this.error(prop, "thixo/not-in-language", "`{ a = 1 }` is not in the language here.");
          continue;
        }
        parts.push(this.keyLiteral(prop.name, prop.name.name), this.ref(prop.name));
        continue;
      }
      if (prop.kind === "Prop" || prop.kind === "Method") {
        let key: string;
        if (prop.key.kind === "Computed") key = this.computedKey(prop.key.expr);
        else {
          const k = this.staticKey(prop.key);
          if (k === undefined) {
            this.error(prop.key, "thixo/not-in-language", "This key is not in the language.");
            continue;
          }
          key = this.keyLiteral(prop.key, k);
        }
        if (prop.kind === "Prop") parts.push(key, this.expr(prop.value));
        else {
          if (prop.optional) this.error(prop, "thixo/not-in-language", "Optional methods are not in the language.");
          parts.push(key, `rt.fn(${this.fn(prop)})`);
        }
        continue;
      }
      this.notInLanguage(prop);
    }
    return `rt.r(${parts.join(", ")})`;
  }

  private prefix(u: A.Unary): string {
    switch (u.op) {
      case "!":
        return `(!${this.expr(u.arg)})`;
      case "-":
        return `(-${this.expr(u.arg)})`;
      case "+":
        return `(+${this.expr(u.arg)})`;
      case "~":
        return `(~${this.expr(u.arg)})`;
      case "typeof":
        return `(typeof ${this.expr(u.arg)})`;
    }
    return this.notInLanguage(u, u.op);
  }

  private update(target: A.Expr, op: "++" | "--", prefix: boolean): string {
    if (target.kind === "Ident") {
      const name = this.ref(target);
      return prefix ? `(${op}${name})` : `(${name}${op})`;
    }
    const member = this.memberTarget(target);
    if (!member) return this.error(target, "thixo/not-in-language", `\`${op}\` works on a name or a field.`);
    return `rt.s(${member.obj}, ${member.key}, 1, ${JSON.stringify(prefix ? `${op}x` : `x${op}`)})`;
  }

  private memberTarget(target: A.Expr): { obj: string; key: string } | undefined {
    if (target.kind === "Paren") return this.memberTarget(target.expr);
    if (target.kind === "Member" && target.prop.kind !== "PrivateName") {
      if (target.optional || target.inChain) return undefined;
      this.checkIdentifierText(target.prop);
      return { obj: this.expr(target.object), key: this.keyLiteral(target.prop, target.prop.name) };
    }
    if (target.kind === "Index") {
      if (target.optional || target.inChain) return undefined;
      return { obj: this.expr(target.object), key: this.computedKey(target.index) };
    }
    return undefined;
  }

  private assign(b: A.Assign): string {
    const assign = b.op;
    if (b.left.kind === "Ident") return `(${this.ref(b.left)} ${assign} ${this.expr(b.right)})`;
    if (b.left.kind === "Object" || b.left.kind === "Array")
      return this.error(b.left, "thixo/not-in-language", "Destructuring assignment is not in the language.", "Declare new names: `const { a, b } = value`.");
    const member = this.memberTarget(b.left);
    if (!member) return this.error(b.left, "thixo/not-in-language", "You can assign to a name or a field, nothing else.");
    if (assign === "&&=" || assign === "||=" || assign === "??=")
      return this.error(b, "thixo/not-in-language", `\`${assign}\` on a field is not in the language.`, `Write \`obj.field = obj.field ${assign.slice(0, 2)} value\`.`);
    return `rt.s(${member.obj}, ${member.key}, ${this.expr(b.right)}${assign === "=" ? "" : `, ${JSON.stringify(assign)}`})`;
  }

  private binary(b: A.Binary): string {
    const op = b.op;
    if (BINARY_OPS.has(op)) return `(${this.expr(b.left)} ${op} ${this.expr(b.right)})`;
    const banned: Record<string, [string, string]> = {
      "==": ["`==` is not in the language.", "Use `===`."],
      "!=": ["`!=` is not in the language.", "Use `!==`."],
      in: ["`in` is not in the language.", "Read the field and compare it with `undefined`."],
      instanceof: ["`instanceof` is not in the language.", "Use `typeof`, `Array.isArray`, or a field that says what the value is."],
      ",": ["The comma operator is not in the language.", "Write each expression as its own statement."],
    };
    const ban = banned[op];
    return this.error({ start: b.opStart }, "thixo/operator", ban?.[0] ?? `\`${op}\` is not in the language.`, ban?.[1]);
  }

  // ---- JSX ----

  private jsxElement(node: A.JsxElement): string {
    const tagName = node.name;
    let tag: string | undefined;
    let tagCode: string;
    if (tagName.kind === "Ident" && /^[a-z]/.test(tagName.name)) {
      tag = tagName.name;
      if (!isElementAllowed(tag)) {
        const why: Record<string, string> = {
          script: "it runs code",
          iframe: "it brings in another runnable source",
          object: "it brings in another runnable source",
          embed: "it brings in another runnable source",
          link: "it loads or redirects what the page does",
          meta: "it loads or redirects what the page does",
          base: "it loads or redirects what the page does",
          style: "styles are written with `css({...})` or the `style` prop",
          foreignObject: "it embeds HTML inside SVG",
          use: "it loads another document",
        };
        this.error(tagName, "thixo/element", `\`<${tag}>\` is not an element a program can create${why[tag] ? `: ${why[tag]}` : ""}.`, "Use an allowed HTML or SVG element, or a component from `thixo/ui`.");
      }
      tagCode = JSON.stringify(tag);
    } else if (tagName.kind === "Ident") tagCode = this.ref(tagName);
    else return this.error(tagName, "thixo/element", "A tag is a plain element name or a component's name.");
    const props: string[] = [];
    for (const attr of node.attrs) {
      if (attr.kind === "JsxSpreadAttr") {
        props.push(`rt.sp(${this.expr(attr.arg)})`);
        continue;
      }
      if (attr.name.kind !== "Ident") {
        this.error(attr.name, "thixo/attribute", "Namespaced attributes such as `xlink:href` are not in the language.");
        continue;
      }
      const name = attr.name.name;
      if (tag !== undefined) {
        const kind = attrKind(tag, name);
        if (!kind) {
          this.badAttribute(attr, tag, name);
          continue;
        }
        props.push(JSON.stringify(name), this.attrValue(attr, tag, name, kind));
      } else props.push(JSON.stringify(name), this.attrValue(attr, undefined, name, undefined));
    }
    const children = node.children ? this.jsxChildren(node.children) : "[]";
    return `rt.el(${tagCode}, [${props.join(", ")}], ${children})`;
  }

  private badAttribute(attr: A.JsxAttr, tag: string, name: string): void {
    const special: Record<string, [string, string]> = {
      ref: ["Refs are not in the language: a program never holds an element.", "Keep what you need in `useState`, and read values from event handlers."],
      dangerouslySetInnerHTML: ["Raw HTML is not in the language.", "Build the content with JSX."],
      srcDoc: ["`srcDoc` is not in the language.", "Build the content with JSX."],
      srcdoc: ["`srcdoc` is not in the language.", "Build the content with JSX."],
      id: ["`id` is not allowed: ids collide with the page's own.", "Nest the element inside the one it belongs to, or use `aria-*` attributes."],
      htmlFor: ["`htmlFor` is not allowed: ids collide with the page's own.", "Put the input inside the `<label>`."],
      target: ["`target` is set by the language: every link opens in a new tab.", "Remove it."],
      rel: ["`rel` is set by the language.", "Remove it."],
      action: ["`action` is not allowed: a form never submits anywhere.", "Handle `onSubmit`."],
      formAction: ["`formAction` is not allowed: a form never submits anywhere.", "Handle `onSubmit`."],
      xlinkHref: ["`xlinkHref` is not in the language.", "Draw the shape directly."],
      href: [`\`href\` is allowed only on \`<a>\`.`, "Wrap the content in `<a href=...>`."],
      src: [`\`src\` is allowed only on \`<img>\`.`, "Use `<img src=...>`."],
      popover: ["`popover` is not allowed: it draws outside the program's box.", "Draw it inside the program."],
      autoFocus: ["`autoFocus` is not allowed: a program can't take focus from the page.", "Remove it."],
    };
    if (special[name]) {
      this.error(attr, "thixo/attribute", special[name][0], special[name][1]);
      return;
    }
    if (/^on[a-z]/.test(name)) {
      this.error(attr, "thixo/attribute", `\`${name}\` is an attribute that takes code. Event handlers are camelCase props given a function.`, `Write \`on${name.slice(2, 3).toUpperCase()}${name.slice(3)}={(e) => ...}\`.`);
      return;
    }
    this.error(attr, "thixo/attribute", `\`${name}\` is not an attribute \`<${tag}>\` may have.`, "See the JSX types for the attributes each element takes.");
  }

  private attrValue(attr: A.JsxAttr, tag: string | undefined, name: string, kind: AttrKind | undefined): string {
    const init = attr.value;
    let literal: { node: A.Node; text: string } | undefined;
    let exprNode: A.Expr | undefined;
    if (!init) return "true";
    const isAttrString = init.kind === "Str";
    if (init.kind === "Str") literal = { node: init, text: init.value };
    else if (init.kind === "JsxExprContainer") {
      if (!init.expr) return this.error(init, "thixo/attribute", `\`${name}\` needs a value.`);
      if (init.spread) return this.error(init, "thixo/attribute", "Spread a record with `{...record}` on its own.");
      const e = init.expr;
      if (e.kind === "Str") literal = { node: e, text: e.value };
      else if (e.kind === "Template" && e.exprs.length === 0) literal = { node: e, text: e.quasis[0].cooked };
      else exprNode = e;
    } else return this.error(init, "thixo/attribute", "An attribute's value is a string or an expression in braces.");
    if (kind === "link" || kind === "load") {
      if (literal) return this.addressLiteral(literal, kind, tag!, name);
      if (exprNode && (exprNode.kind === "Template" || (exprNode.kind === "Binary" && exprNode.op === "+")))
        return this.error(exprNode, "thixo/address", "A program can't build an address.", "Write the address out in the attribute, or pass along a `Url` the host handed you.");
    }
    if (kind === "event" && literal) return this.error(literal.node, "thixo/attribute", `\`${name}\` takes a function, not code in a string.`, `Write \`${name}={() => ...}\`.`);
    if (literal) return JSON.stringify(isAttrString ? decodeEntities(literal.text) : literal.text);
    return this.expr(exprNode!);
  }

  private addressLiteral(lit: { node: A.Node; text: string }, kind: "link" | "load", tag: string, name: string): string {
    const text = lit.text;
    const check = checkAddress(text, kind);
    if (check !== true)
      return this.error(
        lit.node,
        "thixo/address",
        `\`<${tag} ${name}="${text.length > 60 ? text.slice(0, 57) + "..." : text}">\`: ${check}`,
        kind === "load"
          ? "A program loads nothing from outside the page. Draw it with SVG, use a `data:` image, or a `Url` the host handed you."
          : "A written-out link is an `https://` address. To link elsewhere, pass along a `Url` the host handed you.",
      );
    if (kind === "link" && !text.startsWith("data:")) this.facts.links.add(text);
    return `rt.addr(${JSON.stringify(text)}, ${JSON.stringify(kind)})`;
  }

  private jsxChildren(children: readonly A.JsxChild[]): string {
    const out: string[] = [];
    for (const child of children) {
      if (child.kind === "JsxText") {
        const text = cleanJsxText(child.raw);
        if (text !== null) out.push(JSON.stringify(decodeEntities(text)));
      } else if (child.kind === "JsxExprContainer") {
        if (child.spread) {
          this.error(child, "thixo/not-in-language", "Spread children are not in the language.", "Put the list in braces: `{items}`.");
          continue;
        }
        if (child.expr) out.push(this.expr(child.expr));
      } else out.push(this.expr(child));
    }
    return `[${out.join(", ")}]`;
  }
}

/** True when an address literal may stand where `kind` says, or the reason it may not. A program loads only
 * `data:` images and fonts it wrote out: an outside address it loads would tell that server the program ran, and a
 * choice between several would carry data. A written-out link may go to any `https://` host: it waits for a click. */
export function checkAddress(text: string, kind: "link" | "load"): true | string {
  if (kind === "load") {
    if (!/^data:/i.test(text)) return "a program can't load an outside address.";
    if (!/^data:(image\/(png|jpeg|gif|webp|avif|svg\+xml)|font\/(woff2?|ttf|otf))[;,]/i.test(text)) return "a `data:` address here must be an image or a font.";
    return true;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "this is not a full address. Write it with `https://`.";
  }
  if (url.protocol !== "https:") return url.protocol === "http:" ? "a written-out link must be `https://`." : `\`${url.protocol}\` addresses are not allowed.`;
  if (url.username || url.password) return "an address can't carry a user name or password.";
  if (!url.hostname) return "this address has no host.";
  return true;
}

/** JSX text whitespace, as React's JSX transform treats it. */
export function cleanJsxText(raw: string): string | null {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let out = "";
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, " ");
    if (i !== 0) t = t.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, "");
    if (t) {
      if (i !== lastNonEmpty) t += " ";
      out += t;
    }
  });
  return out === "" ? null : out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", middot: "·", mdash: "—", ndash: "–", hellip: "…" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
  });
}
