import type { SchemaJson } from "thixo-thx/contract";

/** Record name to the fields of that record. A `record` schema refers to its fields by name. */
export type RecordTable = Record<string, Record<string, SchemaJson>>;

export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaError extends Error {
  readonly issues: SchemaIssue[];
  constructor(issues: SchemaIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "SchemaError";
    this.issues = issues;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function validUrl(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const FAIL = Symbol("fail");

function walk(json: SchemaJson, value: unknown, records: RecordTable, path: string, issues: SchemaIssue[]): unknown {
  const fail = (message: string) => {
    issues.push({ path: path || "value", message });
    return FAIL;
  };
  switch (json.kind) {
    case "string":
      return typeof value === "string" ? value : fail(`expected a string, got ${kindOf(value)}`);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : fail(`expected a number, got ${kindOf(value)}`);
    case "boolean":
      return typeof value === "boolean" ? value : fail(`expected a boolean, got ${kindOf(value)}`);
    case "date": {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? fail("expected a valid date") : value;
      if (typeof value === "string" && ISO_DATE.test(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
      }
      return fail(`expected a date as an ISO string, got ${kindOf(value)}`);
    }
    case "url":
      if (typeof value !== "string") return fail(`expected a url string, got ${kindOf(value)}`);
      return validUrl(value) ? value : fail("expected an absolute url or a path starting with /");
    case "unknown":
      return value;
    case "optional":
      return value === undefined || value === null ? undefined : walk(json.of, value, records, path, issues);
    case "array": {
      if (!Array.isArray(value)) return fail(`expected an array, got ${kindOf(value)}`);
      const out: unknown[] = [];
      value.forEach((item, i) => out.push(walk(json.of, item, records, `${path}[${i}]`, issues)));
      return out;
    }
    case "object":
    case "record": {
      let fields: Record<string, SchemaJson> | undefined;
      if (json.kind === "object") fields = json.fields;
      else {
        fields = records[json.name];
        if (!fields) throw new Error(`Unknown record "${json.name}" in a schema`);
      }
      if (!isPlainObject(value)) return fail(`expected an object, got ${kindOf(value)}`);
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        const here = path ? `${path}.${key}` : key;
        if (value[key] === undefined && field.kind !== "optional" && field.kind !== "unknown") {
          issues.push({ path: here, message: "is required" });
          continue;
        }
        const parsed = walk(field, value[key], records, here, issues);
        if (parsed !== undefined && parsed !== FAIL) out[key] = parsed;
      }
      return out;
    }
  }
}

/** Validates `value` against `json` and converts it: dates from ISO strings. Unknown object keys are dropped.
 * Throws `SchemaError` listing every problem. */
export function parseJson(json: SchemaJson, value: unknown, records: RecordTable = {}): unknown {
  const issues: SchemaIssue[] = [];
  const out = walk(json, value, records, "", issues);
  if (issues.length) throw new SchemaError(issues);
  return out;
}

/** Shapes a handler's output for the wire: keeps only declared fields, writes dates as ISO strings. A value that
 * doesn't fit its schema is passed along as it is. The handler is the implementor's to get right (A12). */
export function serializeJson(json: SchemaJson | undefined, value: unknown, records: RecordTable = {}): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (!json) return value;
  switch (json.kind) {
    case "optional":
      return value === undefined || value === null ? undefined : serializeJson(json.of, value, records);
    case "array":
      return Array.isArray(value) ? value.map((item) => serializeJson(json.of, item, records)) : value;
    case "object":
    case "record": {
      const fields = json.kind === "object" ? json.fields : records[json.name];
      if (!fields || !isPlainObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        const v = serializeJson(field, value[key], records);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    default:
      return value;
  }
}

function unwrap(json: SchemaJson): SchemaJson {
  return json.kind === "optional" ? unwrap(json.of) : json;
}

function coerceOne(json: SchemaJson, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (json.kind === "number") {
    const n = Number(value);
    return value.trim() !== "" && Number.isFinite(n) ? n : value;
  }
  if (json.kind === "boolean") return value === "true" ? true : value === "false" ? false : value;
  return value;
}

/** Path and query values arrive as strings. Turns the ones whose field wants a number or a boolean into one, and
 * wraps a lone value in a list where the field is an array. What doesn't convert is left to fail validation. */
export function coerceStrings(json: SchemaJson, input: Record<string, unknown>, records: RecordTable = {}): Record<string, unknown> {
  const root = unwrap(json);
  const fields = root.kind === "object" ? root.fields : root.kind === "record" ? records[root.name] : undefined;
  if (!fields) return input;
  const out: Record<string, unknown> = { ...input };
  for (const [key, raw] of Object.entries(input)) {
    const field = fields[key] && unwrap(fields[key]);
    if (!field) continue;
    if (field.kind === "array") {
      const list = Array.isArray(raw) ? raw : [raw];
      out[key] = list.map((item) => coerceOne(unwrap(field.of), item));
    } else out[key] = coerceOne(field, raw);
  }
  return out;
}
