export interface BarChartProps {
  data: { label: string; value: number }[];
  height?: number;
}

/** A row of bars, scaled to the largest value. */
export function BarChart({ data, height = 120 }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={data.map((d) => `${d.label}: ${d.value}`).join(", ")} style={{ display: "flex", gap: 8, alignItems: "flex-end", height }}>
      {data.map((d) => (
        <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
          <span style={{ fontSize: 12 }}>{d.value}</span>
          <div style={{ width: "100%", height: `${(d.value / max) * 80}%`, minHeight: 2, background: "var(--thixo-color-accent, #2563eb)", borderRadius: 3 }} />
          <span style={{ fontSize: 11 }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}
