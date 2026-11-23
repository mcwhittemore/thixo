import { createHash } from "node:crypto";
import { collectApp } from "../../src/api/collect.js";
import { endpoint, record, defineScopes } from "../../src/api/index.js";
import { slot } from "../../src/slots/index.js";
import { t } from "../../src/schema/index.js";
import type { Adapters, AuthoringBlock, AuthoringRefusal, BuildAdapter, CodeAdapter, DataAdapter, DataTarget, FetchedAsset, Fields, Plugin, PluginId, PluginVersion, Release, User } from "../../src/contract.js";
import type { CompileEnv, CompileResult, Manifest, SourceFiles } from "thixo-thx/contract";
import { createThixo, type Thixo } from "../../src/server/index.js";
import { tokenFor } from "./client.js";

export function memoryCode(): CodeAdapter & { objects: Map<string, Uint8Array>; changes: { title: string; files: Record<string, string> }[] } {
  const objects = new Map<string, Uint8Array>();
  const changes: { title: string; files: Record<string, string> }[] = [];
  return {
    objects,
    changes,
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async openChange(change) {
      changes.push({ title: change.title, files: change.files });
      return { where: `change-${changes.length}` };
    },
  };
}

const keyOf = (t: DataTarget) => (t.kind === "store" ? `store|${t.store}|${t.owner}|${t.id}` : `annotation|${t.record}|${t.id}|${t.group ?? ""}`);

export function memoryData(): DataAdapter & { layers: Map<string, Map<string, Fields>> } {
  const plugins = new Map<string, Plugin>();
  const versions = new Map<string, PluginVersion[]>();
  const releases: Release[] = [];
  const layouts = new Map<string, Record<string, { plugin: string; number: number }>>();
  const users = new Map<string, User>();
  const layers = new Map<string, Map<string, Fields>>();
  const refusals: AuthoringRefusal[] = [];
  const blocks = new Map<string, AuthoringBlock>();
  const merged = (target: DataTarget, chain: PluginId[]): Fields => {
    const layer = layers.get(keyOf(target));
    const out: Fields = {};
    for (const id of [...chain].reverse()) Object.assign(out, layer?.get(id));
    return out;
  };
  return {
    layers,
    async migrate() {},
    async putPlugin(p) {
      plugins.set(p.id, structuredClone(p));
    },
    async getPlugin(id) {
      return structuredClone(plugins.get(id) ?? null);
    },
    async listPlugins(filter) {
      return [...plugins.values()]
        .filter((p) => (!filter?.visibility || p.visibility === filter.visibility) && (!filter?.author || p.author === filter.author))
        .map((p) => structuredClone(p));
    },
    async addVersion(v) {
      const list = versions.get(v.plugin) ?? [];
      const version = { ...v, number: list.length + 1 };
      list.push(version);
      versions.set(v.plugin, list);
      return structuredClone(version);
    },
    async getVersion(ref) {
      return structuredClone(versions.get(ref.plugin)?.find((v) => v.number === ref.number) ?? null);
    },
    async listVersions(id) {
      return structuredClone(versions.get(id) ?? []);
    },
    async findVersionByHash(id, hash) {
      return structuredClone(versions.get(id)?.find((v) => v.sourceHash === hash) ?? null);
    },
    async putRelease(r) {
      releases.push(structuredClone(r));
    },
    async latestRelease() {
      return structuredClone(releases.at(-1) ?? null);
    },
    async getLayoutChanges(user) {
      return structuredClone(layouts.get(user) ?? {});
    },
    async setLayoutSlot(user, slotPath, ref) {
      const l = layouts.get(user) ?? {};
      if (ref) l[slotPath] = ref;
      else delete l[slotPath];
      layouts.set(user, l);
    },
    async rememberUser(u) {
      users.set(u.id, u);
    },
    async recallUser(id) {
      return users.get(id) ?? null;
    },
    async read(target, chain) {
      return structuredClone(merged(target, chain));
    },
    async readMany(targets, chain) {
      return targets.map((tg) => structuredClone(merged(tg, chain)));
    },
    async patch(target, plugin, fields) {
      const k = keyOf(target);
      const layer = layers.get(k) ?? new Map<string, Fields>();
      layer.set(plugin, { ...layer.get(plugin), ...fields });
      layers.set(k, layer);
    },
    async listStore(store, owner, chain) {
      const ids = new Set<string>();
      for (const [k, layer] of layers) {
        const [kind, s, o, id] = k.split("|");
        if (kind === "store" && s === store && o === owner && chain.some((c) => layer.has(c))) ids.add(id);
      }
      return [...ids];
    },
    async removeStoreRecord(store, id, owner, chain) {
      const layer = layers.get(`store|${store}|${owner}|${id}`);
      for (const c of chain) layer?.delete(c);
    },
    async removeField(plugin, scope, field) {
      for (const [k, layer] of layers) {
        const [kind, name] = k.split("|");
        const matches = "store" in scope ? kind === "store" && name === scope.store : kind === "annotation" && name === scope.record;
        const fields = layer.get(plugin);
        if (matches && fields) delete fields[field];
      }
    },
    async removeAnnotations(record, id) {
      for (const k of [...layers.keys()]) {
        const [kind, name, rid] = k.split("|");
        if (kind === "annotation" && name === record && rid === id) layers.delete(k);
      }
    },
    async addRefusal(r) {
      refusals.push(structuredClone(r));
    },
    async listRefusals(filter) {
      return structuredClone(refusals.filter((r) => (!filter?.user || r.user === filter.user) && (!filter?.since || r.at > filter.since)));
    },
    async putAuthoringBlock(b) {
      blocks.set(b.user, structuredClone(b));
    },
    async getAuthoringBlock(user) {
      return structuredClone(blocks.get(user) ?? null);
    },
    async listAuthoringBlocks() {
      return structuredClone([...blocks.values()].sort((a, b) => (a.at < b.at ? 1 : -1)));
    },
  };
}

