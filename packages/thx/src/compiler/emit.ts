// The syntax pass and the code generator, as one walk. Every node kind the walk knows is handled by a case that
// checks it and writes its JavaScript; every other kind is an error. Nothing reaches the output that this file did
// not write.

import ts from "typescript";
import type { CompileEnv, FieldDecl, FieldType, ThxError } from "../contract.js";
import { attrKind, isElementAllowed, type AttrKind } from "../runtime/allowlist.js";
import { BUILTIN_GLOBALS, CONSTRUCTIBLE } from "./lib-dts.js";
import type { PluginProgram } from "./program.js";
import { resolveRelative } from "./program.js";

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

const RESERVED_NAMES = new Set(["arguments", "eval", "undefined", "NaN", "Infinity", "rt"]);

const BINARY_OPS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.PlusToken, "+"],
  [ts.SyntaxKind.MinusToken, "-"],
  [ts.SyntaxKind.AsteriskToken, "*"],
  [ts.SyntaxKind.SlashToken, "/"],
  [ts.SyntaxKind.PercentToken, "%"],
  [ts.SyntaxKind.AsteriskAsteriskToken, "**"],
  [ts.SyntaxKind.LessThanToken, "<"],
  [ts.SyntaxKind.GreaterThanToken, ">"],
  [ts.SyntaxKind.LessThanEqualsToken, "<="],
  [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
  [ts.SyntaxKind.AmpersandAmpersandToken, "&&"],
  [ts.SyntaxKind.BarBarToken, "||"],
  [ts.SyntaxKind.QuestionQuestionToken, "??"],
  [ts.SyntaxKind.AmpersandToken, "&"],
  [ts.SyntaxKind.BarToken, "|"],
  [ts.SyntaxKind.CaretToken, "^"],
  [ts.SyntaxKind.LessThanLessThanToken, "<<"],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, ">>"],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, ">>>"],
]);

const ASSIGN_OPS = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.EqualsToken, "="],
  [ts.SyntaxKind.PlusEqualsToken, "+="],
  [ts.SyntaxKind.MinusEqualsToken, "-="],
  [ts.SyntaxKind.AsteriskEqualsToken, "*="],
  [ts.SyntaxKind.SlashEqualsToken, "/="],
  [ts.SyntaxKind.PercentEqualsToken, "%="],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, "**="],
  [ts.SyntaxKind.AmpersandEqualsToken, "&="],
  [ts.SyntaxKind.BarEqualsToken, "|="],
  [ts.SyntaxKind.CaretEqualsToken, "^="],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, "<<="],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, ">>="],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ">>>="],
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken, "&&="],
  [ts.SyntaxKind.BarBarEqualsToken, "||="],
  [ts.SyntaxKind.QuestionQuestionEqualsToken, "??="],
]);

const FIELD_KINDS: Record<string, FieldType> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  date: "date",
  url: "url",
};

/** What the walk learns about the plugin while it writes the code. */
export interface Facts {
  imports: { file: string; spec: string; name: string; node: ts.Node }[];
  annotations: { record: string; fields: FieldDecl[]; node: ts.Node; file: string }[];
  stores: { name: string; fields: FieldDecl[]; node: ts.Node; file: string }[];
  addresses: Set<string>;
  slot?: string;
  meta?: { id?: string; name: string; description: string };
}

interface FnCtx {
  /** Temp holding the async function's budget context, for awaits. */
  asyncCtx?: string;
}

const KIND_NAMES: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.ClassDeclaration]: "Classes",
  [ts.SyntaxKind.ClassExpression]: "Classes",
  [ts.SyntaxKind.ThisKeyword]: "`this`",
  [ts.SyntaxKind.SuperKeyword]: "`super`",
  [ts.SyntaxKind.WithStatement]: "`with`",
  [ts.SyntaxKind.LabeledStatement]: "Labels",
  [ts.SyntaxKind.DeleteExpression]: "`delete`",
  [ts.SyntaxKind.VoidExpression]: "`void`",
  [ts.SyntaxKind.TaggedTemplateExpression]: "Tagged templates",
  [ts.SyntaxKind.RegularExpressionLiteral]: "Regular expressions",
  [ts.SyntaxKind.GetAccessor]: "Getters",
  [ts.SyntaxKind.SetAccessor]: "Setters",
  [ts.SyntaxKind.YieldExpression]: "Generators",
  [ts.SyntaxKind.ForInStatement]: "`for ... in`",
  [ts.SyntaxKind.DebuggerStatement]: "`debugger`",
  [ts.SyntaxKind.EnumDeclaration]: "Enums",
  [ts.SyntaxKind.ModuleDeclaration]: "Namespaces",
  [ts.SyntaxKind.MetaProperty]: "`new.target` and `import.meta`",
  [ts.SyntaxKind.BigIntLiteral]: "BigInt literals",
  [ts.SyntaxKind.Decorator]: "Decorators",
  [ts.SyntaxKind.ImportEqualsDeclaration]: "`import x = require(...)`",
  [ts.SyntaxKind.ExportAssignment]: "`export =`",
  [ts.SyntaxKind.PrivateIdentifier]: "Private names",
  [ts.SyntaxKind.CommaListExpression]: "The comma operator",
};

const KIND_HINTS: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.ClassDeclaration]: "Write a function instead. Components are functions.",
  [ts.SyntaxKind.ThisKeyword]: "Pass the value as a parameter.",
  [ts.SyntaxKind.RegularExpressionLiteral]:
    "Use string methods: includes, startsWith, endsWith, indexOf, split, replaceAll.",
  [ts.SyntaxKind.ForInStatement]: "Use `for (const key of Object.keys(record))`.",
  [ts.SyntaxKind.DeleteExpression]: "Build a new record without the field: `const { field, ...rest } = record`.",
  [ts.SyntaxKind.GetAccessor]: "Use a plain field or a function.",
  [ts.SyntaxKind.SetAccessor]: "Use a plain field or a function.",
  [ts.SyntaxKind.YieldExpression]: "Build a list and return it.",
  [ts.SyntaxKind.EnumDeclaration]: 'Use a union of string literals: `type Tone = "info" | "warning"`.',
  [ts.SyntaxKind.LabeledStatement]: "Move the inner loop into a function and return from it.",
};

export class Emitter {
  readonly errors: ThxError[] = [];
  readonly facts: Facts = { imports: [], annotations: [], stores: [], addresses: new Set() };
  private temp = 0;
  private fnStack: FnCtx[] = [];
  private sf!: ts.SourceFile;
  private path = "";
  private fileIndex = 0;
  private dataDecl = false;

  constructor(
    private readonly p: PluginProgram,
    private readonly env: CompileEnv,
    private readonly order: string[],
  ) {}

  // ---- errors ----

  error(node: ts.Node, code: string, message: string, hint?: string): string {
    const sf = node.getSourceFile();
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    this.errors.push({
      file: this.p.pluginPathOf(sf) ?? sf.fileName,
      line: pos.line + 1,
      column: pos.character + 1,
      code,
      message,
      ...(hint ? { hint } : {}),
    });
    return "(void 0)";
  }

  private notInLanguage(node: ts.Node): string {
    const what = KIND_NAMES[node.kind] ?? `\`${ts.SyntaxKind[node.kind]}\``;
    const verb = what.endsWith("s") && !what.startsWith("`") ? "are" : "is";
    return this.error(node, "thx/not-in-language", `${what} ${verb} not in the language.`, KIND_HINTS[node.kind]);
  }

