import type { FieldDecl, FieldType } from "thixo-thx/contract";
import type { DataTarget, Fields, Plugin, PluginVersion, RecordDef, User } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { chainOf, versionOf, visiblePlugin } from "./access.js";
import { fail, missingScopes } from "./errors.js";
import { newId } from "./hash.js";
import { DATA_READ, DATA_WRITE, findRecord } from "./scopes.js";
import { STORE_SINGLETON_ID, type DataRecord, type DataScope, type DataServices, type DataTargetRef } from "./types.js";

const MAX_IDS = 500;
const ADDRESS_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "data:"]);

/** What the broker marks as an address on the wire: `{ "$url": "https://..." }`. A plain string is never an address. */
export function isAddress(value: string): boolean {
  if (!value || /[\u0000-\u001f\u007f\s]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    return ADDRESS_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

interface Issue {
  path: string;
  message: string;
}

function decode(type: FieldType, value: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const no = (message: string) => ({ ok: false as const, message });
  switch (type) {
    case "string": return typeof value === "string" ? { ok: true, value } : no("must be a string");
    case "number": return typeof value === "number" && Number.isFinite(value) ? { ok: true, value } : no("must be a number");
    case "boolean": return typeof value === "boolean" ? { ok: true, value } : no("must be true or false");
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(Date.parse(value))) return no("must be an ISO date string");
      return { ok: true, value: new Date(value) };
    }
    case "url": {
      if (typeof value === "string") return no('must be an address the shell marked as one: { "$url": "..." }, not a plain string');
      const keys = value && typeof value === "object" ? Object.keys(value) : [];
      const address = (value as { $url?: unknown } | null)?.$url;
      if (keys.length !== 1 || typeof address !== "string") return no('must be { "$url": "..." }');
      return isAddress(address) ? { ok: true, value: address } : no("is not an address a plugin may hold (http, https, mailto, tel, data, or a path starting with /)");
    }
    case "string[]": return Array.isArray(value) && value.every((v) => typeof v === "string") ? { ok: true, value } : no("must be a list of strings");
    case "number[]": return Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v)) ? { ok: true, value } : no("must be a list of numbers");
  }
}

function encode(type: FieldType, value: unknown): unknown {
  if (type === "date") {
    const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
  }
  if (type === "url") return typeof value === "string" ? { $url: value } : undefined;
  return value;
}

interface Opened {
  plugin: Plugin;
  version: PluginVersion;
  declared: FieldDecl[];
  chain: string[];
  record?: RecordDef;
}

