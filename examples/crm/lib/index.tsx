// The browser module the config exposes to plugins as `@app/format` (L3). A plugin gets these exports wrapped at the
// boundary: functions become language functions and BarChart a component.

export { formatDay, formatMoney } from "./format";
export { BarChart } from "./chart";
