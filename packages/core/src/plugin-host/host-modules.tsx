import * as React from "react";
import type { PluginDefinition, PluginMeta, Runtime, SchemaJson } from "thixo-thx/contract";
import type { AppInfo, PluginLoad, SlotDef } from "../contract.js";
import type { Broker } from "./broker.js";
import { ConvertError, hostToPlugin, pluginToHost, sameValue, type RecordFields } from "./convert.js";
import { createEmit, type Deliver } from "./emit.js";
import { ThixoRefused } from "./refused.js";
import { createServices, type ShellServiceHost } from "./services.js";
import type { ScopedStyles } from "./styles.js";
import { UI_COMPONENTS, tokens } from "./ui.js";

/** How the shell renders a child slot a plugin placed (S13). `context` is in host form; events come back the same
 * way. */
export type ChildSlotView = React.ComponentType<{
  path: string;
  def: SlotDef;
  context: Record<string, unknown>;
  onEvent: Deliver;
}>;

export interface HostModuleOptions {
  rt: Runtime;
  broker: Broker;
  app: AppInfo;
  load: PluginLoad;
  /** The slot this plugin fills, and its path in the layout, such as `main/todo-row`. */
  slot: SlotDef;
  path: string;
  styles: ScopedStyles;
  services: ShellServiceHost;
  signal: AbortSignal;
  ChildSlotView: ChildSlotView;
  /** Exposed libraries (L3) by specifier: the implementor's module, wrapped here at the boundary. */
  libraries?: Record<string, Record<string, unknown>>;
  /** Shared by every plugin on the page: a write through any plugin makes every `useQuery` ask again, so a child
   * slot's view of a todo follows a change its parent made. */
  writes?: Writes;
}

export interface Writes {
  bump(): void;
  subscribe(listener: () => void): () => void;
}

