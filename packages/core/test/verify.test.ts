import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compile, verifyOutput } from "../src/index.js";
import type { CompileOptions, SourceFiles } from "../src/contract.js";
import { WARM_UP_FILES, WARM_UP_OPTIONS } from "../src/compiler/warm-up.js";
import { readProgram, testOptions } from "./fixtures/env.js";
import { ACCEPTED, HEAD } from "./fixtures/programs.js";
import { verifyOutputWithTypeScript } from "./helpers/verify-output-ts.js";

const wrap = (body: string) => `export default function (rt) {\n"use strict";\n${body}\n}\n`;

const hostile: [string, string][] = [
  ["a global", wrap("return window;")],
  ["globalThis", wrap("return globalThis;")],
  ["a free name in a call", wrap("return rt.c(fetch, []);")],
  ["a field read off a local", wrap("const x = rt.r(); return x.constructor;")],
  ["a computed read", wrap('return rt["constructor"];')],
  ["an rt member that isn't on the list", wrap("return rt.constructor;")],
  ["rt.__proto__", wrap("return rt.__proto__;")],
  ["a chained read off rt", wrap("return rt.c.call;")],
  ["a direct call of a local", wrap("function f() {} return f();")],
  ["new", wrap("return new rt.Date();")],
  ["this", wrap("return this;")],
  ["an object literal", wrap("return {};")],
  ["a template", wrap("return `${rt}`;")],
  ["a tagged template", wrap("return rt.str`x`;")],
  ["a regular expression", wrap("return /x/;")],
  ["the comma operator", wrap("return (0, rt.c)(1);")],
  ["delete", wrap("delete rt.c; return 1;")],
  ["in", wrap('return "c" in rt;')],
  ["arguments", wrap("function f() { return arguments; } return f;")],
  ["eval", wrap('return eval("1");')],
  ["a dynamic import", wrap('return import("x");')],
  ["a class", wrap("class A {} return A;")],
  ["var", wrap("var x = 1; return x;")],
  ["a name declared in another scope", wrap("function f(window) { return 1; } return window;")],
  ["redeclaring rt", wrap("const rt2 = 1; { const rt = window; } return rt2;")],
  ["assigning rt", wrap("rt = 1; return 1;")],
  ["assigning a field", wrap("const o = rt.r(); o.x = 1; return o;")],
  ["an optional call", wrap("return rt.c?.(1);")],
  ["a spread argument", wrap("const a = []; return rt.c(...a);")],
  ["a destructuring declaration", wrap("const { c } = rt; return c;")],
  ["an await outside the wrapper", wrap("async function f() { await 1; } return 1;")],
  ["a second statement at the top", `${wrap("return 1;")}\nconsole.log(1);`],
  ["a named default function", 'export default function x(rt) { "use strict"; return 1; }'],
  ["two parameters", 'export default function (rt, w) { "use strict"; return w; }'],
  ["no use strict", "export default function (rt) { return 1; }"],
  ["with", wrap("with (rt) { return c; }")],
  ["a label", wrap("a: for (;;) { break a; } return 1;")],
  ["a getter", wrap("const o = { get x() { return 1; } }; return o;")],
  ["void of something", wrap("return void rt.c(1);")],
  ["a syntax error", wrap("return (;")],
];

for (const [name, code] of hostile)
  test(`verifyOutput refuses ${name}`, () => {
    const r = verifyOutput(code);
    assert.equal(r.ok, false, code);
    if (!r.ok) assert.ok(r.errors.length > 0);
  });

test("verifyOutput accepts the shapes the compiler writes", () => {
  const code = wrap(`rt.fn(u0_f);
function u0_f(l_a, ...l_rest) {
rt.tick();
const t1 = rt.push();
try {
let l_b = (l_a === void 0 ? 1 : l_a);
for (const l_x of rt.iter(l_rest)) { rt.tick(); l_b += l_x; }
for (let l_i = 0; l_i < 3; l_i++) { rt.tick(); }
while (l_b > 10) { rt.tick(); l_b = l_b - 1; }
switch (l_b) { case 1: break; default: }
try { rt.c(l_a, []); } catch (t2) { const l_e = rt.caught(t2); }
return rt.done((async () => { const t3 = rt.ctx(); return rt.back(t3, await rt.aw(l_b)); })());
} finally {
rt.pop(t1);
}
}
const t0 = rt.app(rt.fn(function l_X() { return (typeof l_X); }));
return t0;`);
  assert.deepEqual(verifyOutput(code), { ok: true });
});

// verifyOutput reads the output with the compiler's own parser. These read the same code with TypeScript's parser
// too, under the same rules, so that a misreading the two halves of the compiler share can't pass unseen.
describe("verifyOutput agrees with the same check read by TypeScript", () => {
  for (const [name, code] of hostile)
    test(`both refuse ${name}`, () => {
      assert.equal(verifyOutput(code).ok, false);
      assert.equal(verifyOutputWithTypeScript(code).ok, false);
    });

  const programs: [string, SourceFiles, CompileOptions][] = [
    ["the orbit fixture", readProgram("orbit"), {}],
    ["the todo-list fixture", readProgram("todo-list"), testOptions()],
    ["the warm-up program", WARM_UP_FILES, WARM_UP_OPTIONS],
    ...Object.entries(ACCEPTED).map(([name, body]): [string, SourceFiles, CompileOptions] => [name, { "main.thx": HEAD + body }, testOptions()]),
  ];
  for (const [name, files, options] of programs)
    test(`both accept what the compiler makes of ${name}`, () => {
      const r = compile(files, options);
      assert.ok(r.ok, r.ok ? "" : r.errors.map((e) => e.message).join("\n"));
      assert.deepEqual(verifyOutputWithTypeScript(r.code), { ok: true });
    });
});
