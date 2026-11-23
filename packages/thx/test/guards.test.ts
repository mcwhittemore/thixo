// The runtime guards on their own, called the way a broken compiler might call them. They must hold even if the
// compiler or the type check let something through.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRuntime, guardNames } from "../src/runtime/index.js";
import { RT_NAMES } from "../src/verify/verify-output.js";
import type { RuntimeHost } from "../src/contract.js";

type Guard = Record<string, (...a: unknown[]) => unknown> & Record<string, unknown>;

function setup(budget?: number) {
  const errors: Error[] = [];
  const host: RuntimeHost = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
    Fragment: "Fragment",
    modules: {},
    budget,
    onError: (e) => errors.push(e),
  };
  const rt = createRuntime(host);
  const rawHost = function raw() {
    return globalThis;
  };
  host.modules = {
    "thixo/ui": { Stack: rt.hostComponent(function Stack() {}), raw: rawHost as unknown, plain: { a: 1 } },
  };
  let g!: Guard;
  rt.instantiate({
    default: (guard: unknown) => {
      g = guard as Guard;
      const r = g as unknown as { plugin: Function; r: Function; fn: Function };
      return r.plugin("main", r.r("name", "x"), r.fn(function () {
        return null;
      }));
    },
  });
  return { g, rt, errors, host };
}

