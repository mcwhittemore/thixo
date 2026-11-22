// The contract between the parts of core, and between core and the adapter packages. Types only.
// The data shapes follow docs/06-data-model.md and the adapters docs/07-portability.md.

import type { DataSchema, FieldDecl, Manifest, PluginMeta, SchemaJson, SourceFiles, CompileEnv, CompileResult } from "thixo-thx/contract";

export type { DataSchema, FieldDecl, Manifest, PluginMeta, SchemaJson, SourceFiles, CompileEnv, CompileResult };

export type UserId = string;
export type PluginId = string;
export type ReleaseId = string;
export type SlotPath = string;

/** The author of every default plugin. It holds every scope. */
export const IMPLEMENTOR: UserId = "implementor";

/** Thixo's own scopes, held like any other (D11, W2). */
export const THIXO_SCOPES = {
  "thixo.data.read": "Read plugin data",
  "thixo.data.write": "Write plugin data",
  "thixo.plugins.author": "Ask the authoring chat for a plugin",
  "thixo.plugins.share": "Share a plugin with other users",
  "thixo.plugins.promote": "Propose a plugin as a default for everyone",
  "thixo.data.admin": "Delete a field's data from a plugin",
} as const;

// ---- The app, as the server sees it ----

export interface User {
  id: UserId;
  scopes: string[];
  /** Group ids the user belongs to, for annotation grouping (A11). */
  groups?: string[];
}

/** A8. A function is the short form of `{ identify }`. Without `scopesOf`, Thixo uses the scopes it last saw for a
 * user when it issued them a token, which is what the author cap (P3) is checked against. */
export type IdentityAdapter =
  | ((request: Request) => Promise<User | null> | User | null)
  | {
      identify(request: Request): Promise<User | null> | User | null;
      scopesOf?(user: UserId): Promise<string[] | null> | string[] | null;
    };

export interface EndpointDef {
  /** The export name in `api/`. It is the SDK function's name and what a manifest records. */
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Under `/api`, with `:param` segments, such as `/todos/:id`. */
  path: string;
  scopes: string[];
  input?: SchemaJson;
  output?: SchemaJson;
  handler(call: { input: any; user: User; request: Request }): unknown | Promise<unknown>;
}

export interface RecordDef {
  /** The record's name, such as `todo`. */
  name: string;
  /** The export name in `api/`, such as `Todo`. */
  exportName: string;
  read: string[];
  fields: Record<string, SchemaJson>;
  /** A13: does it exist and may this user read it? Default: yes, to a user who holds `read`. */
  canRead?(id: string, user: User): boolean | Promise<boolean>;
  /** A11: who sees an annotation on it. `"user"`: each user their own. `"everyone"` (default). A function returns
   * the group key for this user and record, such as a team id, or null for everyone. */
  group?: "user" | "everyone" | ((id: string, user: User) => string | null | Promise<string | null>);
}

export interface SlotDef {
  name: string;
  /** The export name in `app/slots.ts`, such as `todoDetail`. */
  exportName: string;
  kind: "page" | "panel" | "widget" | "custom";
  /** CSS for the slot's box (S5). The kinds give defaults. */
  size?: { width?: string; height?: string; minHeight?: string; maxHeight?: string };
  context: Record<string, SchemaJson>;
  /** S13: context field to the scopes that read it. */
  contextScopes: Record<string, string[]>;
  emits: Record<string, SchemaJson>;
  /** Names of the child slots a plugin filling this one may place (S13). */
  children: string[];
}

export interface ExposedLibrary {
  /** The specifier a plugin imports, such as `@app/charts`. */
  specifier: string;
  /** Declarations for the agent and the type check. */
  dts: string;
  /** A browser module path in the implementor's project that the shell bundle imports. Its exports are what the
   * plugin gets, wrapped at the boundary. */
  module: string;
}

export interface AppDefinition {
  scopes: Record<string, string>;
  endpoints: EndpointDef[];
  records: RecordDef[];
  slots: SlotDef[];
  libraries: ExposedLibrary[];
}

export interface ThixoConfig {
  identity: IdentityAdapter;
  adapters: Adapters;
  model?: ModelAdapter;
  /** Slot path to the folder name of a default plugin (S9). */
  layout: Record<SlotPath, string>;
  /** Signs tokens (A5). In dev, the CLI makes one and keeps it in `.thixo/`. */
  signingKey?: string;
  /** Turns on `POST /_thixo/authoring/tool` for an outside coding agent. A request must carry it in the
   * `x-thixo-agent-key` header. `thixo dev` generates one into `.thixo/agent-key` and sets it here. Leave it unset in
   * production: the route is then off. */
  agentKey?: string;
  /** W2. Default: a user who holds `thixo.plugins.promote`. */
  promotion?: PromotionAdapter;
  /** W2: replaces Thixo's authoring flow. */
  authoring?: AuthoringFlow;
  /** Outside hosts plugins may load images, fonts and styles from. Default none. */
  addressHosts?: string[];
  /** Outside hosts a plugin's written-out links (`<a href>`) may point to. Default none. */
  linkHosts?: string[];
  libraries?: ExposedLibrary[];
}