  private t(): string {
    return `t${++this.temp}`;
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
    for (const stmt of sf.statements)
      if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) names.push(this.declName(stmt.name));
    return names;
  }

  private scanTypesAndComments(sf: ts.SourceFile): void {
    const directive = /@ts-(ignore|expect-error|nocheck)\b/g;
    for (let m = directive.exec(sf.text); m; m = directive.exec(sf.text)) {
      const pos = sf.getLineAndCharacterOfPosition(m.index);
      this.errors.push({
        file: this.path,
        line: pos.line + 1,
        column: pos.character + 1,
        code: "thx/ts-directive",
        message: `\`@ts-${m[1]}\` is not allowed: the type check is part of the wall and can't be switched off.`,
        hint: "Fix the type error it was hiding.",
      });
    }
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        this.error(node, "thx/no-any", "`any` is not in the language: it switches the type check off.", "Write the real type, or `unknown` and narrow it.");
      else if (ts.isImportTypeNode(node)) this.error(node, "thx/not-in-language", "`import(...)` types are not in the language.", "Import the type at the top of the file.");
      else if (ts.isJSDocTypeExpression?.(node)) return;
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // ---- names ----

  private checkIdentifierText(id: ts.Identifier | ts.PrivateIdentifier): void {
    const raw = id.getText(this.sf);
    if (raw.includes("\\"))
      this.error(id, "thx/identifier", `The name \`${raw}\` uses an escape. Names are written out in plain letters.`, `Write \`${id.text}\`.`);
    else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id.text))
      this.error(id, "thx/identifier", `The name \`${id.text}\` has characters outside A-Z, a-z, 0-9, _ and $.`);
  }

  private isTopLevelDecl(decl: ts.Node): boolean {
    let n: ts.Node | undefined = decl.parent;
    while (n) {
      if (ts.isSourceFile(n)) return true;
      if (
        ts.isFunctionLike(n) ||
        ts.isBlock(n) ||
        ts.isCatchClause(n) ||
        ts.isForStatement(n) ||
        ts.isForOfStatement(n) ||
        ts.isCaseBlock(n)
      )
        return false;
      n = n.parent;
    }
    return false;
  }

  private nameForDecl(decl: ts.Declaration, text: string): string {
    const sf = decl.getSourceFile();
    const path = this.p.pluginPathOf(sf);
    if (path === undefined) throw new Error("declaration outside the plugin");
    if (!ts.isFunctionExpression(decl) && this.isTopLevelDecl(decl)) return `u${this.order.indexOf(path)}_${text}`;
    return `l_${text}`;
  }

  /** The emitted name of a declaration's name identifier. */
  private declName(id: ts.Identifier): string {
    this.checkIdentifierText(id);
    if (RESERVED_NAMES.has(id.text))
      return this.error(id, "thx/identifier", `\`${id.text}\` can't be used as a name in the language.`, "Choose another name.");
    const decl = id.parent as ts.Declaration;
    return this.nameForDecl(decl, id.text);
  }

  /** The emitted form of an identifier that reads a value. */
  private ref(id: ts.Identifier, symbolOverride?: ts.Symbol): string {
    this.checkIdentifierText(id);
    const sym = symbolOverride ?? this.p.checker.getSymbolAtLocation(id);
    const decls = sym?.declarations ?? [];
    if (id.text === "undefined" && decls.length === 0) return "(void 0)";
    if (!sym || decls.length === 0) return this.noGlobal(id);
    const decl = decls[0];
    const sf = decl.getSourceFile();
    if (this.p.isLib(sf)) {
      if (!BUILTIN_GLOBALS.has(id.text)) return this.noGlobal(id);
      if (id.text === "NaN") return "(0 / 0)";
      if (id.text === "Infinity") return "(1 / 0)";
      return `rt.${id.text}`;
    }
    const path = this.p.pluginPathOf(sf);
    if (path === undefined) return this.noGlobal(id);
    if (ts.isImportSpecifier(decl)) {
      const spec = (decl.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text;
      const rel = resolveRelative(path, spec, Object.fromEntries([...this.p.files.keys()].map((k) => [k, ""])));
      if (rel !== undefined) {
        const target = this.p.checker.getAliasedSymbol(sym);
        const tdecl = target.declarations?.[0];
        if (!tdecl || this.p.pluginPathOf(tdecl.getSourceFile()) === undefined)
          return this.error(id, "thx/import", `\`${id.text}\` is not exported by \`${spec}\`.`);
        const tname = ts.getNameOfDeclaration(tdecl);
        if (!tname || !ts.isIdentifier(tname)) return this.error(id, "thx/import", `\`${id.text}\` can't be imported.`);
        return this.nameForDecl(tdecl, tname.text);
      }
      if (this.isDataBuilder(sym) && !this.dataDecl) return this.dataOutOfPlace(id);
      return `u${this.order.indexOf(path)}_${decl.name.text}`;
    }
    if (ts.isImportClause(decl) || ts.isNamespaceImport(decl)) return this.error(id, "thx/import", "Only named imports are in the language.");
    const name = ts.getNameOfDeclaration(decl);
    if (!name || !ts.isIdentifier(name)) return this.noGlobal(id);
    return this.nameForDecl(decl, name.text);
  }

  private noGlobal(id: ts.Identifier): string {
    const name = id.text;
    const hints: Record<string, string> = {
      window: "A plugin reaches the app only through what it imports from the SDK.",
      document: "Render elements with JSX instead.",
      fetch: "Call an endpoint imported from `@app/sdk`.",
      XMLHttpRequest: "Call an endpoint imported from `@app/sdk`.",
      WebSocket: "Call an endpoint imported from `@app/sdk`.",
      setTimeout: "Timers are not in the language. Use `useEffect` from `thixo/plugin` to react to changes.",
      setInterval: "Timers are not in the language. Use `useEffect` from `thixo/plugin` to react to changes.",
      localStorage: "Keep data in a store declared with `store` from `thixo/data`.",
      sessionStorage: "Keep data in a store declared with `store` from `thixo/data`.",
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
      "thx/no-global",
      `\`${name}\` does not exist in the language. A plugin can name only what it imports, what it declares and the built-ins (${[...BUILTIN_GLOBALS].join(", ")}).`,
      hints[name] ?? "Import it from a module the app provides, or declare it.",
    );
  }

  private isDataBuilder(sym: ts.Symbol): boolean {
    const decl = sym.declarations?.[0];
    if (!decl || !ts.isImportSpecifier(decl)) return false;
    const spec = (decl.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text;
    const imported = (decl.propertyName ?? decl.name).text;
    return (spec === "thixo/data" && (imported === "annotate" || imported === "store")) || (spec === "thixo/schema" && imported === "t");
  }

  private dataOutOfPlace(node: ts.Node): string {
    return this.error(
      node,
      "thx/data-literal",
      "`annotate`, `store` and `t` may be used only as the value of an exported `const` at the top of a file, with literal arguments.",
      'Write `export const due = annotate(Todo, { dueOn: t.date() });` at the top of the file.',
    );
  }

  /** The import a name refers to, as `{ spec, imported }`, or undefined. */
  private importOf(id: ts.Expression): { spec: string; imported: string } | undefined {
    if (!ts.isIdentifier(id)) return undefined;
    const sym = this.p.checker.getSymbolAtLocation(id);
    const decl = sym?.declarations?.[0];
    if (!decl || !ts.isImportSpecifier(decl)) return undefined;
    return { spec: (decl.parent.parent.parent.moduleSpecifier as ts.StringLiteral).text, imported: (decl.propertyName ?? decl.name).text };
  }

  // ---- top level ----

  private topLevel(stmt: ts.Statement): string {
    const isPlugin = this.path === "plugin.thx";
    if (ts.isImportDeclaration(stmt)) return this.importDecl(stmt);
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) return this.typeDecl(stmt);
    if (ts.isFunctionDeclaration(stmt)) {
      this.checkModifiers(stmt, ["export", "async"]);
      return this.functionDecl(stmt);
    }
    if (ts.isVariableStatement(stmt)) {
      this.checkModifiers(stmt, ["export"]);
      if (!(stmt.declarationList.flags & ts.NodeFlags.Const))
        return this.error(stmt, "thx/top-level", "Only `const` may be declared at the top of a file.", "Keep changing values inside a component with `useState`.");
      const exported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      return stmt.declarationList.declarations.map((d) => this.topConst(d, exported)).join("\n");
    }
    if (ts.isExportAssignment(stmt)) {
      if (stmt.isExportEquals) return this.notInLanguage(stmt);
      if (!isPlugin)
        return this.error(stmt, "thx/define-plugin", "Only `plugin.thx` has a default export.", "Export named values from other files.");
      return this.definePlugin(stmt);
    }
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) return this.error(stmt, "thx/import", "`export ... from` is not in the language.", "Import the value, then export it.");
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) return this.notInLanguage(stmt);
      for (const el of stmt.exportClause.elements) {
        if (!ts.isIdentifier(el.name) || (el.propertyName && !ts.isIdentifier(el.propertyName))) this.error(el, "thx/import", "Export names are written as plain names.");
        else this.checkIdentifierText(el.name);
      }
      return "";
    }
    if (ts.isEmptyStatement(stmt)) return "";
    if (ts.isExpressionStatement(stmt) || ts.isIfStatement(stmt) || ts.isForOfStatement(stmt) || ts.isWhileStatement(stmt) || ts.isForStatement(stmt))
      return this.error(
        stmt,
        "thx/top-level",
        "Code at the top of a file is not in the language: the build reads a file without running it.",
        "Move it into a function, or into the component.",
      );
    return this.notInLanguage(stmt);
  }

  private checkModifiers(node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }, allowed: string[]): void {
    for (const m of node.modifiers ?? []) {
      const text = ts.tokenToString(m.kind) ?? "";
      if (!allowed.includes(text)) this.error(m, "thx/not-in-language", `\`${text}\` is not allowed here.`);
    }
  }

  private typeDecl(stmt: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): string {
    this.checkModifiers(stmt, ["export"]);
    return "";
  }

  private importDecl(stmt: ts.ImportDeclaration): string {
    const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
    if (stmt.attributes) this.error(stmt.attributes, "thx/import", "Import attributes are not in the language.");
    const clause = stmt.importClause;
    if (!clause) return this.error(stmt, "thx/import", "An import must name what it imports: `import { name } from \"module\"`.");
    if (clause.name) this.error(clause.name, "thx/import", "Default imports are not in the language.", `Write \`import { name } from "${spec}"\`.`);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
      this.error(clause.namedBindings, "thx/import", "`import * as` is not in the language.", `Write \`import { name } from "${spec}"\`.`);
    const relative = spec.startsWith("./") || spec.startsWith("../");
    const files = Object.fromEntries([...this.p.files.keys()].map((k) => [k, ""]));
    if (relative) {
      if (resolveRelative(this.path, spec, files) === undefined)
        return this.error(stmt.moduleSpecifier, "thx/missing-file", `\`${spec}\` is not one of this plugin's files.`, `The plugin has: ${Object.keys(files).join(", ")}.`);
    } else if (!Object.prototype.hasOwnProperty.call(this.env.modules, spec)) {
      const known = Object.keys(this.env.modules).join(", ");
      const hint = spec === "react" ? "Hooks come from `thixo/plugin`: `import { useState } from \"thixo/plugin\"`." : `A plugin can import: ${known}.`;
      return this.error(stmt.moduleSpecifier, "thx/unknown-import", `\`${spec}\` can't be imported. A plugin imports only the SDK, the app's slots and the libraries the app exposes (L2).`, hint);
    }
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return "";
    const out: string[] = [];
    for (const el of clause.namedBindings.elements) {
      this.checkIdentifierText(el.name);
      if (el.propertyName && !ts.isIdentifier(el.propertyName)) {
        this.error(el.propertyName, "thx/import", "Import names are written as plain names.");
        continue;
      }
      if (RESERVED_NAMES.has(el.name.text)) {
        this.error(el.name, "thx/identifier", `\`${el.name.text}\` can't be used as a name in the language.`);
        continue;
      }
      const imported = (el.propertyName ?? el.name).text;
      const typeOnly = clause.isTypeOnly || el.isTypeOnly;
      if (!typeOnly) this.facts.imports.push({ file: this.path, spec, name: imported, node: el });
      if (relative || typeOnly) continue;
      const sym = this.p.checker.getSymbolAtLocation(el.name);
      const target = sym ? this.p.checker.getAliasedSymbol(sym) : undefined;
      if (!target || !(target.flags & ts.SymbolFlags.Value)) continue;
      out.push(`const u${this.fileIndex}_${el.name.text} = rt.imp(${JSON.stringify(spec)}, ${JSON.stringify(imported)});`);
    }
    return out.join("\n");
  }

  private topConst(d: ts.VariableDeclaration, exported: boolean): string {
    if (d.exclamationToken) this.error(d, "thx/not-in-language", "`!` on a declaration is not in the language.");
    if (!d.initializer) return this.error(d, "thx/top-level", "A `const` needs a value.");
    const init = d.initializer;
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
      const imp = this.importOf(init.expression);
      if (imp?.spec === "thixo/data" && (imp.imported === "annotate" || imp.imported === "store")) {
        if (!exported || !ts.isIdentifier(d.name)) return this.dataOutOfPlace(init);
        this.readDataDecl(imp.imported, init);
        this.dataDecl = true;
        try {
          return `const ${this.declName(d.name)} = ${this.expr(init)};`;
        } finally {
          this.dataDecl = false;
        }
      }
    }
    return this.varDecl(d, "const");
  }

  // ---- data declarations (U7) ----

  private readDataDecl(kind: "annotate" | "store", call: ts.CallExpression): void {
    if (call.arguments.length !== 2) {
      this.error(call, "thx/data-literal", `\`${kind}\` takes two arguments.`, kind === "annotate" ? "`annotate(Todo, { field: t.string() })`" : '`store("name", { fields: { field: t.string() } })`');
      return;
    }
    const [first, second] = call.arguments;
    if (kind === "annotate") {
      const imp = this.importOf(first);
      const rec = imp?.spec === "@app/sdk" && Object.prototype.hasOwnProperty.call(this.env.records, imp.imported) ? this.env.records[imp.imported] : undefined;
      if (!rec) {
        this.error(first, "thx/data-literal", "`annotate`'s first argument is a record imported from `@app/sdk`.", `The app's records: ${Object.keys(this.env.records).join(", ") || "none"}.`);
        return;
      }
      const fields = this.readFields(second);
      if (fields) this.facts.annotations.push({ record: rec.name, fields, node: call, file: this.path });
      return;
    }
    if (!ts.isStringLiteral(first) && !ts.isNoSubstitutionTemplateLiteral(first)) {
      this.error(first, "thx/data-literal", "A store's name is a string written out in the source.", '`store("prefs", { fields: { ... } })`');
      return;
    }
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(first.text)) {
      this.error(first, "thx/data-literal", `\`${first.text}\` is not a store name: start with a lowercase letter, then letters, digits or -.`);
      return;
    }
    if (!ts.isObjectLiteralExpression(second) || second.properties.length !== 1) {
      this.error(second, "thx/data-literal", "A store's second argument is `{ fields: { ... } }`.");
      return;
    }
    const prop = second.properties[0];
    if (!ts.isPropertyAssignment(prop) || this.staticKey(prop.name) !== "fields") {
      this.error(prop, "thx/data-literal", "A store's second argument is `{ fields: { ... } }`.");
      return;
    }
    const fields = this.readFields(prop.initializer);
    if (fields) this.facts.stores.push({ name: first.text, fields, node: call, file: this.path });
  }

  private readFields(node: ts.Expression): FieldDecl[] | undefined {
    if (!ts.isObjectLiteralExpression(node)) {
      this.error(node, "thx/data-literal", "Fields are an object written out in the source: `{ dueOn: t.date() }`.");
      return undefined;
    }
    const out: FieldDecl[] = [];
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        this.error(prop, "thx/data-literal", "Each field is `name: t.kind()`.");
        continue;
      }
      const name = this.staticKey(prop.name);
      if (name === undefined || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
        this.error(prop.name, "thx/data-literal", "A field's name is a plain name written out in the source.");
        continue;
      }
      if (out.some((f) => f.name === name)) {
        this.error(prop.name, "thx/data-literal", `The field \`${name}\` is declared twice.`);
        continue;
      }
      const type = this.fieldType(prop.initializer);
      if (type) out.push({ name, type });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private fieldType(node: ts.Expression): FieldType | undefined {
    const allowed = "t.string(), t.number(), t.boolean(), t.date(), t.url(), t.array(t.string()) or t.array(t.number())";
    const bad = () => {
      this.error(node, "thx/data-literal", `A field's type is one of ${allowed}.`);
      return undefined;
    };
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return bad();
    const target = this.importOf(node.expression.expression);
    if (target?.spec !== "thixo/schema" || target.imported !== "t") return bad();
    const kind = node.expression.name.text;
    if (Object.prototype.hasOwnProperty.call(FIELD_KINDS, kind) && node.arguments.length === 0) return FIELD_KINDS[kind];
    if (kind === "array" && node.arguments.length === 1) {
      const inner = this.fieldType(node.arguments[0]);
      if (inner === "string") return "string[]";
      if (inner === "number") return "number[]";
    }
    return bad();
  }

  // ---- definePlugin ----

  private definePlugin(stmt: ts.ExportAssignment): string {
    const call = stmt.expression;
    const usage = 'export default definePlugin(slot, { name: "...", description: "..." }, function Component({ context, emit }) { ... })';
    if (!ts.isCallExpression(call) || this.importOf(call.expression)?.spec !== "thixo/plugin" || this.importOf(call.expression)?.imported !== "definePlugin")
      return this.error(stmt, "thx/define-plugin", "`plugin.thx`'s default export is a call to `definePlugin` from `thixo/plugin`.", usage);
    if (call.arguments.length !== 3) return this.error(call, "thx/define-plugin", "`definePlugin` takes three arguments: the slot, the metadata and the component.", usage);
    const [slotArg, metaArg, comp] = call.arguments;
    const slotImp = this.importOf(slotArg);
    const slot = slotImp?.spec === "@app/slots" && Object.prototype.hasOwnProperty.call(this.env.slots, slotImp.imported) ? this.env.slots[slotImp.imported] : undefined;
    if (!slot)
      this.error(slotArg, "thx/define-plugin", "`definePlugin`'s first argument is a slot imported from `@app/slots`.", `The app's slots: ${Object.keys(this.env.slots).join(", ")}.`);
    else this.facts.slot = slot.name;
    const meta: Record<string, string> = {};
    if (!ts.isObjectLiteralExpression(metaArg)) {
      this.error(metaArg, "thx/define-plugin", "`definePlugin`'s second argument is an object written out in the source.", '{ name: "Due dates", description: "..." }');
    } else {
      for (const prop of metaArg.properties) {
        const key = ts.isPropertyAssignment(prop) ? this.staticKey(prop.name) : undefined;
        if (!ts.isPropertyAssignment(prop) || key === undefined || !["name", "description", "id"].includes(key)) {
          this.error(prop, "thx/define-plugin", "The metadata has only `name`, `description` and `id`.");
          continue;
        }
        const v = prop.initializer;
        if (!ts.isStringLiteral(v) && !ts.isNoSubstitutionTemplateLiteral(v)) {
          this.error(v, "thx/define-plugin", `\`${key}\` is a string written out in the source.`);
          continue;
        }
        meta[key] = v.text;
      }
      if (meta.name === undefined) this.error(metaArg, "thx/define-plugin", "The metadata needs a `name`.", '{ name: "Due dates", description: "..." }');
    }
    this.facts.meta = { name: meta.name ?? "", description: meta.description ?? "", ...(meta.id !== undefined ? { id: meta.id } : {}) };
    const metaCode = `rt.r(${Object.entries(this.facts.meta)
      .map(([k, v]) => `${JSON.stringify(k)}, ${JSON.stringify(v)}`)
      .join(", ")})`;
    return `const t0 = rt.plugin(${JSON.stringify(slot?.name ?? "")}, ${metaCode}, ${this.expr(comp)});`;
  }

  // ---- statements ----

  private statements(stmts: readonly ts.Statement[]): string {
    const regs: string[] = [];
    for (const s of stmts) if (ts.isFunctionDeclaration(s) && s.name && s.body) regs.push(`rt.fn(${this.declName(s.name)});`);
    return [...regs, ...stmts.map((s) => this.stmt(s))].join("\n");
  }

  private body(stmt: ts.Statement, prefix = ""): string {
    if (ts.isBlock(stmt)) return `{\n${prefix}${this.statements(stmt.statements)}\n}`;
    return `{\n${prefix}${this.stmt(stmt)}\n}`;
  }

  private stmt(node: ts.Statement): string {
    switch (node.kind) {
      case ts.SyntaxKind.Block:
        return `{\n${this.statements((node as ts.Block).statements)}\n}`;
      case ts.SyntaxKind.EmptyStatement:
        return ";";
      case ts.SyntaxKind.ExpressionStatement:
        return `${this.expr((node as ts.ExpressionStatement).expression)};`;
      case ts.SyntaxKind.VariableStatement: {
        const v = node as ts.VariableStatement;
        this.checkModifiers(v, []);
        const list = v.declarationList;
        const kind = this.declKind(list);
        return list.declarations.map((d) => this.varDecl(d, kind)).join("\n");
      }
      case ts.SyntaxKind.FunctionDeclaration: {
        const f = node as ts.FunctionDeclaration;
        this.checkModifiers(f, ["async"]);
        if (!ts.isBlock(f.parent) && !ts.isSourceFile(f.parent))
          return this.error(f, "thx/not-in-language", "A function declared here is not in the language.", "Declare it inside a block or use `const f = () => ...`.");
        return this.functionDecl(f);
      }
      case ts.SyntaxKind.IfStatement: {
        const s = node as ts.IfStatement;
        const els = s.elseStatement ? ` else ${this.body(s.elseStatement)}` : "";
        return `if (${this.expr(s.expression)}) ${this.body(s.thenStatement)}${els}`;
      }
      case ts.SyntaxKind.WhileStatement: {
        const s = node as ts.WhileStatement;
        return `while (${this.expr(s.expression)}) ${this.body(s.statement, "rt.tick();\n")}`;
      }
      case ts.SyntaxKind.DoStatement: {
        const s = node as ts.DoStatement;
        return `do ${this.body(s.statement, "rt.tick();\n")} while (${this.expr(s.expression)});`;
      }
      case ts.SyntaxKind.ForStatement:
        return this.forStmt(node as ts.ForStatement);
      case ts.SyntaxKind.ForOfStatement:
        return this.forOf(node as ts.ForOfStatement);
      case ts.SyntaxKind.ReturnStatement: {
        const s = node as ts.ReturnStatement;
        if (this.fnStack.length === 0) return this.error(s, "thx/not-in-language", "`return` outside a function.");
        return s.expression ? `return ${this.expr(s.expression)};` : "return;";
      }
      case ts.SyntaxKind.BreakStatement:
      case ts.SyntaxKind.ContinueStatement: {
        const s = node as ts.BreakStatement | ts.ContinueStatement;
        if (s.label) return this.error(s, "thx/not-in-language", "Labels are not in the language.", KIND_HINTS[ts.SyntaxKind.LabeledStatement]);
        return node.kind === ts.SyntaxKind.BreakStatement ? "break;" : "continue;";
      }
      case ts.SyntaxKind.ThrowStatement:
        return `throw ${this.expr((node as ts.ThrowStatement).expression)};`;
      case ts.SyntaxKind.TryStatement:
        return this.tryStmt(node as ts.TryStatement);
      case ts.SyntaxKind.SwitchStatement:
        return this.switchStmt(node as ts.SwitchStatement);
      case ts.SyntaxKind.InterfaceDeclaration:
      case ts.SyntaxKind.TypeAliasDeclaration:
        return this.typeDecl(node as ts.InterfaceDeclaration);
      default:
        return this.notInLanguage(node);
    }
  }

  private declKind(list: ts.VariableDeclarationList): "const" | "let" {
    if (list.flags & ts.NodeFlags.Const) return "const";
    if (list.flags & ts.NodeFlags.Let) return "let";
    this.error(list, "thx/not-in-language", "`var` and `using` are not in the language.", "Use `const`, or `let` for a value that changes.");
    return "let";
  }

  private varDecl(d: ts.VariableDeclaration, kind: "const" | "let"): string {
    if (d.exclamationToken) this.error(d, "thx/not-in-language", "`!` on a declaration is not in the language.");
    if (ts.isIdentifier(d.name)) {
      const name = this.declName(d.name);
      if (!d.initializer) {
        if (kind === "const") return this.error(d, "thx/not-in-language", "A `const` needs a value.");
        return `let ${name};`;
      }
      return `${kind} ${name} = ${this.expr(d.initializer)};`;
    }
    if (!d.initializer) return this.error(d, "thx/not-in-language", "A destructuring declaration needs a value.");
    const t = this.t();
    return [`const ${t} = ${this.expr(d.initializer)};`, ...this.pattern(d.name, t, kind)].join("\n");
  }

  /** Statements that bind every name in a destructuring pattern from the value in `src`. */
  private pattern(pat: ts.BindingName, src: string, kind: "const" | "let"): string[] {
    if (ts.isIdentifier(pat)) return [`${kind} ${this.declName(pat)} = ${src};`];
    const out: string[] = [];
    const bind = (el: ts.BindingElement, value: string) => {
      if (el.initializer) {
        const t = this.t();
        out.push(`const ${t} = ${value};`);
        value = `(${t} === void 0 ? ${this.expr(el.initializer)} : ${t})`;
      }
      if (ts.isIdentifier(el.name)) out.push(`${kind} ${this.declName(el.name)} = ${value};`);
      else {
        const t = this.t();
        out.push(`const ${t} = ${value};`);
        out.push(...this.pattern(el.name, t, kind));
      }
    };
    if (ts.isObjectBindingPattern(pat)) {
      const keys: string[] = [];
      for (const el of pat.elements) {
        if (el.dotDotDotToken) {
          if (!ts.isIdentifier(el.name)) {
            this.error(el, "thx/not-in-language", "A rest element binds a plain name.");
            continue;
          }
          out.push(`${kind} ${this.declName(el.name)} = rt.rest(${src}, [${keys.join(", ")}]);`);
          continue;
        }
        let key: string;
        if (!el.propertyName) {
          if (!ts.isIdentifier(el.name)) {
            this.error(el, "thx/not-in-language", "This pattern is not in the language.");
            continue;
          }
          key = this.keyLiteral(el.name, el.name.text);
        } else if (ts.isComputedPropertyName(el.propertyName)) {
          const t = this.t();
          out.push(`const ${t} = ${this.expr(el.propertyName.expression)};`);
          key = t;
        } else {
          const k = this.staticKey(el.propertyName);
          if (k === undefined) {
            this.error(el.propertyName, "thx/not-in-language", "This key is not in the language.");
            continue;
          }
          key = this.keyLiteral(el.propertyName, k);
        }
        keys.push(key);
        bind(el, `rt.g(${src}, ${key})`);
      }
      return out;
    }
    const list = this.t();
    out.push(`const ${list} = rt.list(${src});`);
    pat.elements.forEach((el, i) => {
      if (ts.isOmittedExpression(el)) return;
      if (el.dotDotDotToken) {
        if (!ts.isIdentifier(el.name)) {
          this.error(el, "thx/not-in-language", "A rest element binds a plain name.");
          return;
        }
        out.push(`${kind} ${this.declName(el.name)} = rt.m(${list}, "slice", [${i}]);`);
        return;
      }
      bind(el, `rt.g(${list}, ${i})`);
    });
    return out;
  }

  private forStmt(s: ts.ForStatement): string {
    let init = "";
    if (s.initializer) {
      if (ts.isVariableDeclarationList(s.initializer)) {
        const kind = this.declKind(s.initializer);
        const parts = s.initializer.declarations.map((d) => {
          if (!ts.isIdentifier(d.name)) return this.error(d, "thx/not-in-language", "Destructuring in a `for` header is not in the language.", "Destructure inside the loop body.");
          return d.initializer ? `${this.declName(d.name)} = ${this.expr(d.initializer)}` : this.declName(d.name);
        });
        init = `${kind} ${parts.join(", ")}`;
      } else init = this.expr(s.initializer);
    }
    const cond = s.condition ? this.expr(s.condition) : "";
    const inc = s.incrementor ? this.expr(s.incrementor) : "";
    return `for (${init}; ${cond}; ${inc}) ${this.body(s.statement, "rt.tick();\n")}`;
  }

  private forOf(s: ts.ForOfStatement): string {
    if (s.awaitModifier) return this.error(s, "thx/not-in-language", "`for await` is not in the language.", "Await each value inside the loop.");
    const iter = `rt.iter(${this.expr(s.expression)})`;
    if (!ts.isVariableDeclarationList(s.initializer))
      return this.error(s.initializer, "thx/not-in-language", "A `for ... of` loop declares its variable: `for (const item of list)`.");
    const kind = this.declKind(s.initializer);
    const d = s.initializer.declarations[0];
    if (ts.isIdentifier(d.name)) return `for (${kind} ${this.declName(d.name)} of ${iter}) ${this.body(s.statement, "rt.tick();\n")}`;
    const t = this.t();
    const binds = this.pattern(d.name, t, kind).join("\n");
    return `for (const ${t} of ${iter}) ${this.body(s.statement, `rt.tick();\n${binds}\n`)}`;
  }

  private tryStmt(s: ts.TryStatement): string {
    let out = `try {\n${this.statements(s.tryBlock.statements)}\n}`;
    if (s.catchClause) {
      const c = s.catchClause;
      const t = this.t();
      let prefix = `rt.caught(${t});\n`;
      if (c.variableDeclaration) {
        if (c.variableDeclaration.type) this.error(c.variableDeclaration.type, "thx/not-in-language", "A catch variable has no type annotation.");
        prefix = this.pattern(c.variableDeclaration.name, `rt.caught(${t})`, "const").join("\n") + "\n";
      }
      out += ` catch (${t}) {\n${prefix}${this.statements(c.block.statements)}\n}`;
    }
    if (s.finallyBlock) {
      this.checkFinally(s.finallyBlock);
      out += ` finally {\n${this.statements(s.finallyBlock.statements)}\n}`;
    }
    return out;
  }

  /** A `finally` that returns, throws or jumps would swallow the error that stops a plugin. */
  private checkFinally(block: ts.Block): void {
    const visit = (n: ts.Node, inLoop: boolean): void => {
      if (ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n) || ts.isThrowStatement(n) || ((ts.isBreakStatement(n) || ts.isContinueStatement(n)) && !inLoop)) {
        this.error(n, "thx/not-in-language", "A `finally` block can't return, throw, break or continue.", "Move that code after the `try` statement.");
        return;
      }
      const loop = inLoop || ts.isIterationStatement(n, false) || ts.isSwitchStatement(n);
      ts.forEachChild(n, (c) => visit(c, loop));
    };
    visit(block, false);
  }

  private switchStmt(s: ts.SwitchStatement): string {
    const clauses = s.caseBlock.clauses.map((c) => {
      for (const st of c.statements)
        if (ts.isFunctionDeclaration(st)) this.error(st, "thx/not-in-language", "Declare functions outside the `switch`.");
      const head = ts.isCaseClause(c) ? `case ${this.expr(c.expression)}:` : "default:";
      return `${head}\n${c.statements.map((st) => this.stmt(st)).join("\n")}`;
    });
    return `switch (${this.expr(s.expression)}) {\n${clauses.join("\n")}\n}`;
  }

  // ---- functions ----

  private functionDecl(f: ts.FunctionDeclaration): string {
    if (!f.name) return this.error(f, "thx/not-in-language", "A function declaration needs a name.");
    if (!f.body) return this.error(f, "thx/not-in-language", "Overload signatures are not in the language.");
    return this.fn(f, this.declName(f.name));
  }

  /** A plugin function. Every one counts against the budget when it is entered and tracks its call depth. */
  private fn(f: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration, name = ""): string {
    if (f.asteriskToken) return this.error(f, "thx/not-in-language", "Generators are not in the language.", KIND_HINTS[ts.SyntaxKind.YieldExpression]);
    const isAsync = !!ts.getModifiers(f)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    for (const m of ts.getModifiers(f) ?? [])
      if (m.kind !== ts.SyntaxKind.AsyncKeyword && m.kind !== ts.SyntaxKind.ExportKeyword)
        this.error(m, "thx/not-in-language", `\`${ts.tokenToString(m.kind)}\` is not allowed on a function.`);
    if (!f.body) return this.error(f, "thx/not-in-language", "A function needs a body.");
    const params: string[] = [];
    const prologue: { p: ts.ParameterDeclaration; t: string }[] = [];
    for (const p of f.parameters) {
      if (p.modifiers?.length) this.error(p, "thx/not-in-language", "Parameter modifiers are not in the language.");
      if (ts.isIdentifier(p.name) && p.name.text === "this") {
        this.error(p, "thx/not-in-language", "A `this` parameter is not in the language.");
        continue;
      }
      if (p.dotDotDotToken) {
        if (!ts.isIdentifier(p.name)) {
          this.error(p, "thx/not-in-language", "A rest parameter binds a plain name.");
          continue;
        }
        params.push(`...${this.declName(p.name)}`);
        continue;
      }
      if (ts.isIdentifier(p.name) && !p.initializer) {
        params.push(this.declName(p.name));
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
          const value = p.initializer ? `(${t} === void 0 ? ${this.expr(p.initializer)} : ${t})` : t;
          if (ts.isIdentifier(p.name)) return `let ${this.declName(p.name)} = ${value};`;
          const v = this.t();
          return [`const ${v} = ${value};`, ...this.pattern(p.name, v, "let")].join("\n");
        })
        .join("\n");
      const bodyCode = ts.isBlock(f.body) ? this.statements(f.body.statements) : `return ${this.expr(f.body)};`;
      inner = `${pro}\n${bodyCode}`;
    } finally {
      this.fnStack.pop();
    }
    const core = isAsync ? `return (async () => {\nconst ${ctx.asyncCtx} = rt.ctx();\n${inner}\n})();` : inner;
    return `function ${name}(${params.join(", ")}) {\nrt.tick();\nconst ${depth} = rt.push();\ntry {\n${core}\n} finally {\nrt.pop(${depth});\n}\n}`;
  }

  // ---- expressions ----

  private staticKey(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name)) {
      this.checkIdentifierText(name);
      return name.text;
    }
    if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
    if (ts.isNumericLiteral(name)) return String(Number(name.getText(this.sf).replace(/_/g, "")));
    return undefined;
  }

  /** A field name as a JavaScript string literal, refusing the names that reach behind a value. */
  private keyLiteral(node: ts.Node, key: string): string {
    if (FORBIDDEN_FIELDS.has(key)) {
      this.error(node, "thx/forbidden-field", `\`${key}\` is not a field in the language: a record has only the fields it was given.`, "Use another name.");
      return '""';
    }
    return JSON.stringify(key);
  }

  private optionalEnd(node: ts.Expression, code: string): string {
    if (!ts.isOptionalChain(node)) return code;
    const parent = node.parent;
    const continues =
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent) || ts.isCallExpression(parent)) &&
      parent.expression === node &&
      ts.isOptionalChain(parent);
    return continues ? code : `rt.end(${code})`;
  }

  private args(list: readonly ts.Expression[]): string {
    return `[${list.map((a) => (ts.isSpreadElement(a) ? `rt.sp(${this.expr(a.expression)})` : this.expr(a))).join(", ")}]`;
  }

  expr(node: ts.Expression): string {
    switch (node.kind) {
      case ts.SyntaxKind.Identifier:
        return this.ref(node as ts.Identifier);
      case ts.SyntaxKind.NumericLiteral:
        return String(Number((node as ts.NumericLiteral).getText(this.sf).replace(/_/g, "")));
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        return JSON.stringify((node as ts.StringLiteral).text);
      case ts.SyntaxKind.TrueKeyword:
        return "true";
      case ts.SyntaxKind.FalseKeyword:
        return "false";
      case ts.SyntaxKind.NullKeyword:
        return "null";
      case ts.SyntaxKind.TemplateExpression: {
        const t = node as ts.TemplateExpression;
        const parts = [JSON.stringify(t.head.text)];
        for (const span of t.templateSpans) parts.push(`rt.str(${this.expr(span.expression)})`, JSON.stringify(span.literal.text));
        return `(${parts.join(" + ")})`;
      }
      case ts.SyntaxKind.ParenthesizedExpression:
        return `(${this.expr((node as ts.ParenthesizedExpression).expression)})`;
      case ts.SyntaxKind.SatisfiesExpression:
        return this.expr((node as ts.SatisfiesExpression).expression);
      case ts.SyntaxKind.AsExpression:
      case ts.SyntaxKind.TypeAssertionExpression:
        return this.error(node, "thx/no-as", "Type assertions (`as`, `<T>value`) are not in the language: they switch the type check off.", "Give the value its real type, or narrow it with a check such as `typeof x === \"string\"`.");
      case ts.SyntaxKind.NonNullExpression:
        return this.error(node, "thx/no-non-null", "The non-null `!` is not in the language: it switches the type check off.", "Check the value first: `if (x !== undefined) { ... }`, or use `?.` and `??`.");
      case ts.SyntaxKind.PropertyAccessExpression: {
        const p = node as ts.PropertyAccessExpression;
        if (ts.isPrivateIdentifier(p.name)) return this.notInLanguage(p.name);
        if (p.expression.kind === ts.SyntaxKind.SuperKeyword) return this.notInLanguage(p.expression);
        this.checkIdentifierText(p.name);
        const key = this.keyLiteral(p.name, p.name.text);
        const code = `rt.g(${this.expr(p.expression)}, ${key}${p.questionDotToken ? ", 1" : ""})`;
        return this.optionalEnd(p, code);
      }
      case ts.SyntaxKind.ElementAccessExpression: {
        const e = node as ts.ElementAccessExpression;
        const key = this.computedKey(e.argumentExpression);
        const code = `rt.g(${this.expr(e.expression)}, ${key}${e.questionDotToken ? ", 1" : ""})`;
        return this.optionalEnd(e, code);
      }
      case ts.SyntaxKind.CallExpression:
        return this.call(node as ts.CallExpression);
      case ts.SyntaxKind.NewExpression: {
        const n = node as ts.NewExpression;
        if (!ts.isIdentifier(n.expression) || !CONSTRUCTIBLE.has(n.expression.text))
          return this.error(n, "thx/no-new", "`new` works only on `Date`, `Map`, `Set` and `Error`.", "Call a function that returns the value instead.");
        const ctor = this.ref(n.expression);
        return `rt.nw(${ctor}, ${this.args(n.arguments ?? [])})`;
      }
      case ts.SyntaxKind.ArrayLiteralExpression: {
        const a = node as ts.ArrayLiteralExpression;
        const items = a.elements.map((el) => {
          if (ts.isOmittedExpression(el)) return this.error(el, "thx/not-in-language", "Holes in a list are not in the language.", "Write `undefined` in the gap.");
          if (ts.isSpreadElement(el)) return `rt.sp(${this.expr(el.expression)})`;
          return this.expr(el);
        });
        return `rt.a(${items.join(", ")})`;
      }
      case ts.SyntaxKind.ObjectLiteralExpression:
        return this.objectLiteral(node as ts.ObjectLiteralExpression);
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.FunctionExpression: {
        const f = node as ts.FunctionExpression;
        const name = f.name ? this.declName(f.name) : "";
        return `rt.fn(${this.fn(f, name)})`;
      }
      case ts.SyntaxKind.PrefixUnaryExpression:
        return this.prefix(node as ts.PrefixUnaryExpression);
      case ts.SyntaxKind.PostfixUnaryExpression: {
        const u = node as ts.PostfixUnaryExpression;
        const op = u.operator === ts.SyntaxKind.PlusPlusToken ? "++" : "--";
        return this.update(u.operand, op, false);
      }
      case ts.SyntaxKind.TypeOfExpression:
        return `(typeof ${this.expr((node as ts.TypeOfExpression).expression)})`;
      case ts.SyntaxKind.BinaryExpression:
        return this.binary(node as ts.BinaryExpression);
      case ts.SyntaxKind.ConditionalExpression: {
        const c = node as ts.ConditionalExpression;
        return `(${this.expr(c.condition)} ? ${this.expr(c.whenTrue)} : ${this.expr(c.whenFalse)})`;
      }
      case ts.SyntaxKind.AwaitExpression: {
        const ctx = this.fnStack[this.fnStack.length - 1];
        if (!ctx?.asyncCtx) return this.error(node, "thx/not-in-language", "`await` works only inside an `async` function.");
        return `rt.back(${ctx.asyncCtx}, await rt.aw(${this.expr((node as ts.AwaitExpression).expression)}))`;
      }
      case ts.SyntaxKind.JsxElement:
      case ts.SyntaxKind.JsxSelfClosingElement:
        return this.jsxElement(node as ts.JsxElement | ts.JsxSelfClosingElement);
      case ts.SyntaxKind.JsxFragment:
        return `rt.frag(${this.jsxChildren((node as ts.JsxFragment).children)})`;
      default:
        return this.notInLanguage(node);
    }
  }

  private computedKey(arg: ts.Expression): string {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return this.keyLiteral(arg, arg.text);
    return this.expr(arg);
  }

  private call(c: ts.CallExpression): string {
    const callee = c.expression;
    if (callee.kind === ts.SyntaxKind.ImportKeyword)
      return this.error(c, "thx/no-dynamic-import", "`import()` is not in the language: the build must see every import (L2).", 'Import at the top of the file: `import { name } from "module"`.');
    if (callee.kind === ts.SyntaxKind.SuperKeyword) return this.notInLanguage(callee);
    const imp = this.importOf(callee);
    if (imp?.spec === "thixo/plugin" && imp.imported === "definePlugin")
      return this.error(c, "thx/define-plugin", "`definePlugin` is called once, as `plugin.thx`'s default export.");
    if (ts.isPropertyAccessExpression(callee) && !ts.isPrivateIdentifier(callee.name)) {
      this.checkIdentifierText(callee.name);
      const flags = (callee.questionDotToken ? 1 : 0) | (c.questionDotToken ? 2 : 0);
      const code = `rt.m(${this.expr(callee.expression)}, ${this.keyLiteral(callee.name, callee.name.text)}, ${this.args(c.arguments)}${flags ? `, ${flags}` : ""})`;
      return this.optionalEnd(c, code);
    }
    if (ts.isElementAccessExpression(callee)) {
      const flags = (callee.questionDotToken ? 1 : 0) | (c.questionDotToken ? 2 : 0);
      const code = `rt.m(${this.expr(callee.expression)}, ${this.computedKey(callee.argumentExpression)}, ${this.args(c.arguments)}${flags ? `, ${flags}` : ""})`;
      return this.optionalEnd(c, code);
    }
    const code = `rt.c(${this.expr(callee)}, ${this.args(c.arguments)}${c.questionDotToken ? ", 1" : ""})`;
    return this.optionalEnd(c, code);
  }

  private objectLiteral(o: ts.ObjectLiteralExpression): string {
    const parts: string[] = [];
    for (const prop of o.properties) {
      if (ts.isSpreadAssignment(prop)) {
        parts.push(`rt.sp(${this.expr(prop.expression)})`);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        if (prop.objectAssignmentInitializer) {
          this.error(prop, "thx/not-in-language", "`{ a = 1 }` is not in the language here.");
          continue;
        }
        const sym = this.p.checker.getShorthandAssignmentValueSymbol(prop);
        parts.push(this.keyLiteral(prop.name, prop.name.text), this.ref(prop.name, sym));
        continue;
      }
      if (ts.isPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
        let key: string;
        if (ts.isComputedPropertyName(prop.name)) key = this.computedKey(prop.name.expression);
        else {
          const k = this.staticKey(prop.name);
          if (k === undefined) {
            this.error(prop.name, "thx/not-in-language", "This key is not in the language.");
            continue;
          }
          key = this.keyLiteral(prop.name, k);
        }
        if (ts.isPropertyAssignment(prop)) parts.push(key, this.expr(prop.initializer));
        else {
          if (prop.questionToken) this.error(prop, "thx/not-in-language", "Optional methods are not in the language.");
          parts.push(key, `rt.fn(${this.fn(prop)})`);
        }
        continue;
      }
      this.notInLanguage(prop);
    }
    return `rt.r(${parts.join(", ")})`;
  }

  private prefix(u: ts.PrefixUnaryExpression): string {
    switch (u.operator) {
      case ts.SyntaxKind.PlusPlusToken:
        return this.update(u.operand, "++", true);
      case ts.SyntaxKind.MinusMinusToken:
        return this.update(u.operand, "--", true);
      case ts.SyntaxKind.ExclamationToken:
        return `(!${this.expr(u.operand)})`;
      case ts.SyntaxKind.MinusToken:
        return `(-${this.expr(u.operand)})`;
      case ts.SyntaxKind.PlusToken:
        return `(+${this.expr(u.operand)})`;
      case ts.SyntaxKind.TildeToken:
        return `(~${this.expr(u.operand)})`;
    }
    return this.notInLanguage(u);
  }

  private update(target: ts.Expression, op: "++" | "--", prefix: boolean): string {
    if (ts.isIdentifier(target)) {
      const name = this.ref(target);
      return prefix ? `(${op}${name})` : `(${name}${op})`;
    }
    const member = this.memberTarget(target);
    if (!member) return this.error(target, "thx/not-in-language", `\`${op}\` works on a name or a field.`);
    return `rt.s(${member.obj}, ${member.key}, 1, ${JSON.stringify(prefix ? `${op}x` : `x${op}`)})`;
  }

  private memberTarget(target: ts.Expression): { obj: string; key: string } | undefined {
    if (ts.isParenthesizedExpression(target)) return this.memberTarget(target.expression);
    if (ts.isPropertyAccessExpression(target) && !ts.isPrivateIdentifier(target.name)) {
      if (target.questionDotToken || ts.isOptionalChain(target)) return undefined;
      this.checkIdentifierText(target.name);
      return { obj: this.expr(target.expression), key: this.keyLiteral(target.name, target.name.text) };
    }
    if (ts.isElementAccessExpression(target)) {
      if (target.questionDotToken || ts.isOptionalChain(target)) return undefined;
      return { obj: this.expr(target.expression), key: this.computedKey(target.argumentExpression) };
    }
    return undefined;
  }

  private binary(b: ts.BinaryExpression): string {
    const kind = b.operatorToken.kind;
    const op = BINARY_OPS.get(kind);
    if (op) return `(${this.expr(b.left)} ${op} ${this.expr(b.right)})`;
    const assign = ASSIGN_OPS.get(kind);
    if (assign) {
      if (ts.isIdentifier(b.left)) return `(${this.ref(b.left)} ${assign} ${this.expr(b.right)})`;
      if (ts.isObjectLiteralExpression(b.left) || ts.isArrayLiteralExpression(b.left))
        return this.error(b.left, "thx/not-in-language", "Destructuring assignment is not in the language.", "Declare new names: `const { a, b } = value`.");
      const member = this.memberTarget(b.left);
      if (!member) return this.error(b.left, "thx/not-in-language", "You can assign to a name or a field, nothing else.");
      if (assign === "&&=" || assign === "||=" || assign === "??=")
        return this.error(b, "thx/not-in-language", `\`${assign}\` on a field is not in the language.`, `Write \`obj.field = obj.field ${assign.slice(0, 2)} value\`.`);
      return `rt.s(${member.obj}, ${member.key}, ${this.expr(b.right)}${assign === "=" ? "" : `, ${JSON.stringify(assign)}`})`;
    }
    const banned: Partial<Record<ts.SyntaxKind, [string, string]>> = {
      [ts.SyntaxKind.EqualsEqualsToken]: ["`==` is not in the language.", "Use `===`."],
      [ts.SyntaxKind.ExclamationEqualsToken]: ["`!=` is not in the language.", "Use `!==`."],
      [ts.SyntaxKind.InKeyword]: ["`in` is not in the language.", "Read the field and compare it with `undefined`."],
      [ts.SyntaxKind.InstanceOfKeyword]: ["`instanceof` is not in the language.", "Use `typeof`, `Array.isArray`, or a field that says what the value is."],
      [ts.SyntaxKind.CommaToken]: ["The comma operator is not in the language.", "Write each expression as its own statement."],
    };
    const ban = banned[kind];
    return this.error(b.operatorToken, "thx/operator", ban?.[0] ?? `\`${b.operatorToken.getText(this.sf)}\` is not in the language.`, ban?.[1]);
  }

  // ---- JSX ----

  private jsxElement(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tagName = opening.tagName;
    let tag: string | undefined;
    let tagCode: string;
    if (ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text)) {
      tag = tagName.text;
      if (!isElementAllowed(tag)) {
        const why: Record<string, string> = {
          script: "it runs code (L6)",
          iframe: "it brings in another runnable source (L6)",
          object: "it brings in another runnable source (L6)",
          embed: "it brings in another runnable source (L6)",
          link: "it loads or redirects what the page does",
          meta: "it loads or redirects what the page does",
          base: "it loads or redirects what the page does",
          style: "styles are written with `css({...})` or the `style` prop",
          foreignObject: "it embeds HTML inside SVG",
          use: "it loads another document",
        };
        this.error(tagName, "thx/element", `\`<${tag}>\` is not an element a plugin can create${why[tag] ? `: ${why[tag]}` : ""}.`, "Use an allowed HTML or SVG element, or a component from `thixo/ui`.");
      }
      tagCode = JSON.stringify(tag);
    } else if (ts.isIdentifier(tagName)) tagCode = this.ref(tagName);
    else return this.error(tagName, "thx/element", "A tag is a plain element name or a component's name.");
    const props: string[] = [];
    for (const attr of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        props.push(`rt.sp(${this.expr(attr.expression)})`);
        continue;
      }
      if (!ts.isIdentifier(attr.name)) {
        this.error(attr.name, "thx/attribute", "Namespaced attributes such as `xlink:href` are not in the language.");
        continue;
      }
      const name = attr.name.text;
      if (tag !== undefined) {
        const kind = attrKind(tag, name);
        if (!kind) {
          this.badAttribute(attr, tag, name);
          continue;
        }
        props.push(JSON.stringify(name), this.attrValue(attr, tag, name, kind));
      } else props.push(JSON.stringify(name), this.attrValue(attr, undefined, name, undefined));
    }
    const children = ts.isJsxElement(node) ? this.jsxChildren(node.children) : "[]";
    return `rt.el(${tagCode}, [${props.join(", ")}], ${children})`;
  }

  private badAttribute(attr: ts.JsxAttribute, tag: string, name: string): void {
    const special: Record<string, [string, string]> = {
      ref: ["Refs are not in the language: a plugin never holds an element.", "Keep what you need in `useState`, and read values from event handlers."],
      dangerouslySetInnerHTML: ["Raw HTML is not in the language (L6).", "Build the content with JSX."],
      srcDoc: ["`srcDoc` is not in the language (L6).", "Build the content with JSX."],
      srcdoc: ["`srcdoc` is not in the language (L6).", "Build the content with JSX."],
      id: ["`id` is not allowed: ids collide with the app's own.", "Nest the element inside the one it belongs to, or use `aria-*` attributes."],
      htmlFor: ["`htmlFor` is not allowed: ids collide with the app's own.", "Put the input inside the `<label>`."],
      target: ["`target` is set by the language: every link opens in a new tab.", "Remove it."],
      rel: ["`rel` is set by the language.", "Remove it."],
      action: ["`action` is not allowed: a form never submits anywhere.", "Handle `onSubmit` and call an endpoint."],
      formAction: ["`formAction` is not allowed: a form never submits anywhere.", "Handle `onSubmit` and call an endpoint."],
      xlinkHref: ["`xlinkHref` is not in the language.", "Draw the shape directly."],
      href: [`\`href\` is allowed only on \`<a>\`.`, "Wrap the content in `<a href=...>`."],
      src: [`\`src\` is allowed only on \`<img>\`.`, "Use `<img src=...>`."],
      popover: ["`popover` is not allowed: it draws outside the slot.", "Use a dialog or menu component from `thixo/ui`."],
      autoFocus: ["`autoFocus` is not allowed: a plugin can't take focus from the app.", "Remove it."],
    };
    if (special[name]) {
      this.error(attr, "thx/attribute", special[name][0], special[name][1]);
      return;
    }
    if (/^on[a-z]/.test(name)) {
      this.error(attr, "thx/attribute", `\`${name}\` is an attribute that takes code (L6). Event handlers are camelCase props given a function.`, `Write \`on${name.slice(2, 3).toUpperCase()}${name.slice(3)}={(e) => ...}\`.`);
      return;
    }
    this.error(attr, "thx/attribute", `\`${name}\` is not an attribute \`<${tag}>\` may have.`, "See the JSX types for the attributes each element takes.");
  }

  private attrValue(attr: ts.JsxAttribute, tag: string | undefined, name: string, kind: AttrKind | undefined): string {
    const init = attr.initializer;
    let literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined;
    let exprNode: ts.Expression | undefined;
    if (!init) return "true";
    if (ts.isStringLiteral(init)) literal = init;
    else if (ts.isJsxExpression(init)) {
      if (!init.expression) return this.error(init, "thx/attribute", `\`${name}\` needs a value.`);
      if (init.dotDotDotToken) return this.error(init, "thx/attribute", "Spread a record with `{...record}` on its own.");
      if (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) literal = init.expression;
      else exprNode = init.expression;
    } else return this.error(init, "thx/attribute", "An attribute's value is a string or an expression in braces.");
    if (kind === "link" || kind === "load") {
      if (literal) return this.addressLiteral(literal, kind, tag!, name);
      if (exprNode && (ts.isTemplateExpression(exprNode) || (ts.isBinaryExpression(exprNode) && exprNode.operatorToken.kind === ts.SyntaxKind.PlusToken)))
        return this.error(exprNode, "thx/address", "A plugin can't build an address (L7).", "Write the address out in the attribute, or pass along a `Url` the app handed you.");
    }
    if (kind === "event" && literal) return this.error(literal, "thx/attribute", `\`${name}\` takes a function, not code in a string (L6).`, `Write \`${name}={() => ...}\`.`);
    if (literal) return JSON.stringify(ts.isStringLiteral(init) ? decodeEntities(literal.text) : literal.text);
    return this.expr(exprNode!);
  }

  private addressLiteral(lit: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, kind: "link" | "load", tag: string, name: string): string {
    const text = lit.text;
    const check = checkAddress(text, kind, this.env.addressHosts);
    if (check !== true) return this.error(lit, "thx/address", `\`<${tag} ${name}="${text.length > 60 ? text.slice(0, 57) + "..." : text}">\`: ${check}`, kind === "load" ? `A loaded address is a \`data:\` address or on one of the app's address hosts (${this.env.addressHosts.join(", ") || "none"}).` : "A link is an http or https address written out in full.");
    if (!text.startsWith("data:")) this.facts.addresses.add(text);
    return `rt.addr(${JSON.stringify(text)}, ${JSON.stringify(kind)})`;
  }

  private jsxChildren(children: ts.NodeArray<ts.JsxChild>): string {
    const out: string[] = [];
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const text = cleanJsxText(child.text);
        if (text !== null) out.push(JSON.stringify(decodeEntities(text)));
      } else if (ts.isJsxExpression(child)) {
        if (child.dotDotDotToken) {
          this.error(child, "thx/not-in-language", "Spread children are not in the language.", "Put the list in braces: `{items}`.");
          continue;
        }
        if (child.expression) out.push(this.expr(child.expression));
      } else out.push(this.expr(child as ts.Expression));
    }
    return `[${out.join(", ")}]`;
  }
}

/** True when an address literal may stand where `kind` says, or the reason it may not. */
export function checkAddress(text: string, kind: "link" | "load", hosts: string[]): true | string {
  if (kind === "load" && /^data:/i.test(text)) {
    if (!/^data:(image\/(png|jpeg|gif|webp|avif|svg\+xml)|font\/(woff2?|ttf|otf))[;,]/i.test(text)) return "a `data:` address here must be an image or a font.";
    return true;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "this is not a full address. Write it with `https://`.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return `\`${url.protocol}\` addresses are not allowed.`;
  if (url.username || url.password) return "an address can't carry a user name or password.";
  if (kind === "load" && !hosts.map((h) => h.toLowerCase()).includes(url.hostname.toLowerCase()))
    return `\`${url.hostname}\` is not one of the hosts the app lets plugins load from.`;
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
