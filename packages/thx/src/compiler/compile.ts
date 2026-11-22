import ts from "typescript";
import type { CompileEnv, CompileResult, DataSchema, FieldDecl, Manifest, SourceFiles, ThxError } from "../contract.js";
import { verifyOutput } from "../verify/verify-output.js";
import { Emitter } from "./emit.js";
import { schemaHash, sourceHash } from "./hash.js";
import { createPluginProgram, resolveRelative, type PluginProgram } from "./program.js";

const TYPE_HINTS: [RegExp, string][] = [
  [/Property '(target|currentTarget|preventDefault|stopPropagation|nativeEvent)' does not exist on type 'ThxEvent'/, "A handler gets plain data, not the event: read `e.value`, `e.checked`, `e.key`, `e.x` or `e.y`."],
  [/is not assignable to type 'Url'/, "A plugin can't build an address (L7). Pass along a `Url` the app handed you, or write the address out in the attribute."],
  [/Property '\w+' does not exist on type '(string|number|boolean|.*\[\])'/, "Built-in values have only the language's methods. See the lib for the list."],
  [/Cannot find module/, "A plugin imports only the modules the app provides."],
  [/Cannot find name/, "A plugin can name only what it imports, what it declares and the language's built-ins."],
  [/Property 'constructor' does not exist/, "`constructor` is not a field in the language."],
];

function sortErrors(errors: ThxError[]): ThxError[] {
  return errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column));
}

/** Files in an order where each comes after the files it imports, `plugin.thx` last when it can be. */
function fileOrder(p: PluginProgram, files: SourceFiles, errors: ThxError[]): string[] {
  const deps = new Map<string, { path: string; node: ts.Node }[]>();
  for (const [path, sf] of p.files) {
    const list: { path: string; node: ts.Node }[] = [];
    for (const s of sf.statements)
      if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
        const rel = resolveRelative(path, s.moduleSpecifier.text, files);
        if (rel !== undefined) list.push({ path: rel, node: s.moduleSpecifier });
      }
    deps.set(path, list);
  }
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (path: string, stack: string[]) => {
    if (state.get(path) === "done") return;
    if (state.get(path) === "visiting") return;
    state.set(path, "visiting");
    for (const d of deps.get(path) ?? []) {
      if (state.get(d.path) === "visiting") {
        const sf = d.node.getSourceFile();
        const pos = sf.getLineAndCharacterOfPosition(d.node.getStart(sf));
        errors.push({
          file: path,
          line: pos.line + 1,
          column: pos.character + 1,
          code: "thx/cycle",
          message: `Files import each other in a circle: ${[...stack, path, d.path].join(" -> ")}.`,
          hint: "Move what both need into a third file.",
        });
        continue;
      }
      visit(d.path, [...stack, path]);
    }
    state.set(path, "done");
    order.push(path);
  };
  const paths = [...p.files.keys()].sort();
  for (const path of paths) if (path !== "plugin.thx") visit(path, []);
  if (p.files.has("plugin.thx")) visit("plugin.thx", []);
  return order;
}

function typeErrors(p: PluginProgram): ThxError[] {
  const diags = [...p.program.getOptionsDiagnostics(), ...p.program.getGlobalDiagnostics(), ...p.program.getSemanticDiagnostics()];
  return diags.map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    let file = "(env)";
    let line = 0;
    let column = 0;
    let code = "thx/type";
    if (d.file) {
      const plugin = p.pluginPathOf(d.file);
      file = plugin ?? p.moduleOf(d.file) ?? d.file.fileName;
      if (plugin === undefined) code = p.isLib(d.file) ? "thx/internal" : "thx/env-type";
      if (d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        line = pos.line + 1;
        column = pos.character + 1;
      }
    }
    const hint = TYPE_HINTS.find(([re]) => re.test(message))?.[1];
    return { file, line, column, code, message, ...(hint ? { hint } : {}) };
  });
}