// ---- Adapters (X4) ----

export interface CodeAdapter {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** G3: proposes a change to the implementor's project. Locally it writes the files into the working tree. */
  openChange(change: { title: string; files: Record<string, string>; remove?: string[] }): Promise<{ where: string }>;
}

export interface BuildAdapter {
  build(files: SourceFiles, env: CompileEnv): Promise<CompileResult>;
  /** The compiler's `verifyOutput`. The plugin route runs it again on stored code before serving it (P7). */
  verify?(code: string): { ok: true } | { ok: false; errors: string[] } | Promise<{ ok: true } | { ok: false; errors: string[] }>;
}

export interface Plugin {
  id: PluginId;
  name: string;
  description: string;
  author: UserId;
  visibility: "personal" | "shared";
  forkedFrom?: PluginVersionRef;
  readsParentData: boolean;
}

export interface PluginVersionRef {
  plugin: PluginId;
  number: number;
}

export interface PluginVersion {
  plugin: PluginId;
  number: number;
  /** Code adapter key of the source: a JSON object of path to text. */
  source: string;
  sourceHash: string;
  /** Code adapter key of the compiled module. */
  compiled: string;
  manifest: Manifest;
  createdBy: UserId;
  createdAt: string;
}

export interface Release {
  id: ReleaseId;
  deployment: string;
  plugins: PluginId[];
  layout: Record<SlotPath, PluginVersionRef>;
  createdAt: string;
}

/** What plugin data is attached to. A store record belongs to one user; an annotation to one of the app's records. */
export type DataTarget =
  | { kind: "store"; store: string; id: string; owner: UserId }
  | { kind: "annotation"; record: string; id: string; group: string | null };

export type Fields = Record<string, unknown>;

/** Holds registry records, layouts, releases and plugin data. It speaks plugin data, not documents. */
export interface DataAdapter {
  migrate(): Promise<void>;

  // Registry
  putPlugin(plugin: Plugin): Promise<void>;
  getPlugin(id: PluginId): Promise<Plugin | null>;
  listPlugins(filter?: { visibility?: "personal" | "shared"; author?: UserId }): Promise<Plugin[]>;
  /** Stores a version with the next number for its plugin, atomically, and returns it. */
  addVersion(version: Omit<PluginVersion, "number">): Promise<PluginVersion>;
  getVersion(ref: PluginVersionRef): Promise<PluginVersion | null>;
  listVersions(plugin: PluginId): Promise<PluginVersion[]>;
  findVersionByHash(plugin: PluginId, sourceHash: string): Promise<PluginVersion | null>;

  // Releases and layouts
  putRelease(release: Release): Promise<void>;
  latestRelease(): Promise<Release | null>;
  getLayoutChanges(user: UserId): Promise<Record<SlotPath, PluginVersionRef>>;
  setLayoutSlot(user: UserId, slot: SlotPath, ref: PluginVersionRef | null): Promise<void>;

  // Users, for the author cap when the identity adapter has no `scopesOf`
  rememberUser(user: User): Promise<void>;
  recallUser(id: UserId): Promise<User | null>;

  // Plugin data. `chain` is nearest first: the plugin, its parent, and so on (D10).
  read(target: DataTarget, chain: PluginId[]): Promise<Fields>;
  readMany(targets: DataTarget[], chain: PluginId[]): Promise<Fields[]>;
  /** Atomic on one target. Writes land in `plugin`'s layer (D6, D10). */
  patch(target: DataTarget, plugin: PluginId, fields: Fields): Promise<void>;
  /** The ids of one user's records in a store, across the chain. */
  listStore(store: string, owner: UserId, chain: PluginId[]): Promise<string[]>;
  /** D13: a user deletes their own store record, in every layer of the chain they can reach. */
  removeStoreRecord(store: string, id: string, owner: UserId, chain: PluginId[]): Promise<void>;
  /** D7: removes one field's data from one plugin's layer. `scope` names the store or the record it is on. */
  removeField(plugin: PluginId, scope: { store: string } | { record: string }, field: string): Promise<void>;
  /** A13: the app says a record was deleted. */
  removeAnnotations(record: string, id: string): Promise<void>;
}

