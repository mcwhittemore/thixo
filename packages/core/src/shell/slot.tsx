import * as React from "react";
import type { PluginDefinition, Runtime, SchemaJson } from "thixo-thx/contract";
import type { PluginLoad, PluginVersionRef, SlotDef } from "../contract.js";
import { createBroker } from "../plugin-host/broker.js";
import { hostToPlugin, type RecordFields } from "../plugin-host/convert.js";
import { createEmit, type Deliver } from "../plugin-host/emit.js";
import { buildHostModules, SlotMessage } from "../plugin-host/host-modules.js";
import { ScopedStyles, sanitizeStyle, scopeClassFor } from "../plugin-host/styles.js";
import { parseJson, SchemaError } from "../schema/json.js";
import type { SlotHandle, SlotProps } from "../slots/index.js";
import type { CompiledModule } from "./runtime.js";
import { useShellInternals, type ShellInternals } from "./shell.js";

/** The slot's box (P8, docs/05 "Styles"): nothing a plugin draws gets out of it, `position: fixed` included. */
export function boxStyle(def: Pick<SlotDef, "size">): React.CSSProperties {
  return {
    contain: "layout paint style",
    overflow: "auto",
    isolation: "isolate",
    position: "relative",
    ...(def.size ?? {}),
  };
}

function records(internals: ShellInternals): RecordFields {
  return Object.fromEntries(internals.app.records.map((r) => [r.name, r.fields ?? {}]));
}

function objectSchema(fields: Record<string, SchemaJson>): SchemaJson {
  return { kind: "object", fields };
}

/** Places a slot (S7): `<Slot is={main} context={...} on={{ select: fn }} />`. Thixo loads whichever plugin version
 * the user's layout puts there. */