// ---- A fake build: the source says what the manifest is ----

export function manifest(over: Partial<Manifest> & { stores?: Manifest["data"]["stores"]; annotations?: Manifest["data"]["annotations"] } = {}): Manifest {
  const { stores = {}, annotations = {}, ...rest } = over;
  const data = { stores, annotations };
  return {
    slot: "todo-detail",
    requiredEndpoints: [],
    optionalEndpoints: [],
    annotates: Object.keys(annotations),
    data,
    schemaHash: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    shellServices: [],
    addresses: [],
    loads: [],
    links: [],
    assets: {},
    libraries: [],
    ...rest,
  };
}

export interface PluginSpec {
  name?: string;
  description?: string;
  id?: string;
  manifest?: Manifest;
  note?: string;
}

/** A plugin's files, in the shape the real build reads: `definePlugin(slot, { ... }, Component)`. The fake build takes
 * the manifest from a trailing comment. */
export function pluginFiles(spec: PluginSpec = {}): SourceFiles {
  const m = spec.manifest ?? manifest();
  return {
    "plugin.thx": [
      `import { definePlugin } from "thixo/plugin";`,
      `export default definePlugin(`,
      `  ${m.slot.replace(/-./g, (s) => s[1].toUpperCase())},`,
      `  {`,
      ...(spec.id ? [`    id: ${JSON.stringify(spec.id)},`] : []),
      `    name: ${JSON.stringify(spec.name ?? "Due dates")},`,
      `    description: ${JSON.stringify(spec.description ?? "Give a todo a due date.")},`,
      `  },`,
      `  function Component() { return null; },`,
      `);`,
      `// @manifest ${JSON.stringify(m)}`,
      `// @note ${spec.note ?? ""}`,
      ``,
    ].join("\n"),
  };
}

