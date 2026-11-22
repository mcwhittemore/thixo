/** What slot paths are made from: each slot's name, export name and the child slots it may place (S13). */
export interface SlotTree {
  name: string;
  exportName?: string;
  children: string[];
}

/** Every slot path a layout can name: the top-level slots, and each child slot under its parent, such as
 * `main/todo-row`. */
export function slotPaths(slots: readonly SlotTree[]): string[] {
  const byName = new Map(slots.map((s) => [s.name, s]));
  const children = new Set(slots.flatMap((s) => s.children));
  const out: string[] = [];
  const walk = (name: string, prefix: string, seen: Set<string>) => {
    const slot = byName.get(name);
    if (!slot || seen.has(name)) return;
    const path = prefix ? `${prefix}/${name}` : name;
    out.push(path);
    for (const child of slot.children) walk(child, path, new Set([...seen, name]));
  };
  for (const slot of slots) if (!children.has(slot.name)) walk(slot.name, "", new Set());
  return out;
}

export type SlotPathLookup = { ok: true; path: string } | { ok: false; message: string };

/** Turns what someone wrote for a slot into the path a layout keys it by. A path is taken as it is. A slot's name
 * or export name, such as `todo-row` or `todoRow`, becomes its path when it has exactly one (`main/todo-row`).
 * Anything else is refused with the paths there are, so nothing is stored under a key no slot reads. */
export function resolveSlotPath(slots: readonly SlotTree[], text: string): SlotPathLookup {
  const paths = slotPaths(slots);
  if (paths.includes(text)) return { ok: true, path: text };
  const trimmed = text.replace(/^\/+|\/+$/g, "");
  if (paths.includes(trimmed)) return { ok: true, path: trimmed };
  const slot = slots.find((s) => s.name === trimmed) ?? slots.find((s) => s.exportName === trimmed);
  const list = paths.join(", ") || "(none)";
  if (!slot) return { ok: false, message: `There is no slot "${text}". The slot paths are: ${list}.` };
  const matches = paths.filter((p) => p === slot.name || p.endsWith(`/${slot.name}`));
  if (matches.length === 1) return { ok: true, path: matches[0] };
  if (!matches.length) return { ok: false, message: `The slot "${slot.name}" is not placed anywhere in this app. The slot paths are: ${list}.` };
  return { ok: false, message: `The slot "${slot.name}" is in more than one place: ${matches.join(", ")}. Name one of those paths.` };
}
