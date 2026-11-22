import type { ThixoConfig } from "./contract.js";

export { IMPLEMENTOR, THIXO_SCOPES } from "./contract.js";
export type * from "./contract.js";

/** The app's configuration (see `ThixoConfig`). Returns it unchanged, typed. */
export function defineConfig(config: ThixoConfig): ThixoConfig {
  return config;
}
