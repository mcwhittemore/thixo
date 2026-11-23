/** Everything reachable from `roots` by reading properties, as a plugin could if nothing guarded it: own properties
 * (getters are called), symbols, array items, Map and Set entries, and prototypes other than the built-in ones.
 * DOM nodes and React's dev-only bookkeeping (`_owner`, `_store`, `_debug*`) are skipped: a plugin reads neither,
 * and production elements carry no owner. */
export function reachable(roots: unknown[], limit = 200_000): { strings: string[]; objects: Set<unknown> } {
  const strings: string[] = [];
  const objects = new Set<unknown>();
  const builtins = new Set<unknown>([Object.prototype, Function.prototype, Array.prototype, Map.prototype, Set.prototype, Date.prototype, Promise.prototype, Error.prototype]);
  const queue: unknown[] = [...roots];
  while (queue.length) {
    const value = queue.pop();
    if (typeof value === "string") {
      strings.push(value);
      continue;
    }
    if ((typeof value !== "object" && typeof value !== "function") || value === null || objects.has(value) || builtins.has(value)) continue;
    if (typeof (value as { nodeType?: unknown }).nodeType === "number") continue;
    objects.add(value);
    if (objects.size > limit) throw new Error("walked too far");
    if (value instanceof Map) for (const [k, v] of value) queue.push(k, v);
    if (value instanceof Set) for (const v of value) queue.push(v);
    for (const key of [...Object.getOwnPropertyNames(value), ...Object.getOwnPropertySymbols(value)]) {
      if (typeof key === "string" && (key === "_owner" || key === "_store" || key.startsWith("_debug") || key === "caller" || key === "arguments")) continue;
      if (typeof key === "string") strings.push(key);
      let v: unknown;
      try {
        v = (value as Record<string | symbol, unknown>)[key];
      } catch {
        continue;
      }
      queue.push(v);
    }
    queue.push(Object.getPrototypeOf(value));
  }
  return { strings, objects };
}
