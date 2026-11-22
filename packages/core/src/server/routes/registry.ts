import type { RegistryServices, Route, ServerContext } from "../context.js";

// Stub. Filled by the registry agent: /_thixo/registry/* and /_thixo/plugins/*, and the registry's services.
export function routes(_ctx: ServerContext): Route[] {
  return [];
}

export function services(_ctx: ServerContext): RegistryServices {
  return {};
}
