import type { CompileEnv, SchemaJson } from "thixo-thx/contract";
import type { AppDefinition, EndpointDef, RecordDef, SlotDef, ThixoConfig } from "../contract.js";
import { PLUGIN_API_MODULES, SERVICE_NAMES } from "../plugin-api/index.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function key(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/** A schema as TypeScript, for the declarations a plugin is checked against. A date is `Date` and an address is the
 * language's `Url`. A record is the type its `@app/sdk` export carries. */
export function tsType(json: SchemaJson, recordTypes: Map<string, string>): string {
  switch (json.kind) {
    case "string":
    case "number":
    case "boolean":
      return json.kind;
    case "date": return "Date";
    case "url": return "Url";
    case "unknown": return "unknown";
    case "array": {
      const inner = tsType(json.of, recordTypes);
      return json.of.kind === "optional" ? `(${inner})[]` : `${inner}[]`;
    }
    case "optional": return `${tsType(json.of, recordTypes)} | undefined`;
    case "record": return recordTypes.get(json.name) ?? "unknown";
    case "object": return objectType(json.fields, recordTypes);
  }
}

function objectType(fields: Record<string, SchemaJson>, recordTypes: Map<string, string>): string {
  const members = Object.entries(fields).map(([name, field]) => {
    const optional = field.kind === "optional";
    return `${key(name)}${optional ? "?" : ""}: ${tsType(optional ? field.of : field, recordTypes)}`;
  });
  return members.length ? `{ ${members.join("; ")} }` : "{}";
}

function allOptional(json: SchemaJson, recordTypes: Map<string, string>): boolean {
  return json.kind === "object" && Object.values(json.fields).every((f) => f.kind === "optional");
}

function endpointDecl(e: EndpointDef, recordTypes: Map<string, string>): string {
  const output = e.output ? tsType(e.output, recordTypes) : "void";
  let param = "";
  if (e.input) param = `input${allOptional(e.input, recordTypes) ? "?" : ""}: ${tsType(e.input, recordTypes)}`;
  return `export function ${e.name}(${param}): Promise<${output}>;`;
}

function sdkDts(app: AppDefinition, recordTypes: Map<string, string>): string {
  const lines = [
    "// The app's API, as a plugin sees it. One function per endpoint; each record is a handle to pass to `annotate`",
    "// and a type for its fields. Generated: it changes when the app's `api/` changes.",
    "export {};",
    "interface RecordHandle<Name extends string, Fields> {",
    "  readonly __thixoRecord: Name;",
    "  readonly __thixoRecordFields: Fields;",
    "}",
  ];
  for (const r of app.records) {
    lines.push(
      `export type ${r.exportName} = ${objectType(r.fields, recordTypes)};`,
      `export const ${r.exportName}: RecordHandle<${JSON.stringify(r.name)}, ${r.exportName}>;`,
    );
  }
  for (const e of app.endpoints) lines.push(endpointDecl(e, recordTypes));
  return lines.join("\n") + "\n";
}

function optionalDts(app: AppDefinition, recordTypes: Map<string, string>): string {
  const lines = [
    "// The same functions as `@app/sdk`, imported as optional (P2): the plugin works without the scope.",
    "// Calling one the user can't call rejects, and `useQuery` of it loads nothing. Check with `useCan`.",
    "export {};",
  ];
  for (const r of app.records) lines.push(`export type ${r.exportName} = ${objectType(r.fields, recordTypes)};`);
  for (const e of app.endpoints) lines.push(endpointDecl(e, recordTypes));
  return lines.join("\n") + "\n";
}

function slotsDts(app: AppDefinition, recordTypes: Map<string, string>): string {
  const lines = [
    "// The app's slots. Pass one to `definePlugin` as its first argument: the component's `context` and `emit` take",
    "// their types from it. Pass one to `ChildSlot` as `is`.",
    "export {};",
    "interface SlotHandle<Context, Emits> {",
    "  readonly __thixoSlotContext: Context;",
    "  readonly __thixoSlotEmits: Emits;",
    "}",
  ];
  for (const s of app.slots) lines.push(slotDecl(s, recordTypes));
  return lines.join("\n") + "\n";
}

function slotDecl(s: SlotDef, recordTypes: Map<string, string>): string {
  const context = objectType(s.context, recordTypes);
  const emits = objectType(s.emits, recordTypes);
  return `export const ${s.exportName}: SlotHandle<${context}, ${emits}>;`;
}

/** Everything the compiler needs about the app: the declarations of each module a plugin may import, and what the
 * manifest records for each endpoint, record and slot. */
export function buildCompileEnv(app: AppDefinition, config: Pick<ThixoConfig, "libraries" | "addressHosts">): CompileEnv {
  const recordTypes = new Map<string, string>(app.records.map((r: RecordDef) => [r.name, r.exportName]));
  const libraries = [...app.libraries, ...(config.libraries ?? [])];
  const unique = [...new Map(libraries.map((l) => [l.specifier, l])).values()];

  const modules: CompileEnv["modules"] = {};
  for (const [specifier, dts] of Object.entries(PLUGIN_API_MODULES)) modules[specifier] = { dts };
  modules["@app/sdk"] = { dts: sdkDts(app, recordTypes) };
  modules["@app/sdk/optional"] = { dts: optionalDts(app, recordTypes) };
  modules["@app/slots"] = { dts: slotsDts(app, recordTypes) };
  for (const l of unique) modules[l.specifier] = { dts: l.dts };

  return {
    modules,
    endpoints: Object.fromEntries(app.endpoints.map((e) => [e.name, { scopes: [...e.scopes] }])),
    records: Object.fromEntries(app.records.map((r) => [r.exportName, { name: r.name, read: [...r.read] }])),
    slots: Object.fromEntries(app.slots.map((s) => [s.exportName, { name: s.name }])),
    services: [...SERVICE_NAMES],
    libraries: unique.map((l) => l.specifier),
    addressHosts: config.addressHosts ?? [],
  };
}