export interface Adapters {
  code: CodeAdapter;
  data: DataAdapter;
  build: BuildAdapter;
}

export interface PromotionAdapter {
  canPromote(user: User, plugin: Plugin): boolean | Promise<boolean>;
}

// ---- Authoring (U1, U4, U5, U6) ----

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for the input. */
  input: Record<string, unknown>;
}

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: { id: string; name: string; input: unknown }[] }
  | { role: "tool"; id: string; name: string; output: string };

export interface AgentTurn {
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "done" };

/** One model call. The loop, the tools and the prompt are Thixo's and the same on every provider. */
export interface ModelAdapter {
  run(turn: AgentTurn): AsyncIterable<AgentEvent>;
}

/** W2: an implementor's own flow. It gets Thixo's tools and decides how to use them. */
export interface AuthoringFlow {
  system?(defaults: string): string;
  tools?(defaults: AgentTool[]): AgentTool[];
}

// ---- What the shell asks the server (the HTTP surface under /_thixo) ----

export interface AppInfo {
  scopes: Record<string, string>;
  /** `input` and `output` let the broker validate a plugin's input and turn url and date fields of a reply into
   * `Url`s and `Date`s. */
  endpoints: { name: string; method: string; path: string; scopes: string[]; input?: SchemaJson; output?: SchemaJson }[];
  /** `fields` resolves a `{ kind: "record" }` schema. */
  records: { name: string; exportName: string; read: string[]; fields: Record<string, SchemaJson> }[];
  slots: SlotDef[];
  libraries: string[];
  /** The config's `addressHosts`. The shell hands them to each plugin's runtime, which refuses to load an outside
   * address on any other host, even a `Url` the app handed in (L4, L7). */
  addressHosts: string[];
}

export interface TokenReply {
  token: string;
  expiresAt: string;
  user: User;
}

/** What the broker needs to hold one plugin version to its manifest and its author (P1, P3, P4). */
export interface PluginLoad {
  plugin: Plugin;
  version: number;
  manifest: Manifest;
  /** Where the compiled module is served. */
  code: string;
  /** Endpoints in the manifest whose scopes the author holds. The broker refuses the rest (P3). */
  authorCan: string[];
  /** Endpoints in the manifest the current user can call (P4). */
  userCan: string[];
  /** Whether the author holds the plugin data scopes. */
  authorData: { read: boolean; write: boolean };
}

export interface PluginSummary {
  plugin: Plugin;
  latest: number;
  manifest: Manifest;
  /** G5: plain sentences from the manifest, such as "Reads todos". */
  summary: string[];
  requiredScopes: string[];
  optionalScopes: string[];
  isDefault: boolean;
  /** The version the newest release serves, for a default plugin the layout names. It can be older than `latest`
   * after a rollback. */
  defaultVersion?: number;
}

export interface LayoutReply {
  defaults: Record<SlotPath, PluginVersionRef>;
  changes: Record<SlotPath, PluginVersionRef>;
  /** `changes` over `defaults`. */
  resolved: Record<SlotPath, PluginVersionRef>;
}

// ---- Plugin data on the wire: POST /_thixo/data/* ----

/** A `t.url()` field's value on the wire, both ways. A plain string is never accepted for a url field (L7). */
export interface WireUrl {
  $url: string;
}

/** Which plugin version is asking. The server works out the chain and checks fields against this version (D6). */
export interface DataCaller {
  plugin: PluginId;
  version: number;
}

/** One record of plugin data: a store record of the current user's, or an annotation on one of the app's records. */
export type DataAt = { store: string; id: string } | { record: string; id: string };

/** Field values on the wire: dates as ISO strings, urls as `WireUrl`. */
export type WireFields = Record<string, unknown>;

/** The body of each `POST /_thixo/data/<op>`, by op. `read` answers `{ fields: WireFields }`, `read-many`
 * `{ fields: WireFields[] }` in the order asked, `list` `{ ids: string[] }`, and `patch` and `remove` 204. */
export interface DataBodies {
  read: DataCaller & { at: DataAt };
  "read-many": DataCaller & { at: DataAt[] };
  patch: DataCaller & { at: DataAt; fields: WireFields };
  list: DataCaller & { store: string };
  remove: DataCaller & { store: string; id: string };
}

/** D4: what a new version changes about data, next to the one before it. */
export interface SchemaDiff {
  added: { scope: string; field: FieldDecl }[];
  noLongerShown: { scope: string; field: FieldDecl }[];
  /** D8. A version with any of these is rejected. */
  typeChanged: { scope: string; field: string; from: string; to: string }[];
}

export interface SubmitReply {
  plugin: Plugin;
  version: number;
  manifest: Manifest;
  summary: string[];
  diff: SchemaDiff;
}
