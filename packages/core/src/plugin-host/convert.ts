import type { FieldDecl, SchemaJson, Url } from "thixo-thx/contract";

/** The part of a runtime that mints and reads addresses. */
export interface UrlMint {
  url(address: string): Url;
  isUrl(value: unknown): value is Url;
  unwrapUrl(url: Url): string;
}

export type RecordFields = Record<string, Record<string, SchemaJson>>;

export interface Issue {
  path: string;
  message: string;
}

export class ConvertError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "ConvertError";
    this.issues = issues;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function kindOf(value: unknown, rt: UrlMint): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (rt.isUrl(value)) return "url";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Map);
}

function fieldsOf(json: SchemaJson, records: RecordFields): Record<string, SchemaJson> | undefined {
  if (json.kind === "object") return json.fields;
  if (json.kind === "record") return records[json.name];
  return undefined;
}

/** A plugin's value, checked against `json`, in the form the shell and the wire use: a `Url` becomes its address,
 * and a url field takes only a `Url`, never a string (L7). Unknown object keys are dropped. Throws `ConvertError`
 * listing every problem. */
export function pluginToHost(json: SchemaJson | undefined, value: unknown, rt: UrlMint, records: RecordFields = {}): unknown {
  if (!json) return value === undefined ? undefined : plainCopy(value, rt);
  const issues: Issue[] = [];
  const out = walkIn(json, value, rt, records, "", issues);
  if (issues.length) throw new ConvertError(issues);
  return out;
}

function walkIn(json: SchemaJson, value: unknown, rt: UrlMint, records: RecordFields, path: string, issues: Issue[]): unknown {
  const fail = (message: string) => {
    issues.push({ path: path || "value", message });
    return undefined;
  };
  switch (json.kind) {
    case "string":
      return typeof value === "string" ? value : fail(`expected a string, got ${kindOf(value, rt)}`);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : fail(`expected a number, got ${kindOf(value, rt)}`);
    case "boolean":
      return typeof value === "boolean" ? value : fail(`expected a boolean, got ${kindOf(value, rt)}`);
    case "date":
      if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
      return fail(`expected a Date, got ${kindOf(value, rt)}`);
    case "url":
      if (rt.isUrl(value)) return rt.unwrapUrl(value);
      return fail(`expected a Url, got ${kindOf(value, rt)}: a url field never takes a string`);
    case "unknown":
      return plainCopy(value, rt);
    case "optional":
      return value === undefined || value === null ? undefined : walkIn(json.of, value, rt, records, path, issues);
    case "array": {
      if (!Array.isArray(value)) return fail(`expected an array, got ${kindOf(value, rt)}`);
      return value.map((item, i) => walkIn(json.of, item, rt, records, `${path}[${i}]`, issues));
    }
    case "object":
    case "record": {
      const fields = fieldsOf(json, records);
      if (!fields) return fail(`unknown record ${(json as { name: string }).name}`);
      if (!isPlainObject(value)) return fail(`expected an object, got ${kindOf(value, rt)}`);
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        const here = path ? `${path}.${key}` : key;
        const v = value[key];
        if ((v === undefined || v === null) && field.kind !== "optional" && field.kind !== "unknown") {
          issues.push({ path: here, message: "is required" });
          continue;
        }
        const converted = walkIn(field, v, rt, records, here, issues);
        if (converted !== undefined) out[key] = converted;
      }
      return out;
    }
  }
}