function buildManifest(e: Emitter, env: CompileEnv, errors: ThxError[]): Manifest {
  const f = e.facts;
  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
  const required = sorted(f.imports.filter((i) => i.spec === "@app/sdk" && Object.prototype.hasOwnProperty.call(env.endpoints, i.name)).map((i) => i.name));
  const optional = sorted(
    f.imports
      .filter((i) => i.spec === "@app/sdk/optional" && Object.prototype.hasOwnProperty.call(env.endpoints, i.name))
      .map((i) => i.name)
      .filter((n) => !required.includes(n)),
  );
  for (const i of f.imports)
    if (i.spec === "@app/sdk/optional" && !Object.prototype.hasOwnProperty.call(env.endpoints, i.name)) e.error(i.node, "thx/import", `\`${i.name}\` is not an endpoint, so it can't be imported as optional.`, `Import it from "@app/sdk".`);
  const stores: Record<string, FieldDecl[]> = {};
  for (const s of f.stores) {
    if (Object.prototype.hasOwnProperty.call(stores, s.name)) {
      e.error(s.node, "thx/data-literal", `The store \`${s.name}\` is declared twice.`, "Declare each store once and import it where it is used.");
      continue;
    }
    stores[s.name] = s.fields;
  }
  const annotations: Record<string, FieldDecl[]> = {};
  for (const a of f.annotations) {
    const existing = annotations[a.record] ?? [];
    for (const field of a.fields) {
      if (existing.some((x) => x.name === field.name)) e.error(a.node, "thx/data-literal", `The field \`${field.name}\` on \`${a.record}\` is declared twice.`);
      else existing.push(field);
    }
    annotations[a.record] = existing.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  }
  const data: DataSchema = {
    stores: Object.fromEntries(Object.keys(stores).sort().map((k) => [k, stores[k]])),
    annotations: Object.fromEntries(Object.keys(annotations).sort().map((k) => [k, annotations[k]])),
  };
  void errors;
  return {
    slot: f.slot ?? "",
    requiredEndpoints: required,
    optionalEndpoints: optional,
    annotates: Object.keys(data.annotations),
    data,
    schemaHash: schemaHash(data),
    shellServices: sorted(f.imports.filter((i) => i.spec === "thixo/services" && env.services.includes(i.name)).map((i) => i.name)),
    addresses: sorted(f.addresses),
    libraries: sorted(f.imports.filter((i) => env.libraries.includes(i.spec)).map((i) => i.spec)),
  };
}

export function compile(files: SourceFiles, env: CompileEnv): CompileResult {
  const errors: ThxError[] = [];
  for (const path of Object.keys(files)) {
    if (!/^([a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.thx$/i.test(path))
      errors.push({ file: path, line: 0, column: 0, code: "thx/file", message: `\`${path}\` is not a plugin file name: a relative path ending in \`.thx\`.`, hint: "Name files like `plugin.thx` or `lib/dates.thx`." });
    if (typeof files[path] !== "string") errors.push({ file: path, line: 0, column: 0, code: "thx/file", message: `\`${path}\` has no text.` });
  }
  if (!Object.prototype.hasOwnProperty.call(files, "plugin.thx"))
    errors.push({ file: "plugin.thx", line: 0, column: 0, code: "thx/file", message: "A plugin needs a `plugin.thx`.", hint: "Its default export is `definePlugin(slot, { name, description }, Component)`." });
  if (errors.length) return { ok: false, errors };

  const p = createPluginProgram(files, env);
  for (const [path, sf] of p.files)
    for (const d of p.program.getSyntacticDiagnostics(sf)) {
      const pos = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      errors.push({ file: path, line: pos.line + 1, column: pos.character + 1, code: "thx/syntax", message: `This is not valid syntax: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`, hint: "In a .thx file `<T>value` is read as JSX. Write the value with its type on the declaration instead." });
    }
  if (errors.length) return { ok: false, errors: sortErrors(errors) };

  const order = fileOrder(p, files, errors);
  const emitter = new Emitter(p, env, order);
  const bodies = order.map((path) => `// ${path}\n${emitter.emitFile(path)}`);
  const registrations = order.flatMap((path) => emitter.topLevelFunctionNames(path)).map((n) => `rt.fn(${n});`);
  const manifest = buildManifest(emitter, env, errors);
  if (!emitter.facts.meta)
    emitter.errors.push({ file: "plugin.thx", line: 1, column: 1, code: "thx/define-plugin", message: "`plugin.thx` has no default export.", hint: 'export default definePlugin(slot, { name: "...", description: "..." }, function Component({ context, emit }) { ... })' });
  errors.push(...emitter.errors);

  const seen = new Set(errors.map((x) => `${x.file}:${x.line}:${x.column}`));
  const elementLines = new Set(errors.filter((x) => x.code === "thx/element").map((x) => `${x.file}:${x.line}`));
  for (const te of typeErrors(p)) {
    if (seen.has(`${te.file}:${te.line}:${te.column}`)) continue;
    if (/JSX\.IntrinsicElements/.test(te.message) && elementLines.has(`${te.file}:${te.line}`)) continue;
    errors.push(te);
  }
  if (errors.length) return { ok: false, errors: sortErrors(errors) };

  const code = `export default function (rt) {\n"use strict";\n${registrations.join("\n")}\n${bodies.join("\n")}\nreturn t0;\n}\n`;
  const verified = verifyOutput(code);
  if (!verified.ok)
    return {
      ok: false,
      errors: verified.errors.map((message) => ({ file: "plugin.thx", line: 0, column: 0, code: "thx/internal", message: `The compiler wrote code its own check refuses: ${message}. This is a bug in the compiler.` })),
    };
  return { ok: true, code, manifest, meta: emitter.facts.meta!, sourceHash: sourceHash(files) };
}
