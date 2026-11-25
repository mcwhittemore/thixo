import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compile, envOf, LIB_THX_DTS, sourceHash, THIXO_DTS, verifyOutput } from "../src/index.js";
import type { SourceFiles } from "../src/contract.js";
import { testOptions } from "./fixtures/env.js";
import { all, compileOrThrow, fakeApp, text } from "./helpers/host.js";

const HEAD = `import { useState, css } from "thixo";\nimport { leak } from "@app/probe";\n`;
const wrapBody = (body: string, top = "") => `${HEAD}${top}\nexport default function X() {\n${body}\nreturn null;\n}\n`;

function errorsOf2(files: SourceFiles) {
  const r = compile(files);
  assert.equal(r.ok, false, "expected errors");
  return r.ok ? [] : r.errors;
}

function errorsOf(files: SourceFiles) {
  const r = compile(files, testOptions());
  assert.equal(r.ok, false, "expected errors");
  return r.ok ? [] : r.errors;
}

describe("keys", () => {
  test("a raw element in a list takes a key", () => {
    compileOrThrow({ "main.thx": wrapBody("return <ul>{[1, 2].map((n) => <li key={n}>{n}</li>)}</ul>;") });
  });
});

describe("bundling", () => {
  test("several files with relative imports become one module, and same names in two files don't collide", async () => {
    const files: SourceFiles = {
      "main.thx": `${HEAD}import { label } from "./lib/label";\nimport { helper } from "./helper.thx";\nfunction local() { return "main"; }\nexport default function X() { leak([label(2), helper(), local()]); return null; }\n`,
      "lib/label.thx": `import { helper } from "../helper";\nfunction local() { return "label"; }\nexport function label(n: number) { return \`\${helper()}-\${local()}-\${n}\`; }\n`,
      "helper.thx": `function local() { return "helper"; }\nexport function helper() { return local(); }\nexport const unused = 1;\n`,
    };
    const r = compileOrThrow(files);
    assert.equal(verifyOutput(r.code).ok, true);
    assert.equal((r.code.match(/export default/g) ?? []).length, 1);
    const app = await fakeApp(r.code);
    app.render();
    assert.deepEqual(app.leaked, [["helper-label-2", "helper", "main"]]);
  });
  test("a cycle between files is an error", () => {
    const errs = errorsOf({
      "main.thx": `${HEAD}import { a } from "./a";\nexport default function X() { return a(); }\n`,
      "a.thx": `import { b } from "./b";\nexport function a(): string { return b(); }\n`,
      "b.thx": `import { a } from "./a";\nexport function b(): string { return a(); }\n`,
    });
    assert.ok(errs.some((e) => e.code === "thixo/cycle"));
  });
  test("a missing file is an error that lists the program's files", () => {
    const errs = errorsOf({ "main.thx": `import { x } from "./nope";\n${wrapBody("")}` });
    const e = errs.find((x) => x.code === "thixo/missing-file")!;
    assert.match(e.hint!, /main\.thx/);
  });
  test("a missing file's hint says a program's files end in .thx, for an author who wrote data.ts", () => {
    const errs = errorsOf({ "main.thx": `import { x } from "./data";\n${wrapBody("")}` });
    const e = errs.find((x) => x.code === "thixo/missing-file")!;
    assert.match(e.hint!, /Every file of a program ends in \.thx, so `\.\/data` is read from data\.thx; a \.ts or \.tsx file is not part of it\./);
  });
});