export function fakeBuild(): BuildAdapter & { builds: number; brokenOutput: Set<string> } {
  const adapter = {
    builds: 0,
    brokenOutput: new Set<string>(),
    async build(files: SourceFiles, env?: CompileEnv): Promise<CompileResult> {
      adapter.builds++;
      const text = files["plugin.thx"] ?? "";
      if (text.includes("@error")) return { ok: false, errors: [{ file: "plugin.thx", line: 1, column: 1, code: "thx/test", message: "fake error" }] };
      const m = /\/\/ @manifest (.*)/.exec(text);
      if (!m) return { ok: false, errors: [{ file: "plugin.thx", line: 1, column: 1, code: "thx/test", message: "no manifest in the fake source" }] };
      const field = (key: string) => new RegExp(`\\b${key}:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(text)?.[1];
      const meta = { name: JSON.parse(field("name") ?? '""'), description: JSON.parse(field("description") ?? '""'), ...(field("id") ? { id: JSON.parse(field("id")!) } : {}) };
      const sourceHash = createHash("sha256").update(JSON.stringify(Object.entries(files).sort())).digest("hex");
      const manifest = JSON.parse(m[1]) as Manifest;
      // As the real compiler does: a load the build step copied is the app's copy.
      if (env?.assets) manifest.assets = Object.fromEntries((manifest.loads ?? []).filter((a) => env.assets![a]).map((a) => [a, env.assets![a]]));
      return { ok: true, code: `export default function (rt) { /* ${sourceHash} ${JSON.stringify(manifest.assets ?? {})} */ }`, manifest, meta, sourceHash };
    },
    /** Every outside address serves a one-pixel gif. */
    async fetchAsset(): Promise<FetchedAsset> {
      return { ok: true, bytes: Uint8Array.from(Buffer.from("R0lGODlhAQABAAAAACw=", "base64")), contentType: "image/gif" };
    },
    verify(code: string) {
      return code.startsWith("export default function (rt)") && !adapter.brokenOutput.has(code) ? { ok: true as const } : { ok: false as const, errors: ["not from the build"] };
    },
  };
  return adapter;
}

// ---- The app ----

export const appScopes = defineScopes({
  "todos.read": "Read todos",
  "todos.write": "Create and change todos",
  "people.read": "See who a todo is assigned to",
});

export const listTodos = endpoint({ method: "GET", path: "/todos", scopes: ["todos.read"], output: t.array(t.object({ id: t.string() })), handler: () => [] });
export const createTodo = endpoint({ method: "POST", path: "/todos", scopes: ["todos.write"], input: t.object({ title: t.string() }), handler: () => undefined });
export const listAssignees = endpoint({ method: "GET", path: "/assignees", scopes: ["people.read"], handler: () => [] });

export const Todo = record("todo", {
  read: ["todos.read"],
  fields: { id: t.string(), title: t.string() },
  canRead: (id) => id !== "secret",
  group: (id) => (id.startsWith("a-") ? "team-a" : null),
});
export const Note = record("note", { read: ["todos.read"], fields: { id: t.string() }, group: "user" });

export const main = slot.page({ name: "main", children: ["todo-row"] });
export const todoDetail = slot.panel({ name: "todo-detail", context: { todoId: t.string() }, contextScopes: { todoId: ["todos.read"] } });
export const todoRow = slot.widget({ name: "todo-row", context: { todoId: t.string() } });

export const app = collectApp([{ appScopes, listTodos, createTodo, listAssignees, Todo, Note, main, todoDetail, todoRow }], {});

export const USERS: Record<string, User> = {
  ana: { id: "ana", scopes: ["todos.read", "todos.write", "people.read", "thixo.data.read", "thixo.data.write", "thixo.plugins.author", "thixo.plugins.share"], groups: ["team-a"] },
  ben: { id: "ben", scopes: ["todos.read", "thixo.data.read", "thixo.data.write", "thixo.plugins.author"] },
  cy: { id: "cy", scopes: ["people.read"] },
  boss: { id: "boss", scopes: ["todos.read", "thixo.plugins.promote", "thixo.data.admin", "thixo.data.read", "thixo.data.write"] },
};

export interface World {
  thixo: Thixo;
  adapters: Adapters & { code: ReturnType<typeof memoryCode>; data: ReturnType<typeof memoryData>; build: ReturnType<typeof fakeBuild> };
  users: Record<string, User>;
  /** Mutable: change a user's scopes between calls. */
  token(user: string): Promise<string>;
}

export function world(options: { users?: Record<string, User> } = {}): World {
  const users = structuredClone(options.users ?? USERS);
  const adapters = { code: memoryCode(), data: memoryData(), build: fakeBuild() };
  const thixo = createThixo(app, {
    identity: {
      identify: (request) => users[request.headers.get("cookie") ?? ""] ?? null,
      scopesOf: (id) => users[id]?.scopes ?? null,
    },
    adapters,
    layout: {},
    signingKey: "test-key",
  });
  return { thixo, adapters, users, token: (user) => tokenFor(thixo, user) };
}

/** Submits as `user` and fails the test if the build refused. */
export async function submitOk(w: World, user: string, spec: PluginSpec, plugin?: string) {
  const result = await w.thixo.services.registry.submit({ user: w.users[user], files: pluginFiles(spec), plugin });
  if (!result.ok) throw new Error(`submit refused: ${JSON.stringify(result.errors)}`);
  return result;
}
