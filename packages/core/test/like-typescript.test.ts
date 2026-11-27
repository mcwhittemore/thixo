// thixo reads as TypeScript. Each program here goes through thixo's type check and through TypeScript itself, with the
// same lib and host modules, and the two must agree on whether it has a type error.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compile } from "../src/index.js";
import { getLib } from "../src/compiler/program.js";
import { forEachChild, type Node } from "../src/compiler/syntax/ast.js";
import { testModules, testOptions } from "./fixtures/env.js";
import { tsDiagnostics, tsLibDiagnostics } from "./helpers/tsc.js";
import { ACCEPTED, HEAD } from "./fixtures/programs.js";

/** Programs TypeScript and thixo both refuse for a type error. */
const REFUSED: Record<string, string> = {
  "a string where a number goes": `const n: number = "1";`,
  "an argument of the wrong type": `function f(x: number) { return x; } f("1");`,
  "too few arguments": `function f(a: number, b: number) { return a + b; } f(1);`,
  "too many arguments": `function f(a: number) { return a; } f(1, 2);`,
  "a field that doesn't exist": `const o = { a: 1 }; const b = o.b;`,
  "a field of something possibly undefined": `function f(x?: { a: number }) { return x.a; }`,
  "calling something possibly undefined": `function f(cb?: () => void) { cb(); }`,
  "a parameter with no type": `function f(x) { return x; }`,
  "assigning to a constant": `const a = 1; a = 2;`,
  "a let assigned a value of the wrong type": `let n = 1; n = "two";`,
  "assigning to a read-only field": `const t: { readonly n: number } = { n: 1 }; t.n = 2;`,
  "a missing field": `interface P { a: number; b: string } const p: P = { a: 1 };`,
  "an extra field in an object literal": `const p: { a: number } = { a: 1, b: 2 };`,
  "returning the wrong type": `function f(): string { return 1; }`,
  "not returning on every path": `function f(x: boolean): string { if (x) return "a"; }`,
  "a string is not a Url": `const u: Url = "https://example.com";`,
  "the event has no target": `const el = <input onChange={(e) => toast(e.target)} />;`,
  "an unknown value used without a check": `const v: unknown = JSON.parse("1"); const n = v.length;`,
  "arithmetic on a string": `const x = "a" * 2;`,
  "comparing a number with undefined": `function f(x: number | undefined) { return x > 1; }`,
  "a wrong prop on a component": `function C(p: { a: number }) { return <p>{p.a}</p>; } const el = <C a="1" />;`,
  "a missing prop on a component": `function C(p: { a: number }) { return <p>{p.a}</p>; } const el = <C />;`,
  "an unknown prop on a component": `function C(p: { a: number }) { return <p>{p.a}</p>; } const el = <C a={1} b={2} />;`,
  "a host component prop of the wrong type": `const el = <Button disabled="yes" />;`,
  "a wrong attribute value on an element": `const el = <input checked="yes" />;`,
  "a value from a host function used as the wrong type": `async function f() { const t = await getTodo({ id: "1" }); const n: number = t.title; }`,
  "an unknown name": `const x = missingThing + 1;`,
  "a type that doesn't exist": `const x: Missing = 1;`,
  "a generic call that can't be satisfied": `function same<T>(a: T, b: T) { return a; } same(1, "a");`,
  "a non-exhaustive return through a union": `type S = "a" | "b"; function f(s: S): number { if (s === "a") return 1; }`,
  "indexing a record by a number type key": `const o = { a: 1 }; const k: string = "a"; const v = o[k];`,
  "a tuple read past its end": `const t: [number, number] = [1, 2]; const z = t[2];`,
  "a type used as a value": `interface I { a: number } const x = I;`,
  "setting state to the wrong type": `const [n, setN] = useState(0); setN("a");`,
  "a missing hook argument": `useFrame();`,
  "a css value of the wrong type": `const c = css({ padding: true });`,
  "a Math function that doesn't exist": `const n = Math.florr(1.5);`,
  "a filter that doesn't narrow": `const xs = [1, undefined].filter((x) => x !== 1); const s = xs.map((x) => x.toFixed());`,
  "a Math function given a string": `const n = Math.floor("1.5");`,
  "an Error made from a number": `const e = new Error(1);`,
  "a field read on a union without narrowing": `type R = { ok: true; value: number } | { ok: false; error: string }; function f(r: R) { return r.value; }`,
  "a wrong item pushed into typed state": `const [xs, setXs] = useState<number[]>([]); setXs([...xs, "a"]);`,
  "a callback with the wrong parameter type": `const f: (n: number) => void = (s: string) => {};`,
  "a component returning something that isn't JSX": `function C() { return { a: 1 }; } const el = <C />;`,
  "an object where a string goes in JSX": `const o = { a: 1 }; const el = <p>{o}</p>;`,
  "a missing case in a switch over never": `type T = "a" | "b"; function f(t: T) { switch (t) { case "a": return 1; default: { const n: never = t; return n; } } }`,
  "awaiting gives the wrong type": `async function f() { const xs = await listTodos(); const n: string = xs.length; }`,
  "a method that doesn't exist on a list": `const xs = [1, 2]; xs.sum();`,
  "possibly undefined after find": `const xs = [{ a: 1 }]; const v = xs.find((x) => x.a === 1).a;`,
};

