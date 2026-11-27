// A program that touches most of the compiler: two files, a host module, props, lists, narrowing, async, styles and
// JSX. Compiling it once at load means a host's first real compile runs code the engine has already compiled.

import type { CompileOptions, SourceFiles } from "../contract.js";

export const WARM_UP_FILES: SourceFiles = {
  "main.thx": `import { useState, useMemo, useEffect, useFrame, usePointer, useSize, useKeys, css } from "thixo";
import { load, save, useData, allowed, Box, Field, type Row } from "@warm/data";
import { scale, type Pair } from "./lib/util";

type Mode = { kind: "list"; filter?: string } | { kind: "grid"; cols: number };

function Cell({ label, size = 2, children }: { label: string; size?: number; children?: ThxNode }) {
  return <td className={css({ padding: size, ":hover": { color: "red" } })} style={{ width: size * 2 }}>{label}{children}</td>;
}

export default function Warm({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const pointer = usePointer();
  const box = useSize();
  const keys = useKeys();
  useFrame((t, dt) => setN((x) => x + dt));
  useEffect(() => {
    let alive = true;
    load().then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, []);
  const data = useData(load);
  const one = useData(save, { name: "a" });
  const can = allowed(save);
  const [title, setTitle] = useState("");
  const firstName = data.data?.find((d) => d.value === n)?.name;
  const shown = useMemo(() => rows.filter((r) => r.name.includes(mode.kind === "list" ? (mode.filter ?? "") : "")).map((r, i) => ({ ...r, i })), [rows, mode]);
  const pair: Pair = [scale(n, 2), keys.length];
  const total = shown.reduce((sum, r) => sum + r.value, 0);
  const label = total > 10 ? \`big \${total.toFixed(1)}\` : String(total);
  let note;
  if (pointer.inside) note = "in";
  else note = "out";
  for (const [k, v] of Object.entries({ a: 1 })) note += k + v;
  async function more() {
    try {
      const r = await load();
      setRows([...rows, ...r]);
    } catch (e) {
      setN(typeof e === "number" ? e : 0);
    }
  }
  switch (mode.kind) {
    case "grid":
      return <svg width={box.width}><rect x={pointer.x} y={pointer.y} width={mode.cols} height={pair[0]} transform={\`rotate(\${n} 1 1)\`} /></svg>;
    default:
      return (
        <table>
          <tbody>
            {shown.map((r) => (
              <tr key={r.i} onClick={() => setMode({ kind: "grid", cols: 2 })}>
                <Cell label={r.name}>{r.value > 1 && <b>{r.value}</b>}</Cell>
                <Box tone="a" onPick={(id) => save({ name: id }).then(data.refresh)}>{one.data?.name}{data.data?.map((d) => d.name)}</Box>
              </tr>
            ))}
            <tr><td><Field value={title} onChange={setTitle} onSubmit={more} />{can && firstName}</td></tr>
            <tr><td><input value={label} onChange={(e) => setMode({ kind: "list", filter: e.value })} /><button onClick={more}>{note}</button></td></tr>
          </tbody>
        </table>
      );
  }
}
`,
  "lib/util.thx": `export type Pair = [number, number];
export const scale = (x: number, by?: number): number => Math.round(x * (by ?? 1));
`,
};

export const WARM_UP_OPTIONS: CompileOptions = {
  modules: {
    "@warm/data": {
      dts: `export interface Row { readonly name: string; readonly value: number; }
export declare function load(): Promise<Row[]>;
export declare function save(input: { name: string; value?: number }): Promise<Row>;
export interface Data<O> { readonly data: O | undefined; readonly loading: boolean; readonly refresh: () => void; }
export declare function useData<O>(fn: () => Promise<O>): Data<O>;
export declare function useData<I, O>(fn: (input: I) => Promise<O>, input: I): Data<O>;
export declare function allowed(fn: (...args: never) => unknown): boolean;
export declare const Field: Component<{ value: string; onChange: (value: string) => void; onSubmit?: () => void }>;
export declare const Box: Component<{ tone?: "a" | "b"; onPick?: (id: string) => void; children?: ThxNode }>;
`,
    },
  },
};