describe("the entry", () => {
  test("a program needs main.thx with a default export", () => {
    assert.ok(errorsOf({ "lib.thx": "export const x = 1;\n" }).some((e) => e.code === "thixo/file"));
    assert.ok(errorsOf({ "main.thx": "export const x = 1;\n" }).some((e) => e.code === "thixo/entry"));
    assert.ok(errorsOf({ "../main.thx": "" }).some((e) => e.code === "thixo/file"));
  });
  test("the default export is a component function", () => {
    assert.ok(errorsOf({ "main.thx": "export default 1;\n" }).some((e) => e.code === "thixo/entry"));
    assert.ok(errorsOf({ "main.thx": 'export default "x";\n' }).some((e) => e.code === "thixo/entry"));
    compileOrThrow({ "main.thx": "export default function App() { return <div />; }\n" });
    compileOrThrow({ "main.thx": "function App() { return <div />; }\nexport default App;\n" });
    compileOrThrow({ "main.thx": "const App = () => <div />;\nexport default App;\n" });
  });
  test("only the entry has a default export", () => {
    const errs = errorsOf({ "main.thx": 'import { x } from "./lib";\nexport default function App() { return <p>{x}</p>; }\n', "lib.thx": "export const x = 1;\nexport default function Other() { return null; }\n" });
    assert.ok(errs.some((e) => e.code === "thixo/entry" && e.file === "lib.thx"));
  });
  test("another entry can be named", () => {
    const r = compile({ "app.thx": "export default function App() { return <div />; }\n" }, { entry: "app.thx" });
    assert.equal(r.ok, true);
  });
  test("a program with no host modules imports only thixo", async () => {
    const r = compile({ "main.thx": 'import { useState, css } from "thixo";\nexport default function App() { const [n] = useState(1); return <p className={css({ padding: 2 })}>{n}</p>; }\n' });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.imports, ["thixo"]);
    const e = errorsOf2({ "main.thx": 'import { leak } from "@app/probe";\nexport default function App() { return null; }\n' }).find((x) => x.code === "thixo/unknown-import")!;
    assert.match(e.hint!, /thixo/);
  });
  test("imports lists module specifiers, not own files", () => {
    const r = compileOrThrow({ "main.thx": `${HEAD}import { x } from "./lib";\nexport default function App() { leak(x); return null; }\n`, "lib.thx": "export const x = 1;\n" });
    assert.deepEqual(r.imports, ["@app/probe", "thixo"]);
  });
  test("a host can't replace the built-in thixo module", () => {
    assert.throws(() => envOf({ modules: { thixo: { dts: "export declare const x: number;" } } }), /built-in/);
  });
  test("the thixo module declares every hook", () => {
    for (const name of ["useState", "useMemo", "useEffect", "useFrame", "usePointer", "useSize", "useKeys", "css"]) assert.match(THIXO_DTS, new RegExp(`function ${name}\\b`), name);
  });
  test("sourceHash is stable across key order and changes with content", () => {
    assert.equal(sourceHash({ "a.thx": "1", "main.thx": "2" }), sourceHash({ "main.thx": "2", "a.thx": "1" }));
    assert.notEqual(sourceHash({ "main.thx": "2" }), sourceHash({ "main.thx": "3" }));
  });
});

describe("errors are written for the agent", () => {
  test("event handlers get plain data: the hint says what to write", () => {
    const errs = errorsOf({ "main.thx": `${HEAD}export default function X() { const [v, setV] = useState(""); return <input value={v} onChange={(e) => setV(e.target.value)} />; }\n` });
    const e = errs.find((x) => x.code === "thixo/type")!;
    assert.match(e.message, /target/);
    assert.match(e.hint!, /e\.value/);
  });
  test("react imports point at thixo", () => {
    const e = errorsOf({ "main.thx": `import { useState } from "react";\n${wrapBody("")}` }).find((x) => x.code === "thixo/unknown-import")!;
    assert.match(e.hint!, /from "thixo"/);
  });
  test("every error has a stable code, a position and a sentence", () => {
    const errs = errorsOf({ "main.thx": wrapBody("const a: any = window; class B {} const r = /x/; for (const k in {}) {}") });
    assert.ok(errs.length >= 4);
    for (const e of errs) {
      assert.match(e.code, /^thixo\/[a-z-]+$/);
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
    assert.ok(errorsOf({ "main.thx": wrapBody(`const u: Url = "https://x.example";`) }).some((e) => e.code === "thixo/type"));
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
    const r = compileOrThrow({ "main.thx": wrapBody(body) });
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
    const src = `${HEAD}import { Stack } from "@app/ui";
function Row({ label, children }: { label: string; children?: ThxNode }) {
  return <li className={css({ padding: 4 })}><b>{label}</b>{children}</li>;
}
export default function X() {
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
}
`;
    const r = compileOrThrow({ "main.thx": src });
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