/** A copy of plain data with every `Url` replaced by its address. Functions and other objects are dropped. */
function plainCopy(value: unknown, rt: UrlMint): unknown {
  if (value === null || typeof value !== "object") return typeof value === "function" || typeof value === "symbol" ? undefined : value;
  if (rt.isUrl(value)) return rt.unwrapUrl(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map((v) => plainCopy(v, rt));
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const c = plainCopy(v, rt);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/** A value from the shell or the wire, shaped by `json` for a plugin: url fields become `Url`s, ISO strings in date
 * fields become `Date`s, and fields the schema does not declare are dropped. Strings that are not where a url field
 * is stay strings. Hand the result to `rt.toThx`. */
export function hostToPlugin(json: SchemaJson | undefined, value: unknown, rt: UrlMint, records: RecordFields = {}): unknown {
  if (value === null || value === undefined) return undefined;
  if (!json) return plainCopy(value, rt);
  switch (json.kind) {
    case "url":
      if (typeof value === "string") return rt.url(value);
      if (isWireUrl(value)) return rt.url(value.$url);
      return undefined;
    case "date": {
      if (value instanceof Date) return new Date(value.getTime());
      if (typeof value === "string" && ISO_DATE.test(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d;
      }
      return undefined;
    }
    case "string":
    case "number":
    case "boolean":
      return typeof value === json.kind ? value : undefined;
    case "unknown":
      return plainCopy(value, rt);
    case "optional":
      return hostToPlugin(json.of, value, rt, records);
    case "array":
      return Array.isArray(value) ? value.map((v) => hostToPlugin(json.of, v, rt, records)) : undefined;
    case "object":
    case "record": {
      const fields = fieldsOf(json, records);
      if (!fields || !isPlainObject(value)) return undefined;
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(fields)) {
        const v = hostToPlugin(field, value[key], rt, records);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
  }
}

function isWireUrl(value: unknown): value is { $url: string } {
  return isPlainObject(value) && typeof value.$url === "string" && Object.keys(value).length === 1;
}

/** A plugin's patch for the wire, checked against the fields its version declares (D6): a date as an ISO string, a
 * url as `{ $url }`. A field the version does not declare, a string for a url field, or a value of the wrong type is
 * refused. `undefined` clears nothing and is left out. */
export function fieldsToWire(decls: FieldDecl[], patch: unknown, rt: UrlMint): Record<string, unknown> {
  if (!isPlainObject(patch)) throw new ConvertError([{ path: "fields", message: `expected an object, got ${kindOf(patch, rt)}` }]);
  const byName = new Map(decls.map((d) => [d.name, d.type]));
  const issues: Issue[] = [];
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(patch)) {
    const type = byName.get(name);
    if (!type) {
      issues.push({ path: name, message: "is not a field this plugin version declares" });
      continue;
    }
    if (value === undefined) continue;
    const bad = (message: string) => issues.push({ path: name, message });
    switch (type) {
      case "string":
      case "number":
      case "boolean":
        if (typeof value !== type || (type === "number" && !Number.isFinite(value))) bad(`expected a ${type}, got ${kindOf(value, rt)}`);
        else out[name] = value;
        break;
      case "date":
        if (value instanceof Date && !Number.isNaN(value.getTime())) out[name] = value.toISOString();
        else bad(`expected a Date, got ${kindOf(value, rt)}`);
        break;
      case "url":
        if (rt.isUrl(value)) out[name] = { $url: rt.unwrapUrl(value) };
        else bad(`expected a Url, got ${kindOf(value, rt)}: a url field never takes a string`);
        break;
      case "string[]":
      case "number[]": {
        const item = type === "string[]" ? "string" : "number";
        if (Array.isArray(value) && value.every((v) => typeof v === item)) out[name] = [...value];
        else bad(`expected a list of ${item}s`);
        break;
      }
    }
  }
  if (issues.length) throw new ConvertError(issues);
  return out;
}

/** Fields from the wire, for a plugin: only the fields its version declares, each of its declared type. A url field
 * is read only from `{ $url }`; a plain string there is dropped. */
export function fieldsFromWire(decls: FieldDecl[], wire: unknown, rt: UrlMint): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(wire)) return out;
  for (const { name, type } of decls) {
    const value = wire[name];
    if (value === undefined || value === null) continue;
    switch (type) {
      case "string":
      case "number":
      case "boolean":
        if (typeof value === type) out[name] = value;
        break;
      case "date":
        if (typeof value === "string" && ISO_DATE.test(value)) {
          const d = new Date(value);
          if (!Number.isNaN(d.getTime())) out[name] = d;
        }
        break;
      case "url":
        if (isWireUrl(value)) out[name] = rt.url(value.$url);
        break;
      case "string[]":
      case "number[]": {
        const item = type === "string[]" ? "string" : "number";
        if (Array.isArray(value) && value.every((v) => typeof v === item)) out[name] = [...value];
        break;
      }
    }
  }
  return out;
}

/** Structural equality over plugin values, for hook dependencies: values handed across the boundary are fresh copies
 * on every render, so identity says nothing. Functions are equal to each other. */
export function sameValue(a: unknown, b: unknown, rt: UrlMint): boolean {
  if (a === b) return true;
  if (typeof a === "function" && typeof b === "function") return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (rt.isUrl(a) || rt.isUrl(b)) return rt.isUrl(a) && rt.isUrl(b) && rt.unwrapUrl(a) === rt.unwrapUrl(b);
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !sameValue(v, b.get(k), rt)) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], rt));
}
