export const BRAND: unique symbol = Symbol.for("thixo.brand");

export type BrandKind = "endpoint" | "record" | "scopes" | "slot";

export interface Branded<K extends BrandKind> {
  readonly [BRAND]: K;
}

/** What kind of Thixo definition a value is, if it is one. `Symbol.for` keeps this true across two copies of the
 * package, as in a bundle beside a linked workspace. */
export function brandOf(value: unknown): BrandKind | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const kind = (value as Record<symbol, unknown>)[BRAND];
  return kind === "endpoint" || kind === "record" || kind === "scopes" || kind === "slot" ? kind : undefined;
}
