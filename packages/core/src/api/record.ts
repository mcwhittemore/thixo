import type { RecordDef } from "../contract.js";
import { makeSchema, type ObjectOf, type RecordTable, type Schema, type Shape } from "../schema/index.js";
import { BRAND, type Branded } from "./brand.js";

export interface RecordOptions<F extends Shape> {
  /** The scopes needed to read one (A10). */
  read: string[];
  fields: F;
  /** A13: does it exist, and may this user read it? */
  canRead?: RecordDef["canRead"];
  /** A11: who sees an annotation on it. */
  group?: RecordDef["group"];
}

export interface RecordHandle<F extends Shape = Shape> extends Schema<ObjectOf<F>>, Branded<"record"> {
  readonly name: string;
  readonly options: RecordOptions<F>;
}

/** A kind of thing in the app that plugins can annotate (A10). It is a schema too: `t.array(Todo)`. */
export function record<F extends Shape>(name: string, options: RecordOptions<F>): RecordHandle<F> {
  const nested: RecordTable = Object.assign({}, ...Object.values(options.fields).map((s) => s.records));
  const own = Object.fromEntries(Object.entries(options.fields).map(([k, s]) => [k, s.json]));
  const records: RecordTable = { ...nested, [name]: own };
  const schema = makeSchema<ObjectOf<F>>({ kind: "record", name }, records);
  return Object.assign(schema, { [BRAND]: "record" as const, name, options });
}