describe("guards hold without the compiler", () => {
  const { g, rt } = setup();
  const fnv = g.fn(function () {
    return 1;
  });
  test("compiled code gets exactly the names verifyOutput allows", () => {
    assert.deepEqual([...guardNames()].sort(), [...RT_NAMES].sort());
  });
  test("the guard object can't be changed or walked", () => {
    assert.equal(Object.isFrozen(g), true);
    assert.equal(Object.getPrototypeOf(g), null);
  });
  test("a function has no fields", () => {
    for (const k of ["constructor", "prototype", "call", "apply", "bind", "caller", "name", "length", "toString"]) assert.throws(() => g.g(fnv, k), /no fields/);
  });
  test("an unregistered function can't be called", () => {
    for (const f of [Function, eval, setTimeout, Reflect.apply, Object.assign, globalThis.fetch]) assert.throws(() => g.c(f, ["globalThis.__pwned = 1"]), /not a function/);
    assert.equal((globalThis as Record<string, unknown>).__pwned, undefined);
  });
  test("strings, lists and numbers have only the language's methods", () => {
    for (const v of ["", [], 1, true]) {
      for (const k of ["constructor", "__proto__", "prototype", "__defineGetter__", "valueOf", "hasOwnProperty", "isPrototypeOf"]) assert.equal(g.g(v, k), undefined, `${typeof v}.${k}`);
      assert.throws(() => g.m(v, "constructor", []));
    }
  });
  test("a record reads own fields only", () => {
    const r = g.r("a", 1);
    for (const k of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) assert.equal(g.g(r, k), undefined);
    assert.equal(g.g(r, "a"), 1);
    assert.equal(Object.getPrototypeOf(r), null);
  });
  test("field names are strings or numbers, never objects or symbols", () => {
    const sneaky = {
      toString() {
        (globalThis as Record<string, unknown>).__pwned = 1;
        return "a";
      },
    };
    assert.throws(() => g.g(g.r("a", 1), sneaky), /field name/);
    assert.throws(() => g.g([], Symbol.iterator), /field name/);
    assert.throws(() => g.r(sneaky, 1), /field name/);
    assert.equal((globalThis as Record<string, unknown>).__pwned, undefined);
  });
  test("__proto__ can't be written or created", () => {
    assert.throws(() => g.s(g.r(), "__proto__", {}), /__proto__/);
    assert.throws(() => g.r("__proto__", {}), /__proto__/);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
  test("only plugin records and lists take writes", () => {
    assert.throws(() => g.s(Object.prototype, "polluted", 1), /no fields/);
    assert.throws(() => g.s(fnv, "x", 1));
    assert.throws(() => g.s(g.Math, "PI", 3));
    assert.throws(() => g.s([], "length", 0), /indexes/);
    assert.throws(() => g.s([], 5, 0), /indexes/);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });
  test("host objects that weren't converted are opaque", () => {
    for (const v of [{}, globalThis, new (class A {})(), Object.create(null)]) {
      assert.throws(() => g.g(v, "x"), /no fields/);
      assert.throws(() => g.m(v, "toString", []), /no fields/);
    }
  });
  test("new works on the language's built-ins only", () => {
    assert.throws(() => g.nw(Function, ["return globalThis"]), /new works only/);
    assert.throws(() => g.nw(fnv, []), /new works only/);
    assert.throws(() => g.nw(g.Date, [{ valueOf: () => 1 }]), /plain values/);
    assert.ok(g.nw(g.Date, [0]) instanceof Date);
  });
  test("imports give only prepared values", () => {
    assert.throws(() => g.imp("thixo/ui", "raw"), /not made a language value/);
    assert.throws(() => g.imp("thixo/ui", "plain"), /not made a language value/);
    assert.throws(() => g.imp("thixo/ui", "constructor"), /no export/);
    assert.throws(() => g.imp("thixo/ui", "__proto__"), /no export/);
    assert.throws(() => g.imp("__proto__", "x"), /no module/);
    assert.throws(() => g.imp("node:fs", "readFileSync"), /no module/);
    assert.equal(typeof g.imp("thixo/ui", "Stack"), "function");
  });
  test("elements are checked against the list", () => {
    for (const tag of ["script", "iframe", "object", "embed", "link", "meta", "base", "style", "use", "foreignObject", "animate", "set", "image", "template", "slot", "frame", "portal", "SCRIPT"])
      assert.throws(() => g.el(tag, [], []), /not an element/, tag);
    assert.throws(() => g.el("div", ["onclick", "alert(1)"], []), /not an attribute/);
    assert.throws(() => g.el("div", ["onClick", "alert(1)"], []), /takes a function/);
    assert.throws(() => g.el("div", ["dangerouslySetInnerHTML", g.r("__html", "<img onerror=alert(1)>")], []), /not an attribute/);
    assert.throws(() => g.el("div", ["ref", fnv], []), /not an attribute/);
    assert.throws(() => g.el("div", ["id", "config"], []), /not an attribute/);
    assert.throws(() => g.el("a", ["href", "javascript:alert(1)"], []), /takes a Url/);
    assert.throws(() => g.el("img", ["src", "https://evil.example/x.png"], []), /takes a Url/);
    assert.throws(() => g.el("div", [g.sp(g.r("srcdoc", "<script>"))], []), /not an attribute/);
    assert.throws(() => g.el("input", ["type", "file"], []), /not allowed/);
    assert.throws(() => g.el("path", ["fill", "url(https://evil.example/p.svg#a)"], []), /could load/);
    assert.throws(() => g.el(function Raw() {}, [], []), /can't be rendered/);
    assert.throws(() => g.el("div", [], [g.r("a", 1)]), /can't be rendered/);
    assert.throws(() => g.el("div", [], [fnv]), /can't be rendered/);
  });
  test("addresses can't be minted from code", () => {
    assert.throws(() => g.addr("javascript:alert(1)", "link"), /not allowed/);
    assert.throws(() => g.addr("data:text/html,<script>", "load"), /not allowed/);
    assert.throws(() => g.addr("https://x.example", "other"), /not allowed/);
    assert.throws(() => g.addr("https://x.example/a.png", "load"), /from outside the app/);
    assert.throws(() => g.addr("http://x.example/", "link"), /not allowed/);
    assert.throws(() => g.addr("mailto:a@example.com", "link"), /not allowed/);
    assert.throws(() => g.asset("../../etc/passwd"), /not the name of a copied file/);
    assert.throws(() => g.asset(`${"a".repeat(64)}.html`), /not the name of a copied file/);
    assert.throws(() => rt.url("javascript:alert(1)"), /not an address/);
    assert.throws(() => rt.url("//evil.example/x"), /not an address/);
    assert.throws(() => g.str(rt.url("https://ok.example/a")), /Url can't be turned into text/);
    assert.throws(() => g.g(rt.url("https://ok.example/a"), "address"), /no fields/);
    assert.equal(JSON.stringify(rt.url("https://ok.example/secret")), "{}");
  });
  test("a caught error is a name and a message, nothing more", () => {
    const e = g.caught(new TypeError("boom")) as object;
    assert.equal(g.g(e, "message"), "boom");
    assert.equal(g.g(e, "name"), "TypeError");
    assert.equal(g.g(e, "stack"), undefined);
    assert.equal(g.g(e, "constructor"), undefined);
    const odd = g.caught(globalThis) as object;
    assert.notEqual(odd, globalThis);
  });
  test("awaiting a thenable never calls it", async () => {
    let called = false;
    const thenable = g.r("then", g.fn(() => (called = true)));
    const box = (await (g.aw(thenable) as Promise<{ v: unknown }>)) as { v: unknown };
    assert.equal(box.v, thenable);
    assert.equal(called, false);
  });
  test("iteration and spreading take only the language's collections", () => {
    assert.throws(() => g.iter(g.r()), /Only lists/);
    assert.throws(() => g.iter({ [Symbol.iterator]: () => [][Symbol.iterator]() }), /Only lists/);
    assert.throws(() => g.a(g.sp(g.r("length", 3))), /Only lists/);
    assert.throws(() => g.rest(fnv, []), /Only a record/);
  });
  test("JSON.parse makes records with nothing behind them", () => {
    const v = g.m(g.JSON, "parse", ['{"__proto__": {"polluted": 1}, "a": [1]}']) as object;
    assert.equal(Object.getPrototypeOf(v), null);
    assert.equal(g.g(v, "__proto__"), undefined);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.throws(() => g.m(g.JSON, "parse", ['"x"', g.fn(() => 1)]), /no reviver/);
    assert.throws(() => g.m(g.JSON, "stringify", [1, g.fn(() => 1)]), /no replacer/);
  });
  test("string methods take strings, not objects with Symbol.replace", () => {
    const evil = { [Symbol.replace]: () => ((globalThis as Record<string, unknown>).__pwned = 1) };
    assert.throws(() => g.m("abc", "replace", [evil, "x"]), /takes a string/);
    assert.throws(() => g.m("abc", "split", [evil]), /takes a string/);
    assert.equal(g.m("a-b", "replace", ["-", "$&$&"]), "a$&$&b", "replacement patterns are not interpreted");
    assert.equal((globalThis as Record<string, unknown>).__pwned, undefined);
  });
  test("handed-in values are frozen copies", () => {
    const original = { a: { b: [1, 2] }, d: new Date(0), m: new Map([["k", 1]]) };
    const copy = rt.toThx(original) as unknown as object;
    assert.notEqual(copy, original);
    assert.throws(() => g.s(copy, "a", 1), /can't be changed/);
    assert.throws(() => g.m(g.g(g.g(copy, "a"), "b"), "push", [3]), /can't be changed/);
    assert.throws(() => g.m(g.g(copy, "m"), "set", ["k", 2]), /can't be changed/);
    assert.equal(g.g(g.g(copy, "d"), "setTime"), undefined);
    assert.equal(original.a.b.length, 2);
    assert.equal(rt.toThx(original), copy, "the same host value gives the same copy, so hooks see stable values");
  });
  test("toThx refuses what it can't make plain", () => {
    assert.throws(() => rt.toThx(new (class Secret {})()), /can't hand/);
    assert.throws(() => rt.toThx(Symbol("x")), /can't hand/);
  });
  test("plugin values reach the host as plain data, functions as wrappers", () => {
    let got: unknown;
    const sink = rt.hostFunction((v: unknown) => {
      got = v;
    });
    const rec = g.r("a", g.a(1, 2), "f", fnv);
    g.c(sink, [rec]);
    const v = got as { a: number[]; f: () => unknown };
    assert.equal(Object.getPrototypeOf(v), Object.prototype);
    assert.deepEqual(v.a, [1, 2]);
    assert.equal(v.f(), 1);
    assert.equal(Object.isFrozen(rec), true, "a record that left is frozen");
  });
});

describe("budget and depth", () => {
  test("ticks past the budget stop the runtime for good", () => {
    const { g, rt, errors } = setup(100);
    assert.throws(() => {
      for (;;) g.tick();
    }, /ran more than 100 steps/);
    assert.equal(rt.stopped, true);
    assert.equal(errors.length, 1);
    assert.throws(() => g.tick(), /ran more/);
    assert.throws(() => g.caught((() => {
      try {
        g.tick();
      } catch (e) {
        return e;
      }
    })()), /ran more/, "a stop can't be caught");
    assert.throws(() => g.el("div", [], []), /ran more/);
  });
  test("call depth is capped", () => {
    const { g, rt } = setup();
    assert.throws(() => {
      for (;;) g.push();
    }, /deep/);
    assert.equal(rt.stopped, true);
  });
});
