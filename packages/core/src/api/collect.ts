import { THIXO_SCOPES, type AppDefinition, type EndpointDef, type RecordDef, type SlotDef, type ThixoConfig } from "../contract.js";
import type { SchemaJson } from "thixo-thx/contract";
import { brandOf } from "./brand.js";
import type { EndpointHandle } from "./endpoint.js";
import type { RecordHandle } from "./record.js";
import type { ScopesHandle } from "./scopes.js";
import type { SlotHandle } from "../slots/index.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function recordNames(json: SchemaJson, into: Set<string>): void {
  switch (json.kind) {
    case "record": into.add(json.name); break;
    case "array":
    case "optional": recordNames(json.of, into); break;
    case "object": for (const f of Object.values(json.fields)) recordNames(f, into); break;
    default:
  }
}

/** Finds every branded export in the app's modules (`api/*` and `app/slots`) and gives each endpoint, record and
 * slot its export name. Thixo's own scopes are added to the app's. A mistake in the definitions throws here, at
 * start up, with the export it is on. */
export function collectApp(modules: Record<string, unknown>[], config: Pick<ThixoConfig, "libraries">): AppDefinition {
  const scopes: Record<string, string> = {};
  const endpoints: EndpointDef[] = [];
  const records: RecordDef[] = [];
  const slots: SlotDef[] = [];
  const seen = new Set<unknown>();
  const used = { endpoint: new Set<string>(), record: new Set<string>(), slot: new Set<string>() };
  const claim = (kind: keyof typeof used, name: string) => {
    if (used[kind].has(name)) throw new Error(`Two ${kind}s are exported as "${name}". Export names must be unique across the app.`);
    used[kind].add(name);
  };

  for (const mod of modules) {
    for (const [exportName, value] of Object.entries(mod)) {
      const kind = brandOf(value);
      if (!kind || seen.has(value)) continue;
      seen.add(value);
      if (kind === "scopes") {
        Object.assign(scopes, (value as ScopesHandle).scopes);
      } else if (kind === "endpoint") {
        claim("endpoint", exportName);
        const o = (value as EndpointHandle).options;
        if (!METHODS.includes(o.method)) throw new Error(`endpoint ${exportName}: unknown method "${o.method}"`);
        if (!o.path.startsWith("/")) throw new Error(`endpoint ${exportName}: path "${o.path}" must start with /`);
        endpoints.push({
          name: exportName,
          method: o.method,
          path: o.path,
          scopes: [...o.scopes],
          input: o.input?.json,
          output: o.output?.json,
          handler: (call) => o.handler(call as never),
        });
      } else if (kind === "record") {
        claim("record", exportName);
        const h = value as RecordHandle;
        records.push({
          name: h.name,
          exportName,
          read: [...h.options.read],
          fields: Object.fromEntries(Object.entries(h.options.fields).map(([k, s]) => [k, s.json])),
          canRead: h.options.canRead,
          group: h.options.group,
        });
      } else {
        claim("slot", exportName);
        slots.push({ ...(value as SlotHandle).def, exportName });
      }
    }
  }

  Object.assign(scopes, THIXO_SCOPES);

  const recordByName = new Set<string>();
  for (const r of records) {
    if (recordByName.has(r.name)) throw new Error(`Two records are named "${r.name}".`);
    recordByName.add(r.name);
  }

  const routes = new Set<string>();
  for (const e of endpoints) {
    const key = `${e.method} ${e.path.replace(/:[A-Za-z_]\w*/g, ":")}`;
    if (routes.has(key)) throw new Error(`endpoint ${e.name}: ${e.method} ${e.path} is already taken by another endpoint`);
    routes.add(key);
    for (const s of e.scopes) if (!(s in scopes)) throw new Error(`endpoint ${e.name} carries scope "${s}", which no defineScopes declares`);
    const names = new Set<string>();
    if (e.input) recordNames(e.input, names);
    if (e.output) recordNames(e.output, names);
    for (const n of names) if (!recordByName.has(n)) throw new Error(`endpoint ${e.name} uses record "${n}", which is not exported from api/`);
  }
  for (const r of records) {
    for (const s of r.read) if (!(s in scopes)) throw new Error(`record ${r.exportName} reads with scope "${s}", which no defineScopes declares`);
  }
  const slotNames = new Set(slots.map((s) => s.name));
  for (const s of slots) {
    for (const list of Object.values(s.contextScopes)) {
      for (const sc of list) if (!(sc in scopes)) throw new Error(`slot ${s.exportName} names scope "${sc}", which no defineScopes declares`);
    }
    for (const c of s.children) if (!slotNames.has(c)) throw new Error(`slot ${s.exportName} lists child "${c}", which is not a slot exported from app/slots`);
  }

  return { scopes, endpoints, records, slots, libraries: config.libraries ?? [] };
}
