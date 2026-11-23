import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compile, LIB_THX_DTS, schemaHash, sourceHash, verifyOutput } from "../src/index.js";
import type { SourceFiles } from "../src/contract.js";
import { todoEnv } from "./fixtures/env.js";
import { all, compileOrThrow, fakeApp, text } from "./helpers/host.js";

const HEAD = `import { definePlugin, useState, css } from "thixo/plugin";\nimport { main } from "@app/slots";\nimport { leak } from "@app/probe";\n`;
const wrapBody = (body: string, top = "") => `${HEAD}${top}\nexport default definePlugin(main, { name: "x" }, function X() {\n${body}\nreturn null;\n});\n`;

function errorsOf(files: SourceFiles) {
  const r = compile(files, todoEnv());
  assert.equal(r.ok, false, "expected errors");
  return r.ok ? [] : r.errors;
}

describe("keys", () => {
  test("a raw element in a list takes a key", () => {
    compileOrThrow({ "plugin.thx": wrapBody("return <ul>{[1, 2].map((n) => <li key={n}>{n}</li>)}</ul>;") });
  });
});

describe("bundling", () => {
  test("several files with relative imports become one module, and same names in two files don't collide", async () => {
    const files: SourceFiles = {
      "plugin.thx": `${HEAD}import { label } from "./lib/label";\nimport { helper } from "./helper.thx";\nfunction local() { return "plugin"; }\nexport default definePlugin(main, { name: "x" }, function X() { leak([label(2), helper(), local()]); return null; });\n`,
      "lib/label.thx": `import { helper } from "../helper";\nfunction local() { return "label"; }\nexport function label(n: number) { return \`\${helper()}-\${local()}-\${n}\`; }\n`,
      "helper.thx": `function local() { return "helper"; }\nexport function helper() { return local(); }\nexport const unused = 1;\n`,
    };
    const r = compileOrThrow(files);
    assert.equal(verifyOutput(r.code).ok, true);
    assert.equal((r.code.match(/export default/g) ?? []).length, 1);
    const app = await fakeApp(r.code);
    app.render();
    assert.deepEqual(app.leaked, [["helper-label-2", "helper", "plugin"]]);
  });
  test("a cycle between files is an error", () => {
    const errs = errorsOf({
      "plugin.thx": `${HEAD}import { a } from "./a";\nexport default definePlugin(main, { name: "x" }, function X() { return a(); });\n`,
      "a.thx": `import { b } from "./b";\nexport function a(): string { return b(); }\n`,
      "b.thx": `import { a } from "./a";\nexport function b(): string { return a(); }\n`,
    });
    assert.ok(errs.some((e) => e.code === "thx/cycle"));
  });
  test("a missing file is an error that lists the plugin's files", () => {
    const errs = errorsOf({ "plugin.thx": `import { x } from "./nope";\n${wrapBody("")}` });
    const e = errs.find((x) => x.code === "thx/missing-file")!;
    assert.match(e.hint!, /plugin\.thx/);
  });
  test("a missing file's hint says a plugin's files end in .thx, for an author who wrote data.ts", () => {
    const errs = errorsOf({ "plugin.thx": `import { x } from "./data";\n${wrapBody("")}` });
    const e = errs.find((x) => x.code === "thx/missing-file")!;
    assert.match(e.hint!, /Every file of a plugin ends in \.thx, so `\.\/data` is read from data\.thx; a \.ts or \.tsx file is not part of the plugin\./);
  });
  test("a plugin needs plugin.thx with a default export", () => {
    assert.ok(errorsOf({ "data.thx": "export const x = 1;\n" }).some((e) => e.code === "thx/file"));
    assert.ok(errorsOf({ "plugin.thx": "export const x = 1;\n" }).some((e) => e.code === "thx/define-plugin"));
    assert.ok(errorsOf({ "../plugin.thx": "" }).some((e) => e.code === "thx/file"));
  });
});