/** A refused case's body runs inside the component, so the only thing wrong with it is the type error. */
function inMain(body: string): string {
  return `${HEAD}export default function Main() {\n${body}\nreturn null;\n}\n`;
}

/** thixo refuses `src` on a line TypeScript also has an error on. */
function refusesWhereTypeScriptDoes(src: string, tsErrors: string[]): { yes: boolean; errors: string[] } {
  const r = compile({ "main.thx": src }, testOptions());
  if (r.ok) return { yes: false, errors: [] };
  const lines = new Set(tsErrors.map((e) => Number(e.split(":")[0])));
  return { yes: r.errors.some((e) => lines.has(e.line)), errors: r.errors.map((e) => `${e.line}:${e.column} ${e.code} ${e.message}`) };
}

const modules = Object.fromEntries(Object.entries(testModules()).map(([k, v]) => [k, v.dts]));

describe("thixo's type check agrees with TypeScript's", () => {
  const accepted = Object.entries(ACCEPTED).map(([name, body]) => ({ name, src: HEAD + body }));
  const refused = Object.entries(REFUSED).map(([name, body]) => ({ name, src: inMain(body) }));
  const ts = tsDiagnostics([...accepted, ...refused].map((c) => c.src), modules);

  accepted.forEach((c, i) => {
    test(`both accept: ${c.name}`, () => {
      assert.deepEqual(ts[i], [], `TypeScript refuses it, so it doesn't belong here:\n${ts[i].join("\n")}`);
      const r = compile({ "main.thx": c.src }, testOptions());
      assert.ok(r.ok, `thixo refuses it:\n${r.ok ? "" : r.errors.map((e) => `${e.line}:${e.column} ${e.code} ${e.message}`).join("\n")}`);
    });
  });

  refused.forEach((c, i) => {
    test(`both refuse: ${c.name}`, () => {
      assert.ok(ts[accepted.length + i].length > 0, "TypeScript accepts it, so it doesn't belong here");
      const mine = refusesWhereTypeScriptDoes(c.src, ts[accepted.length + i]);
      assert.ok(mine.yes, `thixo doesn't refuse it where TypeScript does. TypeScript says:\n${ts[accepted.length + i].join("\n")}\nthixo says:\n${mine.errors.join("\n")}`);
    });
  });
});

describe("the lib", () => {
  test("is valid TypeScript, with the host modules the tests use", () => {
    assert.deepEqual(tsLibDiagnostics(modules), []);
  });
  test("reads in thixo, and every type it names exists", () => {
    const missing: string[] = [];
    for (const bf of getLib().loadAll()) {
      const visit = (n: Node) => {
        if (n.kind === "TypeRef") {
          let name = n.name;
          while (name.kind === "QualifiedName") name = name.left;
          if (!bf.types.get(name)) missing.push(`${bf.file.path}: ${name.name}`);
        }
        forEachChild(n, visit);
      };
      visit(bf.file);
    }
    assert.deepEqual(missing, []);
  });
});