export function createDataServices(ctx: ServerContext): DataServices {
  const data = ctx.adapters.data;

  /** D6, D11, D12, P3: everything that must hold before one data call touches anything. */
  async function open(user: User, scope: DataScope, need: "read" | "write", target: DataTargetRef): Promise<Opened> {
    const plugin = await visiblePlugin(ctx, user, scope.plugin);
    const version = await versionOf(ctx, { plugin: scope.plugin, number: scope.version });
    const dataScope = need === "read" ? DATA_READ : DATA_WRITE;
    missingScopes(ctx, user, [dataScope], `${need === "read" ? "Reading" : "Writing"} plugin data`);

    let declared: FieldDecl[] | undefined;
    let record: RecordDef | undefined;
    if (target.store !== undefined) {
      declared = version.manifest.data.stores[target.store];
      if (!declared) fail(ctx, 400, `Version ${scope.version} of ${plugin.name} declares no store "${target.store}"`, "undeclared_store");
    } else if (target.record !== undefined) {
      declared = version.manifest.data.annotations[target.record];
      if (!declared) fail(ctx, 400, `Version ${scope.version} of ${plugin.name} declares no fields on "${target.record}"`, "undeclared_record");
      record = findRecord(ctx, target.record);
      if (!record) fail(ctx, 400, `The app has no record "${target.record}"`, "unknown_record");
      missingScopes(ctx, user, record.read, `Annotating ${record.name}`);
    } else fail(ctx, 400, "Name a store or a record", "bad_request");

    const author = { id: plugin.author, scopes: await ctx.scopesOf(plugin.author) };
    const authorNeeds = [dataScope, ...(record?.read ?? [])];
    const authorMissing = ctx.missing(author, authorNeeds);
    if (authorMissing.length) {
      fail(ctx, 403, `${plugin.name}'s author no longer holds ${authorMissing.join(", ")}, so the plugin can't use data`, "author_cap", { missingScopes: authorMissing });
    }
    return { plugin, version, declared, chain: await chainOf(ctx, plugin), record };
  }

  async function groupOf(record: RecordDef, id: string, user: User): Promise<string | null> {
    if (record.group === "user") return user.id;
    if (typeof record.group === "function") return (await record.group(id, user)) ?? null;
    return null;
  }

  /** A13: Thixo can't see the app's records, so it asks. */
  async function readable(record: RecordDef, id: string, user: User): Promise<boolean> {
    return record.canRead ? Boolean(await record.canRead(id, user)) : true;
  }

  async function targetFor(o: Opened, user: User, ref: DataTargetRef, id: string): Promise<DataTarget> {
    if (ref.store !== undefined) return { kind: "store", store: ref.store, id, owner: user.id };
    if (!(await readable(o.record!, id, user))) fail(ctx, 404, `There is no ${o.record!.name} ${id}`, "record_not_found");
    return { kind: "annotation", record: o.record!.name, id, group: await groupOf(o.record!, id, user) };
  }

  function shape(o: Opened, fields: Fields): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const decl of o.declared) {
      if (!(decl.name in fields)) continue;
      const value = encode(decl.type, fields[decl.name]);
      if (value !== undefined) out[decl.name] = value;
    }
    return out;
  }

  function convert(o: Opened, input: Record<string, unknown>): Fields {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail(ctx, 400, "fields must be an object", "bad_request");
    const entries = Object.entries(input);
    if (!entries.length) fail(ctx, 400, "Send at least one field to change", "bad_request");
    const issues: Issue[] = [];
    const out: Fields = {};
    for (const [name, value] of entries) {
      const decl = o.declared.find((d) => d.name === name);
      if (!decl) {
        issues.push({ path: name, message: `version ${o.version.number} of ${o.plugin.name} does not declare "${name}"` });
        continue;
      }
      if (value === null || value === undefined) {
        issues.push({ path: name, message: "can't be cleared yet. Leave it out of the patch." });
        continue;
      }
      const decoded = decode(decl.type, value);
      if (decoded.ok) out[name] = decoded.value;
      else issues.push({ path: name, message: decoded.message });
    }
    if (issues.length) fail(ctx, 400, `Refused: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`, "invalid_fields", { issues });
    return out;
  }

  async function readRecords(o: Opened, user: User, ref: DataTargetRef, ids: string[]): Promise<DataRecord[]> {
    const targets: DataTarget[] = [];
    const kept: string[] = [];
    for (const id of ids) {
      if (ref.record !== undefined && !(await readable(o.record!, id, user))) continue;
      targets.push(await targetFor(o, user, ref, id));
      kept.push(id);
    }
    if (!targets.length) return [];
    const rows = await data.readMany(targets, o.chain);
    return kept.map((id, i) => ({ id, fields: shape(o, rows[i] ?? {}) }));
  }

  return {
    async read(user, input) {
      const o = await open(user, input, "read", input);
      const id = input.id ?? (input.store !== undefined ? STORE_SINGLETON_ID : undefined);
      if (!id) fail(ctx, 400, "Name the record's id", "bad_request");
      const target = await targetFor(o, user, input, id);
      return { id, fields: shape(o, await data.read(target, o.chain)) };
    },

    async readMany(user, input) {
      const o = await open(user, input, "read", input);
      if (!Array.isArray(input.ids) || input.ids.length > MAX_IDS || input.ids.some((i) => typeof i !== "string")) {
        fail(ctx, 400, `Send up to ${MAX_IDS} ids`, "bad_request");
      }
      return readRecords(o, user, input, input.ids);
    },

    async patch(user, input) {
      const o = await open(user, input, "write", input);
      if (input.create && input.id) fail(ctx, 400, "Send an id or create, not both", "bad_request");
      if (input.create && input.record !== undefined) fail(ctx, 400, "Annotations belong to the app's records and can't be created", "bad_request");
      const id = input.create ? newId("rec") : (input.id ?? (input.store !== undefined ? STORE_SINGLETON_ID : undefined));
      if (!id) fail(ctx, 400, "Name the record's id", "bad_request");
      const fields = convert(o, input.fields);
      const target = await targetFor(o, user, input, id);
      await data.patch(target, input.plugin, fields);
      return { id, fields: shape(o, await data.read(target, o.chain)) };
    },

    async list(user, input) {
      const o = await open(user, input, "read", { store: input.store });
      const ids = await data.listStore(input.store, user.id, o.chain);
      return readRecords(o, user, { store: input.store }, ids);
    },

    async remove(user, input) {
      const o = await open(user, input, "write", { store: input.store });
      await data.removeStoreRecord(input.store, input.id, user.id, o.chain);
    },

    async removeField(user, input) {
      missingScopes(ctx, user, ["thixo.data.admin"], "Deleting a field's data");
      const plugin = await visiblePlugin(ctx, user, input.plugin);
      const declaredOnce = (await data.listVersions(plugin.id)).some((v) => {
        const fields = input.store !== undefined ? v.manifest.data.stores[input.store] : v.manifest.data.annotations[input.record ?? ""];
        return fields?.some((f) => f.name === input.field);
      });
      if (!declaredOnce) fail(ctx, 404, `No version of ${plugin.name} ever declared "${input.field}" there`, "unknown_field");
      const where = input.store !== undefined ? { store: input.store } : { record: findRecord(ctx, input.record!)?.name ?? input.record! };
      await data.removeField(plugin.id, where, input.field);
    },

    async recordDeleted(record, id) {
      await data.removeAnnotations(findRecord(ctx, record)?.name ?? record, id);
    },
  };
}
