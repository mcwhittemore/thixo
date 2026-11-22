// What the type check and the authoring agent are told about `@app/format`. The config imports this on the server;
// the browser module is lib/index.tsx.

export const FORMAT_DTS = `// @app/format, for plugins: the implementor's own helpers.

export {};

/** 120000 becomes "$120,000". */
export function formatMoney(amount: number): string;

/** "2026-11-02" becomes "2 Nov 2026". Anything that is not a date is returned as it was. */
export function formatDay(iso: string): string;

export interface BarChartProps {
  data: { label: string; value: number }[];
  /** In pixels. Default 120. */
  height?: number;
}
/** Vertical bars scaled to the largest value, each labelled. */
export const BarChart: Component<BarChartProps>;
`;