export function createWrites(): Writes {
  const listeners = new Set<() => void>();
  return {
    bump: () => listeners.forEach((l) => l()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface HostModules {
  modules: Record<string, Record<string, unknown>>;
  /** What `definePlugin` was called with, once the plugin's module has run. */
  definition(): PluginDefinition | undefined;
}

/** The single record of a store that `useStore` reads and writes (D2: each user has their own). */
export const STORE_RECORD_ID = "default";

type DataDecl = { $annotation: string } | { $store: string };

function objectSchema(fields: Record<string, SchemaJson>): SchemaJson {
  return { kind: "object", fields };
}

function errorOf(error: unknown): { message: string; status?: number } {
  const e = error as { message?: unknown; status?: unknown };
  return {
    message: typeof e?.message === "string" ? e.message : "The call failed",
    ...(typeof e?.status === "number" && e.status > 0 ? { status: e.status } : {}),
  };
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Builds one plugin's host modules: every value is a language value made with the runtime (`hostFunction`,
 * `hostComponent`, `toThx`). Call it after `createRuntime` and before `instantiate`. */
export function buildHostModules(options: HostModuleOptions): HostModules {
  const { rt, broker, app, load, slot, path, styles, services, signal, ChildSlotView } = options;
  const records: RecordFields = Object.fromEntries(app.records.map((r) => [r.name, r.fields ?? {}]));
  const fn = <F extends (...args: never[]) => unknown>(f: F): F => rt.hostFunction(f);
  let defined: PluginDefinition | undefined;

  // ---- Endpoints, and telling which one a plugin passed to a hook ----

  const endpointNames = new WeakMap<object, string>();
  const probe: { active: boolean; found?: string } = { active: false };
  const endpointFns: Record<string, unknown> = {};
  for (const e of app.endpoints) {
    const raw = (input?: unknown) => {
      if (probe.active) {
        probe.found = e.name;
        return undefined;
      }
      const result = broker.call(e.name, input);
      if (e.method === "GET" || !options.writes) return result;
      return result.then((value) => {
        options.writes?.bump();
        return value;
      });
    };
    const wrapped = fn(raw);
    endpointNames.set(raw, e.name);
    endpointNames.set(wrapped as object, e.name);
    endpointFns[e.name] = wrapped;
  }

  function endpointOf(value: unknown, hook: string): string {
    if (typeof value !== "function") throw new ThixoRefused(hook, "expected a function from @app/sdk");
    const known = endpointNames.get(value);
    if (known) return known;
    probe.active = true;
    probe.found = undefined;
    try {
      (value as () => unknown)();
    } catch {
      // A plugin function that throws is simply not an endpoint.
    } finally {
      probe.active = false;
    }
    if (!probe.found) throw new ThixoRefused(hook, "expected a function from @app/sdk");
    return probe.found;
  }

  // ---- Hook helpers ----

  /** A number that changes only when `deps` changes by value: values cross the boundary as fresh copies. */
  function useDepsVersion(deps: unknown): number {
    const ref = React.useRef<{ deps: unknown; version: number } | null>(null);
    if (ref.current === null) ref.current = { deps, version: 0 };
    else if (!sameValue(ref.current.deps, deps, rt)) ref.current = { deps, version: ref.current.version + 1 };
    return ref.current.version;
  }

  function useStable<F extends (...args: never[]) => unknown>(make: () => F): F {
    const ref = React.useRef<F | null>(null);
    if (ref.current === null) ref.current = fn(make());
    return ref.current;
  }

  function useLatest<T>(value: T): React.RefObject<T> {
    const ref = React.useRef(value);
    ref.current = value;
    return ref;
  }

  function declOf(decl: unknown, hook: string, kind: "$annotation" | "$store"): string {
    const value = (decl as Record<string, unknown> | null)?.[kind];
    if (typeof value !== "string") {
      throw new ThixoRefused(hook, kind === "$store" ? "expected a store() declaration from data.thx" : "expected an annotate() declaration from data.thx");
    }
    return value;
  }

  // ---- thixo/plugin ----

  function makeComponent(component: (props: unknown) => unknown, meta: PluginMeta) {
    function PluginRoot(props: { context: unknown; emit: unknown }) {
      return component({ context: props.context, emit: props.emit }) as React.ReactNode;
    }
    PluginRoot.displayName = `Plugin(${meta.name})`;
    return PluginRoot;
  }

  const plugin = {
    definePlugin: fn((slotHandle: unknown, meta: unknown, component: unknown) => {
      const name = (slotHandle as { $slot?: unknown } | null)?.$slot;
      if (name !== slot.name) throw new ThixoRefused("definePlugin", `the plugin fills "${String(name)}", not "${slot.name}"`);
      if (typeof component !== "function") throw new ThixoRefused("definePlugin", "the third argument must be the component");
      const m = (meta ?? {}) as Record<string, unknown>;
      const pluginMeta: PluginMeta = {
        name: typeof m.name === "string" ? m.name : load.plugin.name,
        description: typeof m.description === "string" ? m.description : "",
        ...(typeof m.id === "string" ? { id: m.id } : {}),
      };
      const Component = rt.hostComponent(makeComponent(component as (props: unknown) => unknown, pluginMeta));
      defined = { slot: slot.name, meta: pluginMeta, component: Component as unknown as PluginDefinition["component"] };
      return defined;
    }),

    useState: fn((initial: unknown) => {
      const [value, setValue] = React.useState(initial);
      const setter = useStable(() => (next: unknown) => {
        if (signal.aborted) return;
        setValue((previous: unknown) => (typeof next === "function" ? (next as (p: unknown) => unknown)(previous) : next));
      });
      return [value, setter];
    }),

    useMemo: fn((compute: unknown, deps: unknown) => {
      const version = useDepsVersion(deps);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return React.useMemo(() => (typeof compute === "function" ? compute() : undefined), [version]);
    }),

    useEffect: fn((effect: unknown, deps?: unknown) => {
      const version = useDepsVersion(deps ?? null);
      const latest = useLatest(effect);
      React.useEffect(
        () => {
          if (signal.aborted || typeof latest.current !== "function") return;
          const cleanup = (latest.current as () => unknown)();
          return typeof cleanup === "function" ? () => void (cleanup as () => unknown)() : undefined;
        },
        deps === undefined ? undefined : [version],
      );
    }),

    useQuery: fn((endpoint: unknown, input?: unknown) => {
      const name = endpointOf(endpoint, "useQuery");
      const skip = broker.refusal(name) === "the user can't call this optional endpoint";
      const version = useDepsVersion(input);
      const [count, setCount] = React.useState(0);
      const [state, setState] = React.useState<{ data?: unknown; error?: { message: string; status?: number }; loading: boolean }>({ loading: !skip });
      const latestInput = useLatest(input);
      React.useEffect(() => options.writes?.subscribe(() => !signal.aborted && setCount((c) => c + 1)), []);
      React.useEffect(() => {
        if (skip) {
          setState({ loading: false });
          return;
        }
        let live = true;
        setState((s) => ({ ...s, loading: true }));
        broker.call(name, latestInput.current).then(
          (data) => live && !signal.aborted && setState({ data, loading: false }),
          (error) => live && !signal.aborted && setState({ error: errorOf(error), loading: false }),
        );
        return () => {
          live = false;
        };
      }, [name, version, count, skip]);
      const refresh = useStable(() => () => {
        if (!signal.aborted) setCount((c) => c + 1);
      });
      return { data: state.data, error: state.error, loading: state.loading, refresh };
    }),

    useCan: fn((endpoint: unknown) => broker.can(endpointOf(endpoint, "useCan"))),

    useAnnotation: fn((decl: unknown, recordId: unknown) => {
      const record = declOf(decl, "useAnnotation", "$annotation");
      const id = String(recordId);
      const [fields, setFields] = React.useState<Record<string, unknown> | undefined>(undefined);
      React.useEffect(() => {
        let live = true;
        setFields(undefined);
        broker.data.read({ record, id }).then(
          (f) => live && setFields(f),
          ignoreFailure,
        );
        return () => {
          live = false;
        };
      }, [record, id]);
      const at = useLatest({ record, id });
      const patch = useStable(() => async (changes: unknown) => {
        const target = at.current;
        await broker.data.patch(target, changes);
        if (!signal.aborted) setFields((previous) => merge(previous, changes));
      });
      return [fields, patch];
    }),

    useAnnotations: fn((decl: unknown, recordIds: unknown) => {
      const record = declOf(decl, "useAnnotations", "$annotation");
      const ids = Array.isArray(recordIds) ? recordIds.map(String) : [];
      const version = useDepsVersion(ids);
      const [map, setMap] = React.useState<Map<string, unknown>>(() => new Map());
      const latestIds = useLatest(ids);
      React.useEffect(() => {
        let live = true;
        const asked = latestIds.current;
        broker.data.readMany(asked.map((id) => ({ record, id }))).then(
          (list) => live && setMap(new Map(asked.map((id, i) => [id, list[i]]))),
          ignoreFailure,
        );
        return () => {
          live = false;
        };
      }, [record, version]);
      return map;
    }),

    useStore: fn((decl: unknown) => {
      const store = declOf(decl, "useStore", "$store");
      const [fields, setFields] = React.useState<Record<string, unknown> | undefined>(undefined);
      React.useEffect(() => {
        let live = true;
        broker.data.read({ store, id: STORE_RECORD_ID }).then(
          (f) => live && setFields(f),
          ignoreFailure,
        );
        return () => {
          live = false;
        };
      }, [store]);
      const patch = useStable(() => async (changes: unknown) => {
        await broker.data.patch({ store, id: STORE_RECORD_ID }, changes);
        if (!signal.aborted) setFields((previous) => merge(previous, changes));
      });
      return [fields, patch];
    }),

    useStoreList: fn((decl: unknown) => {
      const store = declOf(decl, "useStoreList", "$store");
      const [list, setList] = React.useState<Record<string, unknown>[]>([]);
      const [count, setCount] = React.useState(0);
      React.useEffect(() => {
        let live = true;
        (async () => {
          const ids = (await broker.data.list(store)) as string[];
          const fields = await broker.data.readMany(ids.map((id) => ({ store, id })));
          if (live && !signal.aborted) setList(ids.map((id, i) => ({ id, ...fields[i] })));
        })().catch(ignoreFailure);
        return () => {
          live = false;
        };
      }, [store, count]);
      const reload = () => {
        if (!signal.aborted) setCount((c) => c + 1);
      };
      const create = useStable(() => async (fields: unknown) => {
        const id = randomId();
        await broker.data.patch({ store, id }, fields);
        reload();
        return id;
      });
      const patch = useStable(() => async (id: unknown, changes: unknown) => {
        await broker.data.patch({ store, id: String(id) }, changes);
        reload();
      });
      const remove = useStable(() => async (id: unknown) => {
        await broker.data.remove(store, String(id));
        reload();
      });
      return { records: list, create, patch, remove };
    }),

    ChildSlot: rt.hostComponent(function ChildSlot(props: { is?: unknown; context?: unknown; on?: unknown }) {
      const name = (props.is as { $slot?: unknown } | null)?.$slot;
      const def = typeof name === "string" && slot.children.includes(name) ? app.slots.find((s) => s.name === name) : undefined;
      const on = useLatest(props.on as Record<string, unknown> | undefined);
      const onEvent = React.useCallback<Deliver>(
        (event, payload) => {
          const handler = on.current?.[event];
          if (signal.aborted || typeof handler !== "function" || !def) return;
          handler(rt.toThx(hostToPlugin(def.emits[event], payload, rt, records)));
        },
        [def],
      );
      if (!def) {
        return <SlotMessage text={`${String(name)} is not a child slot of ${slot.name}`} />;
      }
      let context: Record<string, unknown>;
      try {
        context = (pluginToHost(objectSchema(def.context), props.context ?? {}, rt, records) ?? {}) as Record<string, unknown>;
      } catch (error) {
        return <SlotMessage text={`Wrong context for ${def.name}: ${error instanceof ConvertError ? error.message : String(error)}`} />;
      }
      return <ChildSlotView path={`${path}/${def.name}`} def={def} context={context} onEvent={onEvent} />;
    }),

    css: fn((style: unknown) => styles.className(style)),
  };

  /** A refused or failed data read leaves the hook empty, and the plugin keeps running. */
  function ignoreFailure(): void {}

  function merge(previous: Record<string, unknown> | undefined, changes: unknown): Record<string, unknown> {
    const next: Record<string, unknown> = { ...(previous ?? {}) };
    if (changes && typeof changes === "object") {
      for (const [k, v] of Object.entries(changes as Record<string, unknown>)) if (v !== undefined) next[k] = v;
    }
    return next;
  }

  // ---- thixo/ui ----

  const ui: Record<string, unknown> = { tokens: rt.toThx(tokens) };
  for (const [name, component] of Object.entries(UI_COMPONENTS)) ui[name] = rt.hostComponent(component);

  // ---- thixo/data and thixo/schema ----

  const data = {
    annotate: fn((record: unknown, _fields: unknown): DataDecl => {
      const name = (record as { $record?: unknown } | null)?.$record;
      if (typeof name !== "string") throw new ThixoRefused("annotate", "expected a record exported from @app/sdk");
      return { $annotation: name };
    }),
    store: fn((name: unknown, _options: unknown): DataDecl => {
      if (typeof name !== "string") throw new ThixoRefused("store", "the store's name must be a string");
      return { $store: name };
    }),
  };

  const field = (kind: "string" | "number" | "boolean" | "date" | "url") => fn(() => ({ kind }));
  const schema = {
    t: rt.toThx({
      string: field("string"),
      number: field("number"),
      boolean: field("boolean"),
      date: field("date"),
      url: field("url"),
      array: fn((of: unknown) => ({ kind: "array", of })),
    }),
  };

  // ---- thixo/services ----

  const raw = createServices({ manifest: load.manifest, host: services, pluginName: load.plugin.name, scopeClass: styles.scopeClass, signal });
  const servicesModule = {
    navigate: fn(raw.navigate),
    openModal: fn((content: unknown, opts?: { title?: unknown }) => {
      const handle = raw.openModal(content, opts);
      return { close: fn(() => handle.close()) };
    }),
    copyToClipboard: fn(raw.copyToClipboard),
    download: fn(raw.download),
    toast: fn(raw.toast),
  };

  // ---- @app/sdk, @app/sdk/optional, @app/slots ----

  const sdk: Record<string, unknown> = { ...endpointFns };
  for (const r of app.records) sdk[r.exportName] = rt.toThx({ $record: r.name });
  const slots: Record<string, unknown> = {};
  for (const s of app.slots) slots[s.exportName] = rt.toThx({ $slot: s.name });

  const modules: Record<string, Record<string, unknown>> = {
    "thixo/plugin": plugin,
    "thixo/ui": ui,
    "thixo/data": data,
    "thixo/schema": schema,
    "thixo/services": servicesModule,
    "@app/sdk": sdk,
    "@app/sdk/optional": { ...endpointFns },
    "@app/slots": slots,
  };

  for (const specifier of app.libraries) {
    const library = options.libraries?.[specifier];
    if (library) modules[specifier] = wrapLibrary(library, rt);
  }

  return { modules, definition: () => defined };
}

/** An exposed library's exports, each made a language value at the boundary (L3). An export whose name starts with
 * a capital letter and is a function is taken to be a React component. */
export function wrapLibrary(library: Record<string, unknown>, rt: Runtime): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(library)) {
    if (name === "default" || name === "__esModule") continue;
    if (typeof value === "function") out[name] = /^[A-Z]/.test(name) ? rt.hostComponent(value) : rt.hostFunction(value as (...args: never[]) => unknown);
    else if (value !== null && typeof value === "object" && (value as { $$typeof?: unknown }).$$typeof) out[name] = rt.hostComponent(value);
    else out[name] = rt.toThx(value);
  }
  return out;
}

export function SlotMessage(props: { text: string }) {
  return (
    <div role="alert" className="thixo-slot-message">
      {props.text}
    </div>
  );
}