describe("data declarations are read as literals (U7)", () => {
  const data = (decl: string) => ({
    "plugin.thx": wrapBody(""),
    "data.thx": `import { annotate, store } from "thixo/data";\nimport { t } from "thixo/schema";\nimport { Todo } from "@app/sdk";\n${decl}\n`,
  });
  test("every field type", () => {
    const files = data(`export const tags = annotate(Todo, { tags: t.array(t.string()), scores: t.array(t.number()), link: t.url(), ok: t.boolean(), note: t.string() });\nexport const s = store("settings", { fields: { at: t.date() } });`);
    files["plugin.thx"] = `import { tags, s } from "./data";\n${wrapBody("leak([tags, s]);")}`;
    const r = compileOrThrow(files);
    assert.deepEqual(r.manifest.data.annotations.todo, [
      { name: "link", type: "url" },
      { name: "note", type: "string" },
      { name: "ok", type: "boolean" },
      { name: "scores", type: "number[]" },
      { name: "tags", type: "string[]" },
    ]);
    assert.deepEqual(r.manifest.data.stores, { settings: [{ name: "at", type: "date" }] });
  });
  const bad: [string, string][] = [
    ["a field type that isn't allowed", `export const a = annotate(Todo, { x: t.object({}) });`],
    ["a computed field list", `const f = { x: t.string() };\nexport const a = annotate(Todo, f);`],
    ["a store name from a variable", `const n = "prefs";\nexport const s = store(n, { fields: {} });`],
    ["a declaration that isn't exported", `const a = annotate(Todo, { x: t.string() });`],
    ["t used outside a declaration", `export const f = t.string();`],
    ["annotate on something that isn't a record", `export const a = annotate(t, { x: t.string() });`],
    ["a field declared twice", `export const a = annotate(Todo, { x: t.string(), x: t.number() });`],
    ["the same store twice", `export const a = store("p", { fields: {} });\nexport const b = store("p", { fields: {} });`],
    ["a store with extra keys", `export const s = store("p", { fields: {}, shared: true });`],
  ];
  for (const [name, decl] of bad)
    test(name, () => {
      const errs = errorsOf(data(decl));
      assert.ok(errs.some((e) => e.code === "thx/data-literal"), errs.map((e) => `${e.code} ${e.message}`).join("\n"));
    });
  test("annotate inside a function", () => {
    const errs = errorsOf({ "plugin.thx": `import { annotate } from "thixo/data";\nimport { t } from "thixo/schema";\nimport { Todo } from "@app/sdk";\n${wrapBody("const a = annotate(Todo, { x: t.string() });")}` });
    assert.ok(errs.some((e) => e.code === "thx/data-literal"));
  });
  test("schemaHash is sha256 of canonical JSON and ignores key order", () => {
    const a = schemaHash({ stores: { b: [], a: [{ name: "x", type: "string" }] }, annotations: {} });
    const b = schemaHash({ annotations: {}, stores: { a: [{ type: "string", name: "x" }], b: [] } });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
  test("sourceHash is stable across key order and changes with content", () => {
    assert.equal(sourceHash({ "a.thx": "1", "plugin.thx": "2" }), sourceHash({ "plugin.thx": "2", "a.thx": "1" }));
    assert.notEqual(sourceHash({ "plugin.thx": "2" }), sourceHash({ "plugin.thx": "3" }));
  });
});

describe("the manifest", () => {
  test("services, libraries, optional and required, and metadata", () => {
    const src = `import { definePlugin } from "thixo/plugin";\nimport { todoRow } from "@app/slots";\nimport { toast } from "thixo/services";\nimport { mean } from "@app/charts";\nimport { listTodos } from "@app/sdk";\nimport { listTodos as maybe, listPeople } from "@app/sdk/optional";\nexport default definePlugin(todoRow, { id: "p-123", name: "Row", description: "d" }, function Row() { toast(String(mean([1]))); return null; });\n`;
    const r = compileOrThrow({ "plugin.thx": src });
    assert.equal(r.manifest.slot, "todo-row");
    assert.deepEqual(r.manifest.shellServices, ["toast"]);
    assert.deepEqual(r.manifest.libraries, ["@app/charts"]);
    assert.deepEqual(r.manifest.requiredEndpoints, ["listTodos"]);
    assert.deepEqual(r.manifest.optionalEndpoints, ["listPeople"]);
    assert.deepEqual(r.meta, { name: "Row", description: "d", id: "p-123" });
  });
  test("definePlugin's arguments are literal", () => {
    const meta = errorsOf({ "plugin.thx": `${HEAD}const name = "x";\nexport default definePlugin(main, { name }, function X() { return null; });\n` });
    assert.ok(meta.some((e) => e.code === "thx/define-plugin"));
    const slot = errorsOf({ "plugin.thx": `${HEAD}const s = main;\nexport default definePlugin(s, { name: "x" }, function X() { return null; });\n` });
    assert.ok(slot.some((e) => e.code === "thx/define-plugin"));
  });
});

describe("errors are written for the agent", () => {
  test("event handlers get plain data: the hint says what to write", () => {
    const errs = errorsOf({ "plugin.thx": `${HEAD}export default definePlugin(main, { name: "x" }, function X() { const [v, setV] = useState(""); return <input value={v} onChange={(e) => setV(e.target.value)} />; });\n` });
    const e = errs.find((x) => x.code === "thx/type")!;
    assert.match(e.message, /target/);
    assert.match(e.hint!, /e\.value/);
  });
  test("react imports point at thixo/plugin", () => {
    const e = errorsOf({ "plugin.thx": `import { useState } from "react";\n${wrapBody("")}` }).find((x) => x.code === "thx/unknown-import")!;
    assert.match(e.hint!, /thixo\/plugin/);
  });
  test("every error has a stable code, a position and a sentence", () => {
    const errs = errorsOf({ "plugin.thx": wrapBody("const a: any = window; class B {} const r = /x/; for (const k in {}) {}") });
    assert.ok(errs.length >= 4);
    for (const e of errs) {
      assert.match(e.code, /^thx\/[a-z-]+$/);
      assert.ok(e.line > 0 && e.column > 0);
      assert.match(e.message, /[.)]$/);
    }
  });
});

describe("the lib", () => {
  test("declares the globals host modules reference", () => {
    for (const s of ["interface Url", "type ThxNode", "type Component<P", "declare namespace JSX", "interface IntrinsicElements", "interface ThxStyle", "type ThxCss", "interface ThxEvent"])
      assert.ok(LIB_THX_DTS.includes(s), s);
  });
  test("lists only allowed elements", () => {
    const intrinsic = LIB_THX_DTS.slice(LIB_THX_DTS.indexOf("interface IntrinsicElements"));
    for (const tag of ["script", "iframe", "object", "embed", "link", "meta", "base", "style", "foreignObject", "use"]) assert.ok(!new RegExp(`\\n    ${tag}: \\{`).test(intrinsic), tag);
    for (const tag of ["div", "a", "img", "svg", "path", "button", "input"]) assert.ok(new RegExp(`\\n    ${tag}: \\{`).test(intrinsic), tag);
  });
  test("a string is not a Url", () => {
    assert.ok(errorsOf({ "plugin.thx": wrapBody(`const u: Url = "https://x.example";`) }).some((e) => e.code === "thx/type"));
  });
});

describe("the language runs as TypeScript reads", () => {
  test("a kitchen sink of everyday code", async () => {
    const body = `
const { a, b: renamed = 5, ...others } = { a: 1, c: 3, d: 4 };
const [first, , third = 30, ...tail] = [10, 20, undefined, 40, 50];
const merged = { ...others, e: 5 };
const list = [...tail, ...[60]];
const none = (): { b: { c: number } } | undefined => undefined;
const missing = none();
const deep = missing?.b.c;
let total = 0;
for (let i = 0; i < 4; i++) { if (i === 2) { continue; } total += i; }
let n = 0;
while (n < 3) { n++; }
do { n--; } while (n > 1);
const counts: Record<string, number> = {};
for (const w of "a b a".split(" ")) { counts[w] = (counts[w] ?? 0) + 1; }
counts.a++;
const m = new Map<string, number>([["x", 1]]);
m.set("y", 2);
const s = new Set([1, 2, 2, 3]);
const sorted = [3, 1, 2].toSorted((x, y) => x - y);
const own = [3, 1, 2];
own.sort((x, y) => y - x);
const sum = [1, 2, 3].reduce((acc, v) => acc + v, 0);
const json = JSON.parse(JSON.stringify({ k: [1, "two", null] }));
const d = new Date(Date.UTC(2026, 0, 2));
const label = (k: string): string => { switch (k) { case "a": return "A"; default: return "?"; } };
let caught = "";
try { throw new Error("bad"); } catch (e) { caught = String(e); } finally { n = 100; }
const fromLength = Array.from({ length: 3 }, (_, i) => i * 2);
const entries = Object.entries({ p: 1, q: 2 }).map(([k, v]) => k + v).join(",");
const fn = function named(x: number): number { return x <= 0 ? 0 : x + named(x - 1); };
const run = async () => { const v = await Promise.resolve(41); const all = await Promise.all([1, Promise.resolve(2)]); return v + all.length - 1; };
run().then((v) => leak(["async", v]));
leak([a, renamed, Object.keys(others), first, third, tail, merged.e, list, deep, total, n, counts, m.get("y"), m.size, s.size, [...s], sorted, own, sum, json, d.getUTCDate(), label("a"), label("z"), caught, fromLength, entries, fn(3), \`t\${1 + 1}\`, typeof fn, Math.max(1, 5), "Ab".toLowerCase(), (12.345).toFixed(1), [1, [2, 3]].flat(), "x".padStart(3, "-"), Number("7"), parseInt("08", 10), isNaN(0 / 0), [1, 2, 3].includes(2), m.has("x") && !m.has("z")]);
`;
    const r = compileOrThrow({ "plugin.thx": wrapBody(body) });
    const app = await fakeApp(r.code);
    app.render();
    await app.flush();
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.leaked[0], [
      1, 5, ["c", "d"], 10, 30, [40, 50], 5, [40, 50, 60], undefined, 4, 100, { a: 3, b: 1 }, 2, 2, 3, [1, 2, 3], [1, 2, 3], [3, 2, 1], 6,
      { k: [1, "two", null] }, 2, "A", "?", "Error: bad", [0, 2, 4], "p1,q2", 6, "t2", "function", 5, "ab", "12.3", [1, 2, 3], "--x", 7, 8, true, true, true,
    ]);
    assert.deepEqual(app.leaked[1], ["async", 42]);
  });
  test("components, children, keys, fragments and styles render", async () => {
    const src = `${HEAD}import { Stack } from "thixo/ui";
function Row({ label, children }: { label: string; children?: ThxNode }) {
  return <li className={css({ padding: 4 })}><b>{label}</b>{children}</li>;
}
export default definePlugin(main, { name: "x" }, function X() {
  const [count, setCount] = useState(0);
  const items = ["a", "b"];
  return (
    <Stack>
      <>
        <ul>{items.map((i) => <Row key={i} label={i}>!</Row>)}</ul>
        <button onClick={() => setCount(count + 1)} style={{ color: "red", padding: 2 }}>Clicked {count} times</button>
        <svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="currentColor" /></svg>
      </>
    </Stack>
  );
});
`;
    const r = compileOrThrow({ "plugin.thx": src });
    const app = await fakeApp(r.code);
    let tree = app.render();
    assert.equal(tree[0].type, "Stack");
    const lis = all(tree).filter((e) => e.type === "li");
    assert.equal(lis.length, 2);
    assert.match(String(lis[0].props.className), /^thx\d+-/);
    assert.equal(text(tree).replace(/\s+/g, " "), "a ! b ! Clicked 0 times");
    const button = all(tree).find((e) => e.type === "button")!;
    assert.deepEqual(button.props.style, { color: "red", padding: 2 });
    (button.props.onClick as (e: unknown) => void)({});
    tree = app.render();
    assert.match(text(tree).replace(/\s+/g, " "), /Clicked 1 times/);
    assert.equal(app.styles.size, 1);
  });
});
