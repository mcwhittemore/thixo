import type { ThxError, SourceFiles } from "thixo-thx/contract";
import type {
  LayoutReply,
  PluginId,
  PluginLoad,
  PluginSummary,
  PluginVersion,
  PluginVersionRef,
  Plugin,
  SchemaDiff,
  SlotPath,
  SubmitReply,
  User,
} from "../../contract.js";

export type SubmitResult =
  | ({ ok: true } & SubmitReply)
  /** The build failed (`errors` are the compiler's), or a field changed type (D8: `typeChanged` is set and each is also an error). */
  | { ok: false; errors: ThxError[]; typeChanged?: SchemaDiff["typeChanged"] };

export interface VersionInfo {
  number: number;
  sourceHash: string;
  createdBy: string;
  createdAt: string;
  schemaHash: string;
}

export interface PluginDetail extends PluginSummary {
  versions: VersionInfo[];
}

export interface PromotionReply {
  /** Where the change went: locally, the project folder the files were written into. */
  where: string;
  folder: string;
  version: number;
  /** The files written, from the project root, such as plugins/due-dates/plugin.thx. */
  files: string[];
  /** The slot paths the plugin can fill, for the layout line. */
  slotPaths: string[];
  /** The slot paths the config's layout already names this folder in. Empty: it is no default yet. */
  inLayout: string[];
  /** What happened, in a sentence. */
  done: string;
  /** What is left to do for it to fill a slot. */
  next: string;
}

/** Plugin data (docs/06). `store` and `record` name the target: a store, or one of the app's records. */
export type DataTargetRef = { store: string; record?: undefined } | { record: string; store?: undefined };

export interface DataScope {
  /** The plugin making the call, and the version whose manifest declares the fields. */
  plugin: PluginId;
  version: number;
}

/** The id of a store's single record, for a store used as one record per user (`useStore`). */
export const STORE_SINGLETON_ID = "singleton";

export interface DataRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface DataServices {
  read(user: User, input: DataScope & DataTargetRef & { id?: string }): Promise<DataRecord>;
  readMany(user: User, input: DataScope & DataTargetRef & { ids: string[] }): Promise<DataRecord[]>;
  /** Patches the fields. For a store, an omitted `id` is the singleton and `create: true` makes a new id. */
  patch(user: User, input: DataScope & DataTargetRef & { id?: string; create?: boolean; fields: Record<string, unknown> }): Promise<DataRecord>;
  list(user: User, input: DataScope & { store: string }): Promise<DataRecord[]>;
  remove(user: User, input: DataScope & { store: string; id: string }): Promise<void>;
  /** D7. Needs `thixo.data.admin`. */
  removeField(user: User, input: { plugin: PluginId } & DataTargetRef & { field: string }): Promise<void>;
  /** A13: the app says a record was deleted, so its annotations go too. */
  recordDeleted(record: string, id: string): Promise<void>;
}

export interface LayoutServices {
  get(user: User): Promise<LayoutReply>;
  set(user: User, input: { slot: SlotPath; plugin: PluginId; number: number }): Promise<LayoutReply>;
  reset(user: User, slot: SlotPath): Promise<LayoutReply>;
}

/** What the authoring agent, the CLI and a test call directly. Every function takes the user it acts for. */
export interface RegistryServices {
  /** P6: not an HTTP route. */
  submit(input: { user: User; files: SourceFiles; plugin?: PluginId }): Promise<SubmitResult>;
  search(input: { user: User; q?: string; slot?: string }): Promise<PluginSummary[]>;
  getPlugin(input: { user: User; plugin: PluginId }): Promise<PluginDetail>;
  listVersions(input: { user: User; plugin: PluginId }): Promise<PluginVersion[]>;
  getSource(input: { user: User; ref: PluginVersionRef }): Promise<SourceFiles>;
  fork(input: { user: User; ref: PluginVersionRef; empty?: boolean }): Promise<SubmitReply>;
  share(input: { user: User; plugin: PluginId }): Promise<Plugin>;
  promote(input: { user: User; plugin: PluginId; version?: number }): Promise<PromotionReply>;
  load(input: { user: User; ref: PluginVersionRef }): Promise<PluginLoad>;
  chainOf(plugin: PluginId | Plugin): Promise<PluginId[]>;
  layout: LayoutServices;
  data: DataServices;
  /** The compiled module of a version, for the plugin route. Same access rule as `load`. */
  code(input: { user: User; ref: PluginVersionRef }): Promise<string>;
}
