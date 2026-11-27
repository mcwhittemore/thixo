// Everyday programs, each a component's body after HEAD's imports, over the test host modules. TypeScript and thixo
// must both accept every one (like-typescript.test.ts), and the output check must accept what thixo makes of them
// whichever parser reads it (verify.test.ts).

export const HEAD = `import { useState, useMemo, useEffect, useFrame, usePointer, useSize, useKeys, css } from "thixo";
import { useQuery, useCan } from "@app/hooks";
import { Stack, Text, Button, TextInput, Checkbox, Avatar, tokens } from "@app/ui";
import { toast, navigate, copyToClipboard } from "@app/services";
import { listTodos, getTodo, createTodo, updateTodo, deleteTodo, listPeople, type Todo, type Person } from "@app/sdk";
import { Sparkline, mean } from "@app/charts";
`;

/** Programs TypeScript and thixo both accept. */
export const ACCEPTED: Record<string, string> = {
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

