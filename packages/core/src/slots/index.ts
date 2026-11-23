import type { SlotDef } from "../contract.js";
import { BRAND, type Branded } from "../api/brand.js";
import type { Infer, ObjectOf, Schema, Shape } from "../schema/index.js";

type Size = NonNullable<SlotDef["size"]>;

export interface SlotOptions<C extends Schema | Shape | undefined, E extends Shape | undefined> {
  /** The slot's path, such as `main` or `todo-detail`. A layout names slots by this. */
  name: string;
  /** What the shell passes in: `t.object({...})` or the bare fields. */
  context?: C;
  /** S13: context field to the scopes that read it. A plugin filling the slot requires them. */
  contextScopes?: { [field: string]: string[] };
  /** The events a plugin filling the slot can send back (S11), each with its payload. */
  emits?: E;
  /** Child slots the plugin filling this one may place (S13). */
  children?: (SlotHandle<any, any> | string)[];
  size?: Size;
}

type ContextType<C> = C extends Schema<infer T> ? T : C extends Shape ? ObjectOf<C> : {};
type EmitsType<E> = E extends Shape ? { [K in keyof E]: Infer<E[K]> } : {};

/** A slot, with the types of its context and events carried for a plugin or the shell to read. */
export interface SlotHandle<Context = {}, Emits = {}> extends Branded<"slot"> {
  readonly def: Omit<SlotDef, "exportName">;
  /** Types only. Never present at run time. */
  readonly types?: { context: Context; emits: Emits };
}

export type ContextOf<S> = S extends SlotHandle<infer C, any> ? C : never;
export type EmitsOf<S> = S extends SlotHandle<any, infer E> ? E : never;
/** The handlers a shell passes for the events a slot emits. */
export type SlotEvents<S> = { [K in keyof EmitsOf<S>]?: (payload: EmitsOf<S>[K]) => void };
/** The props of the shell's `<Slot>`: `<Slot is={main} context={...} on={{ select }} />`. */
export type SlotProps<S> = { is: S; on?: SlotEvents<S> } & (keyof ContextOf<S> extends never
  ? { context?: ContextOf<S> }
  : { context: ContextOf<S> });

const DEFAULT_SIZE: { [K in SlotDef["kind"]]: Size } = {
  page: { width: "100%", height: "100%" },
  panel: { width: "100%", minHeight: "12rem" },
  widget: { minHeight: "3rem" },
  custom: {},
};

function contextFields(name: string, context: Schema | Shape | undefined): SlotDef["context"] {
  if (context === undefined) return {};
  const schema = context as Schema;
  if (typeof schema.parse === "function" && "json" in schema) {
    if (schema.json.kind !== "object") throw new Error(`slot ${name}: context must be t.object({...}) or a list of fields`);
    return { ...schema.json.fields };
  }
  return Object.fromEntries(Object.entries(context as Shape).map(([k, s]) => [k, s.json]));
}

function make(kind: SlotDef["kind"]) {
  return function <C extends Schema | Shape | undefined = undefined, E extends Shape | undefined = undefined>(
    options: SlotOptions<C, E>,
  ): SlotHandle<ContextType<C>, EmitsType<E>> {
    return {
      [BRAND]: "slot",
      def: {
        name: options.name,
        kind,
        size: { ...DEFAULT_SIZE[kind], ...options.size },
        context: contextFields(options.name, options.context),
        contextScopes: { ...options.contextScopes },
        emits: Object.fromEntries(Object.entries((options.emits ?? {}) as Shape).map(([k, s]) => [k, s.json])),
        children: (options.children ?? []).map((c) => (typeof c === "string" ? c : c.def.name)),
      },
    };
  };
}

/** S5, S10: the implementor defines where plugins go, how big, and what passes through. The kinds give default sizes. */
export const slot = {
  page: make("page"),
  panel: make("panel"),
  widget: make("widget"),
  custom: make("custom"),
};
export { slotPaths, resolveSlotPath, type SlotTree, type SlotPathLookup } from "./paths.js";
