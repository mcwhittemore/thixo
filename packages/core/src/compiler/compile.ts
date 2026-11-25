import type { CompileEnv, CompileOptions, CompileResult, SourceFiles, ThixoError } from "../contract.js";
import { verifyOutput } from "../verify/verify-output.js";
import { checkProgram } from "./check/checker.js";
import { Emitter } from "./emit.js";
import { sourceHash } from "./hash.js";
import { THIXO_DTS } from "./thixo-dts.js";
import { createProgramFiles, resolveRelative, type ProgramFiles } from "./program.js";
import type * as A from "./syntax/ast.js";
import { lineCol } from "./syntax/ast.js";

const TYPE_HINTS: [RegExp, string][] = [
  [/Property '(target|currentTarget|preventDefault|stopPropagation|nativeEvent)' does not exist on type 'ThxEvent'/, "A handler gets plain data, not the event: read `e.value`, `e.checked`, `e.key`, `e.x` or `e.y`."],
  [/is not assignable to type 'Url'/, "A program can't build an address. Pass along a `Url` the host handed you, or write the address out in the attribute."],
  [/Property '\w+' does not exist on type '(string|number|boolean|.*\[\])'/, "Built-in values have only the language's methods. See the lib for the list."],
  [/Cannot find module/, 'A program imports only "thixo", the modules its host provides and its own files.'],
  [/Cannot find name/, "A program can name only what it imports, what it declares and the language's built-ins."],
  [/Property 'constructor' does not exist/, "`constructor` is not a field in the language."],
];

function sortErrors(errors: ThixoError[]): ThixoError[] {
  return errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column));
}

/** Files in an order where each comes after the files it imports, the entry last when it can be. */
function fileOrder(p: ProgramFiles, files: SourceFiles, entry: string, errors: ThixoError[]): string[] {
  const deps = new Map<string, { path: string; node: A.Str }[]>();
  for (const [path, sf] of p.files) {
    const list: { path: string; node: A.Str }[] = [];
    for (const s of sf.statements)
      if (s.kind === "Import") {
        const rel = resolveRelative(path, s.source.value, files);
        if (rel !== undefined) list.push({ path: rel, node: s.source });
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
        const pos = lineCol(p.files.get(path)!, d.node.start);
        errors.push({
          file: path,
          line: pos.line,
          column: pos.column,
          code: "thixo/cycle",
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
  for (const path of paths) if (path !== entry) visit(path, []);
  if (p.files.has(entry)) visit(entry, []);
  return order;
}

/** The type check's errors, each with the hint that matches its message. */
function typeErrors(p: ProgramFiles): ThixoError[] {
  const out: ThixoError[] = [];
  for (const m of p.modules.values()) if (m.error) out.push(m.error);
  for (const e of checkProgram(p)) {
    if (e.hint) out.push(e);
    else {
      const hint = TYPE_HINTS.find(([re]) => re.test(e.message))?.[1];
      out.push(hint ? { ...e, hint } : e);
    }
  }
  return out;
}

/** The modules every program may import: the built-in `thixo` and whatever the host adds. */
export function envOf(options: CompileOptions = {}): CompileEnv {
  const modules = { ...(options.modules ?? {}) };
  if (Object.prototype.hasOwnProperty.call(modules, "thixo")) throw new Error('A host can\'t replace the built-in "thixo" module.');
  return { modules: { thixo: { dts: THIXO_DTS }, ...modules } };
}

export function compile(files: SourceFiles, options: CompileOptions = {}): CompileResult {
  const entry = options.entry ?? "main.thx";
  const env = envOf(options);
  const errors: ThixoError[] = [];
  for (const path of Object.keys(files)) {
    if (!/^([a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.thx$/i.test(path))
      errors.push({ file: path, line: 0, column: 0, code: "thixo/file", message: `\`${path}\` is not a program file name: a relative path ending in \`.thx\`.`, hint: "Name files like `main.thx` or `lib/shapes.thx`." });
    if (typeof files[path] !== "string") errors.push({ file: path, line: 0, column: 0, code: "thixo/file", message: `\`${path}\` has no text.` });
  }
  if (!Object.prototype.hasOwnProperty.call(files, entry))
    errors.push({ file: entry, line: 0, column: 0, code: "thixo/file", message: `A program needs a \`${entry}\`.`, hint: "Its default export is the component: `export default function App() { ... }`." });
  if (errors.length) return { ok: false, errors };

  const parsed = createProgramFiles(files, env);
  if (parsed.errors.length) return { ok: false, errors: sortErrors(parsed.errors) };
  const p = parsed.program;

  const order = fileOrder(p, files, entry, errors);
  const emitter = new Emitter(p, entry, env, order);
  const bodies = order.map((path) => `// ${path}\n${emitter.emitFile(path)}`);
  const registrations = order.flatMap((path) => emitter.topLevelFunctionNames(path)).map((n) => `rt.fn(${n});`);
  if (!emitter.facts.entry)
    emitter.errors.push({ file: entry, line: 1, column: 1, code: "thixo/entry", message: `\`${entry}\` has no default export.`, hint: "export default function App() { return <div />; }" });
  errors.push(...emitter.errors);

  const seen = new Set(errors.map((x) => `${x.file}:${x.line}:${x.column}`));
  const elementLines = new Set(errors.filter((x) => x.code === "thixo/element").map((x) => `${x.file}:${x.line}`));
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
      errors: verified.errors.map((message) => ({ file: entry, line: 0, column: 0, code: "thixo/internal", message: `The compiler wrote code its own check refuses: ${message}. This is a bug in the compiler.` })),
    };
  const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
  return {
    ok: true,
    code,
    imports: sorted(emitter.facts.imports.filter((i) => !i.spec.startsWith(".")).map((i) => i.spec)),
    links: sorted(emitter.facts.links),
    sourceHash: sourceHash(files),
  };
}
