import type { DataSchema, FieldDecl } from "thixo-thx/contract";
import type { SchemaDiff } from "../../contract.js";

interface ScopedField {
  scope: string;
  field: FieldDecl;
}

function flatten(schema: DataSchema | null): ScopedField[] {
  if (!schema) return [];
  const out: ScopedField[] = [];
  for (const [name, fields] of Object.entries(schema.stores)) for (const field of fields) out.push({ scope: `store:${name}`, field });
  for (const [name, fields] of Object.entries(schema.annotations)) for (const field of fields) out.push({ scope: `annotation:${name}`, field });
  return out;
}

const keyOf = (f: ScopedField) => `${f.scope}/${f.field.name}`;

/** D4: what a version adds and stops showing, next to the one before it. `typeChanged` is filled by `lineageTypeChanges`. */
export function diffSchemas(previous: DataSchema | null, next: DataSchema): SchemaDiff {
  const before = new Map(flatten(previous).map((f) => [keyOf(f), f]));
  const after = new Map(flatten(next).map((f) => [keyOf(f), f]));
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, f]) => ({ scope: f.scope, field: f.field })),
    noLongerShown: [...before].filter(([k]) => !after.has(k)).map(([, f]) => ({ scope: f.scope, field: f.field })),
    typeChanged: [],
  };
}

/** D8: a field's type never changes, anywhere in the lineage. `history` is every schema any version of the plugin or
 * of a plugin it reads through to has declared. */
export function lineageTypeChanges(next: DataSchema, history: DataSchema[]): SchemaDiff["typeChanged"] {
  const seen = new Map<string, string>();
  for (const schema of history) for (const f of flatten(schema)) if (!seen.has(keyOf(f))) seen.set(keyOf(f), f.field.type);
  const out: SchemaDiff["typeChanged"] = [];
  for (const f of flatten(next)) {
    const was = seen.get(keyOf(f));
    if (was && was !== f.field.type) out.push({ scope: f.scope, field: f.field.name, from: was, to: f.field.type });
  }
  return out;
}
