import { DATA_DTS } from "./data.js";
import { PLUGIN_DTS } from "./plugin.js";
import { SCHEMA_DTS } from "./schema.js";
import { SERVICES_DTS, SERVICE_NAMES } from "./services.js";
import { UI_DTS } from "./ui.js";

export { DATA_DTS, PLUGIN_DTS, SCHEMA_DTS, SERVICES_DTS, SERVICE_NAMES, UI_DTS };

/** The fixed modules a plugin may import, by specifier, as `.d.ts` text. They use only the globals of thx's own
 * library: Url, ThxNode, Component<P>, Promise, Map, Date and the JSX namespace. */
export const PLUGIN_API_MODULES: Record<string, string> = {
  "thixo/plugin": PLUGIN_DTS,
  "thixo/ui": UI_DTS,
  "thixo/data": DATA_DTS,
  "thixo/schema": SCHEMA_DTS,
  "thixo/services": SERVICES_DTS,
};
