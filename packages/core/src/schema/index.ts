import type { SchemaJson } from "thixo-thx/contract";
import { parseJson, type RecordTable } from "./json.js";

export { SchemaError, parseJson, serializeJson, coerceStrings } from "./json.js";
export type { RecordTable, SchemaIssue } from "./json.js";
export type { SchemaJson };

export const SCHEMA: unique symbol = Symbol.for("thixo.schema");

/** A type, as data and as a validator. `json` is what the build and the SDK read; `parse` checks a value and
 * converts it (dates from ISO strings). */
export interface Schema<T = unknown> {
  readonly [SCHEMA]: true;
  readonly json: SchemaJson;
  /** The records `json` refers to by name, with their fields. */
  readonly records: RecordTable;
  parse(value: unknown): T;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

export interface Shape {
  [field: string]: Schema;
}

type Flatten<T> = { [K in keyof T]: T[K] } & {};

/** Fields whose type admits `undefined` (`t.optional`) become optional properties. */
export type ObjectOf<F extends Shape> = Flatten<
  { [K in keyof F as undefined extends Infer<F[K]> ? never : K]: Infer<F[K]> } & {
    [K in keyof F as undefined extends Infer<F[K]> ? K : never]?: Infer<F[K]>;
  }
>;

export function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[SCHEMA] === true;
}

/** Builds a schema from its JSON and the records it names. */
export function makeSchema<T>(json: SchemaJson, records: RecordTable = {}): Schema<T> {
  return {
    [SCHEMA]: true,
    json,
    records,
    parse: (value) => parseJson(json, value, records) as T,
  };
}

function mergeRecords(schemas: Schema[]): RecordTable {
  return Object.assign({}, ...schemas.map((s) => s.records));
}

export const t = {
  string: () => makeSchema<string>({ kind: "string" }),
  number: () => makeSchema<number>({ kind: "number" }),
  boolean: () => makeSchema<boolean>({ kind: "boolean" }),
  date: () => makeSchema<Date>({ kind: "date" }),
  /** An address, as a string on the server. A plugin sees it as the opaque `Url`. */
  url: () => makeSchema<string>({ kind: "url" }),
  unknown: () => makeSchema<unknown>({ kind: "unknown" }),
  array: <S extends Schema>(of: S) => makeSchema<Infer<S>[]>({ kind: "array", of: of.json }, of.records),
  object: <F extends Shape>(fields: F) =>
    makeSchema<ObjectOf<F>>(
      { kind: "object", fields: Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.json])) },
      mergeRecords(Object.values(fields)),
    ),
  optional: <S extends Schema>(of: S) => makeSchema<Infer<S> | undefined>({ kind: "optional", of: of.json }, of.records),
};
