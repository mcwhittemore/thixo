// thixo reads as TypeScript. Each program here goes through thixo's type check and through TypeScript itself, with the
// same lib and host modules, and the two must agree on whether it has a type error.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compile } from "../src/index.js";
import { getLib } from "../src/compiler/program.js";
import { forEachChild, type Node } from "../src/compiler/syntax/ast.js";
import { testModules, testOptions } from "./fixtures/env.js";
import { tsDiagnostics, tsLibDiagnostics } from "./helpers/tsc.js";

const HEAD = `import { useState, useMemo, useEffect, useFrame, usePointer, useSize, useKeys, css } from "thixo";
import { useQuery, useCan } from "@app/hooks";
import { Stack, Text, Button, TextInput, Checkbox, Avatar, tokens } from "@app/ui";
import { toast, navigate, copyToClipboard } from "@app/services";
import { listTodos, getTodo, createTodo, updateTodo, deleteTodo, listPeople, type Todo, type Person } from "@app/sdk";
import { Sparkline, mean } from "@app/charts";
`;

/** Programs TypeScript and thixo both accept. */
const ACCEPTED: Record<string, string> = {
  "state, frames and the pointer": `
export default function Spin() {
  const [t, setT] = useState(0);
  const pointer = usePointer();
  useFrame((time, delta) => setT((prev) => prev + delta));
  return <svg width="200" height="200"><circle cx={pointer.x} cy={pointer.y} r={5 + Math.sin(t)} fill="teal" /></svg>;
}`,
  "lists: map, filter, reduce, sort, find": `
type Item = { id: number; label: string; done: boolean };
export default function List() {
  const [items, setItems] = useState<Item[]>([{ id: 1, label: "a", done: false }]);
  const open = items.filter((i) => !i.done);
  const total = items.reduce((sum, i) => sum + i.id, 0);
  const sorted = items.toSorted((a, b) => a.label.localeCompare(b.label));
  const first = items.find((i) => i.id === 1);
  const toggle = (id: number) => setItems(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  return (
    <ul>
      {sorted.map((i) => <li key={i.id} onClick={() => toggle(i.id)}>{i.label}</li>)}
      <li>{open.length} open, {total}, {first?.label ?? "none"}</li>
    </ul>
  );
}`,
  "a discriminated union with a switch": `
type Shape = { kind: "circle"; r: number } | { kind: "rect"; w: number; h: number };
function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.r * s.r;
    case "rect":
      return s.w * s.h;
  }
}
export default function A() {
  const shapes: Shape[] = [{ kind: "circle", r: 2 }, { kind: "rect", w: 1, h: 3 }];
  return <p>{shapes.map(area).join(", ")}</p>;
}`,
  "narrowing: undefined, typeof, truthiness, early return": `
function describe(v: string | number | undefined): string {
  if (v === undefined) return "nothing";
  if (typeof v === "number") return v.toFixed(2);
  return v.toUpperCase();
}
function first(xs: readonly string[] | null): string {
  if (!xs || xs.length === 0) return "";
  return xs[0];
}
export default function N() {
  const [name, setName] = useState<string | null>(null);
  const label = name ? name.trim() : "anonymous";
  return <p onClick={() => setName("x")}>{describe(label.length)}{first(["a"])}{label}</p>;
}`,
  "a component with typed props and children": `
interface CardProps {
  title: string;
  tone?: "info" | "warning";
  children?: ThxNode;
}
function Card({ title, tone = "info", children }: CardProps) {
  return <section className={css({ padding: 8, color: tone === "info" ? "#333" : "#a00" })}><h2>{title}</h2>{children}</section>;
}
export default function Page() {
  return <Card title="Hi" tone="warning"><p>body</p><p>more</p></Card>;
}`,
  "host components and hooks": `
export default function Todos() {
  const todos = useQuery(listTodos);
  const one = useQuery(getTodo, { id: "1" });
  const [title, setTitle] = useState("");
  const canDelete = useCan(deleteTodo);
  async function add() {
    await createTodo({ title });
    setTitle("");
    todos.refresh();
  }
  return (
    <Stack direction="column">
      <TextInput value={title} onChange={setTitle} onSubmit={add} placeholder="New" />
      <Text tone="default">{one.data?.title}</Text>
      {todos.loading && <Text>Loading</Text>}
      {todos.data?.map((t) => (
        <Stack key={t.id} direction="row">
          <Checkbox checked={t.done} onChange={(done) => updateTodo({ id: t.id, done }).then(todos.refresh)} />
          <Button disabled={!canDelete} onClick={() => deleteTodo({ id: t.id })}>Delete</Button>
        </Stack>
      ))}
    </Stack>
  );
}`,
  "async functions, promises and try/catch": `
async function load(): Promise<Todo[]> {
  try {
    const todos = await listTodos();
    return todos.filter((t) => !t.done);
  } catch (e) {
    toast(typeof e === "string" ? e : "failed");
    return [];
  }
}
export default function L() {
  const [n, setN] = useState(0);
  useEffect(() => {
    load().then((ts) => setN(ts.length));
  }, []);
  return <button onClick={async () => { await copyToClipboard(String(n)); }}>{n}</button>;
}`,
  "events give plain data": `
export default function F() {
  const [v, setV] = useState("");
  const [on, setOn] = useState(false);
  return (
    <form onSubmit={() => toast(v)}>
      <input value={v} onChange={(e) => setV(e.value)} onKeyDown={(e) => { if (e.key === "Enter") toast(v); }} />
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.checked)} />
      <div onPointerMove={(e) => setV(String(e.x + e.y))} />
    </form>
  );
}`,
  "records, Map and Set": `
export default function R() {
  const counts: Record<string, number> = {};
  for (const w of "a b a".split(" ")) counts[w] = (counts[w] ?? 0) + 1;
  const m = new Map<string, number>();
  m.set("a", 1);
  const s = new Set(["x", "y"]);
  const keys = Object.keys(counts);
  const entries = Object.entries(counts).map(([k, n]) => k + n);
  return <p>{keys.join()}{entries.join()}{m.get("a") ?? 0}{s.has("x") ? "yes" : "no"}{s.size}</p>;
}`,
  "generic functions and inference": `
function pick<T>(xs: readonly T[], i: number): T | undefined {
  return xs[i];
}
function pair<A, B>(a: A, b: B): [A, B] {
  return [a, b];
}
function byKey<T, K extends keyof T>(xs: T[], k: K): T[K][] {
  return xs.map((x) => x[k]);
}
export default function G() {
  const n = pick([1, 2, 3], 0);
  const [a, b] = pair("x", 2);
  const labels = byKey([{ label: "a" }], "label");
  return <p>{(n ?? 0) + b}{a.length}{labels.join()}</p>;
}`,
  "tuples, rest and spread": `
function sum(...xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
export default function T() {
  const point: [number, number] = [1, 2];
  const [x, y] = point;
  const more = [...point, 3];
  const o = { a: 1, b: "b" };
  const { a, ...rest } = o;
  return <p>{sum(x, y, ...more)}{a}{rest.b}</p>;
}`,
  "unknown from JSON, narrowed": `
function isTodo(v: unknown): v is { title: string } {
  return typeof v === "object" && v !== null;
}
export default function J() {
  const data: unknown = JSON.parse("{}");
  const list = Array.isArray(data) ? data.length : 0;
  const title = isTodo(data) ? data.title : "";
  return <p>{list}{title}</p>;
}`,
  "optional chaining and nullish coalescing": `
interface User { name: string; address?: { city?: string } }
export default function O({ user }: { user?: User }) {
  const city = user?.address?.city ?? "unknown";
  const upper = user?.name.toUpperCase();
  return <p>{city}{upper}</p>;
}`,
  "utility types": `
interface Todo2 { id: string; title: string; done: boolean }
type Draft = Partial<Todo2>;
type Key = keyof Todo2;
type Summary = Pick<Todo2, "id" | "title">;
type NoId = Omit<Todo2, "id">;
type Frozen = Readonly<Todo2>;
type ById = Record<string, Todo2>;
export default function U() {
  const d: Draft = { title: "x" };
  const k: Key = "done";
  const s: Summary = { id: "1", title: "t" };
  const n: NoId = { title: "t", done: false };
  const f: Frozen = { id: "1", title: "t", done: true };
  const by: ById = { [f.id]: f };
  return <p>{d.title}{k}{s.id}{String(n.done)}{Object.keys(by).length}</p>;
}`,
  "string, number and Math methods": `
export default function S() {
  const t = "Hello, World";
  const parts = t.split(", ").map((p) => p.trim().toLowerCase());
  const n = Number.parseFloat("1.5") + parseInt("2", 10);
  const r = Math.round(Math.max(...[1, 2, 3]) * Math.random());
  const pad = String(r).padStart(3, "0");
  return <p>{parts.join("|")}{n.toFixed(1)}{pad}{t.includes("W") ? "w" : ""}{Number.isNaN(n) ? "nan" : ""}</p>;
}`,
  "dates": `
export default function D() {
  const now = new Date(Date.now());
  const day = new Date(2024, 0, 1);
  return <time>{now.getFullYear() - day.getFullYear()}{day.toISOString()}</time>;
}`,
  "loops and let": `
export default function W() {
  let total = 0;
  for (let i = 0; i < 10; i++) total += i;
  let n = 5;
  while (n > 0) n--;
  let label;
  if (total > 10) label = "big";
  else label = "small";
  return <p>{total}{n}{label}</p>;
}`,
  "memo, size and keys": `
export default function M() {
  const size = useSize();
  const keys = useKeys();
  const area = useMemo(() => size.width * size.height, [size.width, size.height]);
  const left = keys.includes("ArrowLeft");
  return <div style={{ width: size.width / 2, opacity: left ? 0.5 : 1 }}>{area}</div>;
}`,
  "styles with states and media": `
const button = css({ padding: 4, ":hover": { color: "red" }, "@media (max-width: 400px)": { padding: 2 } });
export default function C() {
  return <button className={button} style={{ marginTop: tokens.space }}>go</button>;
}`,
  "charts and urls from the host": `
export default function P() {
  const people = useQuery(listPeople);
  const avg = mean([1, 2, 3]);
  const first = people.data?.[0];
  return (
    <Stack>
      <Sparkline values={[1, 2, avg]} />
      {people.data?.map((p: Person) => <Avatar key={p.id} src={p.avatar} alt={p.name} />)}
      {first && <button onClick={() => navigate(first.avatar)}>open</button>}
      <a href="https://example.com/help">help</a>
    </Stack>
  );
}`,
  "satisfies": `
const palette = { primary: "#00f", muted: "#999" } satisfies Record<string, string>;
export default function Sat() {
  return <p style={{ color: palette.primary }}>x</p>;
}`,
  "interfaces extending interfaces": `
interface Named { name: string }
interface Pet extends Named { legs: number }
function intro(p: Pet): string {
  return p.name + " has " + p.legs;
}
export default function I() {
  return <p>{intro({ name: "rex", legs: 4 })}</p>;
}`,
  "functions as values and callbacks": `
type Op = (a: number, b: number) => number;
const ops: Record<"add" | "mul", Op> = { add: (a, b) => a + b, mul: (a, b) => a * b };
function apply(f: Op, xs: number[]): number {
  return xs.reduce((acc, x) => f(acc, x));
}
export default function Fn() {
  return <p>{apply(ops.add, [1, 2])}{apply(ops["mul"], [3, 4])}</p>;
}`,
  "object state updated through a callback": `
type Pos = { x: number; y: number };
export default function Drag() {
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  return (
    <div
      style={{ transform: \`translate(\${pos.x}px, \${pos.y}px)\` }}
      onPointerMove={(e) => setPos((p) => ({ ...p, x: e.x }))}
      onClick={() => { setOpen((o) => !o); setTags([...tags, "t" + tags.length]); }}
    >
      {open ? <>{tags.join(", ")}</> : null}
    </div>
  );
}`,
  "a generic component": `
function List<T>({ items, render }: { items: readonly T[]; render: (item: T, i: number) => ThxNode }) {
  return <ul>{items.map((it, i) => <li key={i}>{render(it, i)}</li>)}</ul>;
}
export default function G() {
  return <List items={[1, 2, 3]} render={(n) => <b>{n * 2}</b>} />;
}`,
  "optional callbacks and defaults": `
function Field({ label, onChange, value = "" }: { label: string; onChange?: (v: string) => void; value?: string }) {
  return <label>{label}<input value={value} onChange={(e) => onChange?.(e.value)} /></label>;
}
function scale(n: number, by?: number): number {
  return n * (by ?? 1);
}
export default function D() {
  return <Field label={String(scale(2))} onChange={(v) => toast(v)} />;
}`,
  "an exhaustive switch with never": `
type Tone = "info" | "warning" | "error";
function color(t: Tone): string {
  switch (t) {
    case "info":
      return "blue";
    case "warning":
      return "orange";
    case "error":
      return "red";
    default: {
      const unreachable: never = t;
      return unreachable;
    }
  }
}
export default function E() {
  return <p style={{ color: color("info") }}>x</p>;
}`,
  "Promise.all and Array.from": `
export default function PA() {
  const [n, setN] = useState(0);
  useEffect(() => {
    Promise.all([listTodos(), listPeople()]).then(([todos, people]) => setN(todos.length + people.length));
  }, []);
  const squares = Array.from({ length: 5 }, (_, i) => i * i);
  return <p>{n}{squares.join()}</p>;
}`,
  "more list methods": `
export default function LM() {
  const xs = [3, 1, 2];
  const words = ["a", "bb"];
  const any = xs.some((x) => x > 2) && xs.every((x) => x > 0);
  const flat = words.flatMap((w) => w.split(""));
  const at = xs.at(-1) ?? 0;
  const idx = xs.indexOf(2) + xs.findIndex((x) => x === 1);
  const joined = xs.slice(1).concat([4]).join("-");
  return <p>{String(any)}{flat.length}{at}{idx}{joined}{Math.min(...xs)}{words.includes("a") ? 1 : 0}</p>;
}`,
  "unions narrowed by an if with an else": `
type Result = { ok: true; value: number } | { ok: false; error: string };
function show(r: Result): string {
  if (r.ok) {
    return String(r.value);
  } else {
    return r.error;
  }
}
export default function RU() {
  const r: Result = Math.random() > 0.5 ? { ok: true, value: 1 } : { ok: false, error: "no" };
  return <p>{show(r)}</p>;
}`,
  "returning JSX from helpers": `
function badge(n: number): ThxNode {
  if (n === 0) return null;
  return <span className={css({ borderRadius: 4 })}>{n}</span>;
}
function row(label: string): JSX.Element {
  return <tr><td>{label}</td></tr>;
}
export default function H() {
  return <table><tbody>{row("a")}{badge(2)}</tbody></table>;
}`,
  "index signatures and nested records": `
type Scores = { [player: string]: number[] };
export default function IS() {
  const scores: Scores = { ana: [1, 2] };
  const best = Object.values(scores).map((xs) => Math.max(...xs));
  const ana = scores["ana"] ?? [];
  return <p>{best.join()}{ana.length}</p>;
}`,
  "effects that clean up": `
export default function Eff() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    let alive = true;
    listTodos().then(() => { if (alive) setTicks((t) => t + 1); });
    return () => { alive = false; };
  }, [ticks]);
  return <p>{ticks}</p>;
}`,
  "filters that narrow, as TypeScript infers them": `
type Tile = { kind: "wall" } | { kind: "door"; open: boolean };
export default function Fi() {
  const maybe = [1, undefined, 3];
  const nums = maybe.filter((x) => x !== undefined);
  const tiles: Tile[] = [{ kind: "wall" }, { kind: "door", open: true }];
  const doors = tiles.filter((t) => t.kind === "door");
  const named = ["a", null].filter((s) => s !== null);
  return <p>{nums.map((n) => n.toFixed(1)).join()}{doors.map((d) => String(d.open)).join()}{named.join()}</p>;
}`,
  "a reducer-style update": `
type Action = { type: "add"; text: string } | { type: "clear" };
type State = { items: string[] };
function reduce(s: State, a: Action): State {
  if (a.type === "add") return { items: [...s.items, a.text] };
  return { items: [] };
}
export default function Red() {
  const [state, setState] = useState<State>({ items: [] });
  const dispatch = (a: Action) => setState((s) => reduce(s, a));
  return <button onClick={() => dispatch({ type: "add", text: "x" })}>{state.items.length}</button>;
}`,
};

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