export function Slot<S extends SlotHandle<any, any>>(props: SlotProps<S>) {
  const internals = useShellInternals();
  const handle = props.is as SlotHandle<any, any>;
  const on = React.useRef(props.on as Record<string, ((payload: unknown) => void) | undefined> | undefined);
  on.current = props.on as typeof on.current;
  const onEvent = React.useCallback<Deliver>((event, payload) => on.current?.[event]?.(payload), []);
  const name = handle?.def?.name;
  const def = internals?.app.slots.find((s) => s.name === name) ?? (handle?.def ? ({ exportName: name, ...handle.def } as SlotDef) : undefined);
  const contextKey = JSON.stringify(props.context ?? {});
  const checked = React.useMemo(() => {
    if (!def || !internals) return undefined;
    try {
      return { context: parseJson(objectSchema(def.context), props.context ?? {}, records(internals)) as Record<string, unknown> };
    } catch (error) {
      return { error: error instanceof SchemaError ? error.message : String(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, internals?.app, contextKey]);
  if (!internals || !def || !checked) return null;
  if ("error" in checked) return <SlotMessage text={`Wrong context for slot ${def.name}: ${checked.error}`} />;
  return <SlotView path={def.name} def={def} context={checked.context!} onEvent={onEvent} />;
}

type Loaded = { load: PluginLoad; module: CompiledModule };

function loadVersion(internals: ShellInternals, ref: PluginVersionRef): Promise<Loaded> {
  const key = `${ref.plugin}@${ref.number}`;
  let entry = internals.cache.get(key) as Promise<Loaded> | undefined;
  if (!entry) {
    entry = (async () => {
      const load = await internals.client.pluginLoad(ref);
      const module = await internals.loadCode(load.code);
      return { load, module };
    })();
    entry.catch(() => internals.cache.delete(key));
    internals.cache.set(key, entry);
  }
  return entry;
}

interface Running {
  rt: Runtime;
  definition: PluginDefinition;
  load: PluginLoad;
  styles: ScopedStyles;
  emit: unknown;
  controller: AbortController;
}

type ViewState =
  | { status: "loading" }
  | { status: "ready"; running: Running }
  | { status: "error"; name: string; message: string };

/** One slot path in the layout, filled. Used by `<Slot>` and by a plugin's `<ChildSlot>`. `context` is in host
 * form, already checked against the slot's schema. */
export function SlotView(props: { path: string; def: SlotDef; context: Record<string, unknown>; onEvent: Deliver }) {
  const internals = useShellInternals();
  const ref = internals?.layout?.resolved[props.path];
  const [state, setState] = React.useState<ViewState>({ status: "loading" });
  const onEvent = React.useRef(props.onEvent);
  onEvent.current = props.onEvent;
  const def = props.def;

  React.useEffect(() => {
    if (!internals || !ref) return;
    const controller = new AbortController();
    const { signal } = controller;
    let pluginName = ref.plugin;
    setState({ status: "loading" });
    const stop = (error: unknown) => {
      if (signal.aborted) return;
      controller.abort();
      setState({ status: "error", name: pluginName, message: error instanceof Error ? error.message : String(error) });
    };
    (async () => {
      const { load, module } = await loadVersion(internals, ref);
      pluginName = load.plugin.name;
      if (load.manifest.slot !== def.name) throw new Error(`it fills "${load.manifest.slot}", not "${def.name}"`);
      const createRuntime = await internals.getCreateRuntime();
      if (signal.aborted) return;
      const modules: Record<string, Record<string, unknown>> = {};
      const allowed = new Set(load.manifest.addresses);
      let rt: Runtime | undefined;
      const createElement = (type: unknown, elementProps: Record<string, unknown> | null, ...children: unknown[]) =>
        React.createElement(type as string, hostElementProps(type, elementProps, rt, allowed) as never, ...(children as React.ReactNode[]));
      rt = createRuntime({ createElement, Fragment: React.Fragment, modules, budget: internals.budget, onError: stop });
      const styles = new ScopedStyles(scopeClassFor(load.plugin.id, load.version), { rt, allowed });
      const broker = createBroker({ load, app: internals.app, rt, request: internals.session.request, signal });
      const host = buildHostModules({
        rt,
        broker,
        app: internals.app,
        load,
        slot: def,
        path: props.path,
        styles,
        services: internals.services,
        signal,
        ChildSlotView: SlotView,
        libraries: internals.libraries,
      });
      Object.assign(modules, host.modules);
      const returned = rt.instantiate(module);
      const definition = host.definition() ?? returned;
      if (!definition || typeof definition.component !== "function") throw new Error("the plugin's module did not call definePlugin");
      const rawEmit = createEmit(def.emits, (event, payload) => onEvent.current(event, payload), rt, signal, records(internals));
      const emit = rt.toThx(Object.fromEntries(Object.entries(rawEmit).map(([k, f]) => [k, rt!.hostFunction(f)])));
      if (signal.aborted) return;
      setState({ status: "ready", running: { rt, definition, load, styles, emit, controller } });
    })().catch(stop);
    return () => controller.abort();
  }, [internals?.cache, internals?.app, ref?.plugin, ref?.number, props.path, def]);

  if (!internals) return null;
  if (!ref) {
    if (!internals.browserOpen) return null;
    return (
      <div className="thixo-slot-empty" role="note" aria-label={`Empty slot ${props.path}`} data-slot={props.path}>
        Empty slot: {props.path}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="thixo-slot-box" style={boxStyle(def)} data-slot={props.path}>
        <SlotMessage text={`${state.name} stopped: ${state.message}`} />
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="thixo-slot-box thixo-slot-loading" style={boxStyle(def)} data-slot={props.path} aria-busy="true">
        Loading…
      </div>
    );
  }
  return <Filled path={props.path} def={def} context={props.context} running={state.running} records={records(internals)} />;
}

function Filled(props: { path: string; def: SlotDef; context: Record<string, unknown>; running: Running; records: RecordFields }) {
  const { running, def } = props;
  const { rt, definition, load, styles } = running;
  const contextKey = JSON.stringify(props.context);
  const context = React.useMemo(
    () => rt.toThx(hostToPlugin(objectSchema(def.context), props.context, rt, props.records) ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rt, def, contextKey],
  );
  useStyleSheet(styles);
  const Component = definition.component as React.ComponentType<{ context: unknown; emit: unknown }>;
  return (
    <div
      className={`thixo-slot-box ${styles.scopeClass}`}
      style={boxStyle(def)}
      data-slot={props.path}
      data-plugin={`${load.plugin.id}@${load.version}`}
      role="region"
      aria-label={`${definition.meta.name || load.plugin.name} (${props.path})`}
    >
      <SlotBoundary name={load.plugin.name} stop={() => running.controller.abort()}>
        <Component context={context} emit={running.emit} />
      </SlotBoundary>
    </div>
  );
}

/** Puts one plugin's `css()` rules in the page while it is on screen. */
function useStyleSheet(styles: ScopedStyles): void {
  React.useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const element = document.createElement("style");
    element.dataset.thixoPlugin = styles.scopeClass;
    element.textContent = styles.text();
    document.head.appendChild(element);
    const unsubscribe = styles.subscribe(() => {
      element.textContent = styles.text();
    });
    return () => {
      unsubscribe();
      element.remove();
    };
  }, [styles]);
}

/** A plugin that throws while rendering, or runs out of budget, is replaced by a message naming it. Only its slot is
 * affected. */
class SlotBoundary extends React.Component<{ name: string; stop: () => void; children: React.ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch() {
    this.props.stop();
  }
  render() {
    if (this.state.error !== undefined) return <SlotMessage text={`${this.props.name} stopped: ${this.state.error}`} />;
    return this.props.children;
  }
}

/** Props for an element the runtime has already let through: Urls become their addresses for the DOM, and a style
 * object is checked again (P8, L7). Host components get their props as they are. */
function hostElementProps(type: unknown, props: Record<string, unknown> | null, rt: Runtime | undefined, allowed: Set<string>) {
  if (typeof type !== "string" || !props || !rt) return props;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "style") out.style = sanitizeStyle(value, { rt, allowed });
    else if (rt.isUrl(value)) out[key] = rt.unwrapUrl(value);
    else out[key] = value;
  }
  return out;
}
