import { BRAND, type Branded } from "./brand.js";

export interface ScopesHandle<M extends { [scope: string]: string } = { [scope: string]: string }> extends Branded<"scopes"> {
  readonly scopes: M;
}

/** The app's scopes, each with the words the registry uses to describe a plugin to a person. */
export function defineScopes<const M extends { [scope: string]: string }>(scopes: M): ScopesHandle<M> {
  return { [BRAND]: "scopes", scopes };
}
