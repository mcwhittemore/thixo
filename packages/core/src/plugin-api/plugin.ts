/** `thixo/plugin`: what a plugin's component is made of. The shell's plugin host implements it. The compiler checks
 * a plugin against this text, so the signatures here are the contract (not React's: react is not importable). */
export const PLUGIN_DTS = `// thixo/plugin, for plugins.
//
//   export default definePlugin(todoDetail, { name: "Due dates", description: "..." }, function DueDate({ context, emit }) {
//     const [dates, patchDates] = useAnnotation(due, context.todoId);
//     ...
//   });
//
// definePlugin is the default export of plugin.thx. Its second argument must be a literal.

export {};

// ---- Handles. These are types only: a plugin gets them from @app/slots, @app/sdk and data.thx. ----

interface SlotHandle<Context, Emits> {
  readonly __thixoSlotContext: Context;
  readonly __thixoSlotEmits: Emits;
}

interface AnnotationDecl<Fields> {
  readonly __thixoAnnotation: Fields;
}

interface StoreDecl<Fields> {
  readonly __thixoStore: Fields;
}

/** Plugin data, as read: every field may be missing, because nobody may have written it yet (D5). */
type Stored<Fields> = { [K in keyof Fields]?: Fields[K] };

/** A write: only the fields given are changed (D6). */
type Patch<Fields> = { [K in keyof Fields]?: Fields[K] };

// ---- The component ----

/** What the slot's contract gives the component. emit has one function per event the slot declares (S11). */
export interface PluginProps<Context, Emits> {
  context: Context;
  emit: { [K in keyof Emits]: (payload: Emits[K]) => void };
}

export interface PluginMeta {
  /** What the plugin is called in the registry. */
  name: string;
  /** One or two sentences a person reads before using it. */
  description: string;
  /** Only on a default plugin's folder: the id it publishes to. */
  id?: string;
}

/** What definePlugin returns. Export it as the default export of plugin.thx. */
export interface PluginDefinition {
  readonly __thixoPlugin: true;
}

/** Fills a slot. The slot decides the context and events: both are typed from it. */
export function definePlugin<Context, Emits>(
  slot: SlotHandle<Context, Emits>,
  meta: PluginMeta,
  component: (props: PluginProps<Context, Emits>) => ThxNode,
): PluginDefinition;

// ---- State ----

/** Like React's. The setter takes a value or a function from the old value to the new one. */
export function useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void];

/** Remembers a computed value until something in deps changes. */
export function useMemo<T>(compute: () => T, deps: unknown[]): T;

/** Runs after render, and again when something in deps changes. Return a function to clean up. */
export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;

// ---- The app's API ----

export interface QueryError {
  message: string;
  /** The HTTP status, when the server answered. */
  status?: number;
}

export interface QueryResult<Data> {
  /** undefined until the first answer, and for an optional endpoint the user can't call. */
  data: Data | undefined;
  error: QueryError | undefined;
  loading: boolean;
  /** Asks again. */
  refresh: () => void;
}

/** Calls an endpoint from @app/sdk or @app/sdk/optional when the component renders, and again after refresh().
 * data has the endpoint's output type. For an optional endpoint the user can't call, nothing loads (P2, P4). */
export function useQuery<Output>(endpoint: () => Promise<Output>): QueryResult<Output>;
export function useQuery<Input, Output>(endpoint: (input: Input) => Promise<Output>, input: Input): QueryResult<Output>;

/** True when the user can call the endpoint. Use it to disable what they can't do (P4). */
export function useCan(endpoint: (...args: never[]) => unknown): boolean;

// ---- Plugin data (see thixo/data) ----

/** The plugin's annotation on one record, and a function to change it. The first is undefined while loading. */
export function useAnnotation<Fields>(
  decl: AnnotationDecl<Fields>,
  recordId: string,
): [Stored<Fields> | undefined, (patch: Patch<Fields>) => Promise<void>];

/** Annotations on many records in one read: a Map from record id to its fields. */
export function useAnnotations<Fields>(decl: AnnotationDecl<Fields>, recordIds: string[]): Map<string, Stored<Fields>>;

/** The user's one record in a store, and a function to change it. */
export function useStore<Fields>(
  decl: StoreDecl<Fields>,
): [Stored<Fields> | undefined, (patch: Patch<Fields>) => Promise<void>];

/** A store with many records per user. create returns the new record's id. */
export function useStoreList<Fields>(decl: StoreDecl<Fields>): {
  records: ({ id: string } & Stored<Fields>)[];
  create: (fields: Patch<Fields>) => Promise<string>;
  patch: (id: string, patch: Patch<Fields>) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

// ---- Child slots and style ----

/** Places a child slot the parent slot's contract declares (S13). context and on are typed by the child. */
export function ChildSlot<Context, Emits>(props: {
  is: SlotHandle<Context, Emits>;
  context: Context;
  on?: { [K in keyof Emits]?: (payload: Emits[K]) => void };
}): JSX.Element;

/** Turns a style object into a class name. The style prop takes the same object. */
export function css(style: { [property: string]: string | number | undefined }): string;
`;
