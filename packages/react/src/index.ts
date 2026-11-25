// Runs a compiled thixo program in a page with React. It builds the built-in "thixo" module (hooks over React and a
// box the program draws in), wraps the host's own modules as language values, and mounts the program in a box of
// its own. The page's other elements, its globals and the network stay out of reach: the program holds nothing but
// what this file and the host hand it.

import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ProgramDefinition, Runtime } from "@thixo/core";
import { createRuntime } from "@thixo/core/runtime";

export type CompiledModule = { default: (rt: unknown) => unknown };

export interface MountOptions {
  /** Host modules by specifier, as plain JavaScript. Functions whose names start with a capital are taken as React
   * components; other functions are wrapped as host functions; anything else is copied in as data. Declare each
   * module's types to the compiler with the same specifier. */
  modules?: Record<string, Record<string, unknown>>;
  /** Props handed to the program's component, as data. */
  props?: Record<string, unknown>;
  /** Steps a program may run in one go (a render, a handler, a frame). Default 5,000,000. */
  budget?: number;
  /** How the program's \`useGesture\` works, or \`false\` for no gestures at all. The program can't change it. */
  gestures?: GestureOptions | false;
  /** Called when the program is stopped or throws. Rendering stops; the box shows nothing. */
  onError?(error: Error): void;
  /** `"auto"`, the default, starts the clock at once. `"host"` starts it paused at time 0, for the host to `play` or
   * `step`. */
  clock?: "auto" | "host";
  /** `false` keeps the pointer, the keys and every event in the box from the program. Default true. */
  input?: boolean;
}

export interface GestureOptions {
  /** How far, in pixels, a press may move and still be a click. Past it, the press is a drag. Default 4. */
  clickSlop?: number;
  /** The pointer buttons that start a gesture, by \`PointerEvent.button\`. Default \`[0]\`, the main button. */
  buttons?: readonly number[];
  /** Whether a finger starts gestures. Default true. */
  touch?: boolean;
}

export interface Mounted {
  runtime: Runtime;
  /** Runs the clock: `useFrame` is called once an animation frame. Time goes on from where it stopped. */
  play(): void;
  /** Stops the clock. No frame runs, and the program's state changes wait until the clock moves again. */
  pause(): void;
  /** Moves a paused clock on by `seconds` in one frame, and renders before it returns. */
  step(seconds: number): void;
  /** Turns input on or off. Turning it off lets go of the pointer and the held keys. */
  setInput(on: boolean): void;
  unmount(): void;
}

/** Loads compiled code as a module. The page's content security policy must allow `blob:` scripts. */
export async function load(code: string): Promise<CompiledModule> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ url)) as CompiledModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface BoxState {
  pointer: { x: number; y: number; down: boolean; inside: boolean };
  size: { width: number; height: number };
  keys: string[];
  input: boolean;
}

type GestureName = "onDown" | "onUp" | "onClick" | "onDragStart" | "onDrag" | "onDragEnd";

interface Gesture {
  name: GestureName;
  point: { x: number; y: number; dx?: number; dy?: number };
}

interface Box {
  get(): BoxState;
  subscribe(fn: () => void): () => void;
  set(patch: Partial<BoxState>): void;
  listen(fn: (g: Gesture) => void): () => void;
  emit(g: Gesture): void;
}

/** The press a gesture is following: where it went down, where it last was, and whether it became a drag. */
interface Press {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
}

interface GestureRules {
  clickSlop: number;
  buttons: readonly number[];
  touch: boolean;
}

function gestureRules(options: GestureOptions | false | undefined): GestureRules | null {
  if (options === false) return null;
  const clickSlop = options?.clickSlop ?? 4;
  if (typeof clickSlop !== "number" || !(clickSlop >= 0) || clickSlop === Infinity) throw new Error("gestures.clickSlop must be a number of pixels, 0 or more.");
  const buttons = [...(options?.buttons ?? [0])];
  if (!buttons.every((b) => Number.isInteger(b))) throw new Error("gestures.buttons must be button numbers.");
  return { clickSlop, buttons, touch: options?.touch ?? true };
}

const NO_POINTER: BoxState["pointer"] = { x: 0, y: 0, down: false, inside: false };

function createBox(input: boolean): Box {
  let state: BoxState = { pointer: NO_POINTER, size: { width: 0, height: 0 }, keys: [], input };
  const subs = new Set<() => void>();
  const listeners = new Set<(g: Gesture) => void>();
  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(patch) {
      state = { ...state, ...patch };
      for (const fn of subs) fn();
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(g) {
      for (const fn of [...listeners]) fn(g);
    },
  };
}

type FrameFn = (time: number, delta: number) => void;

/** The program's one clock. Its time is the sum of the frames the host let run. While it is still, the program's
 * state changes are held, so a program can't animate itself with effects that set state. */
interface Clock {
  readonly time: number;
  subscribe(fn: FrameFn): () => void;
  update(change: () => void): void;
  play(): void;
  pause(): void;
  step(seconds: number): void;
  stop(): void;
}

function createClock(playing: boolean, stopped: () => boolean): Clock {
  let time = 0;
  let live = playing;
  let handle = 0;
  let last: number | undefined;
  const subs = new Set<FrameFn>();
  const held: (() => void)[] = [];
  const release = () => {
    for (const change of held.splice(0)) change();
  };
  const tick = (delta: number) => {
    time += delta;
    for (const fn of [...subs]) {
      if (stopped()) return;
      fn(time, delta);
    }
  };
  const frame = (now: number) => {
    if (stopped()) return;
    const delta = last === undefined ? 0 : (now - last) / 1000;
    last = now;
    tick(delta);
    if (!stopped()) handle = requestAnimationFrame(frame);
  };
  if (playing) handle = requestAnimationFrame(frame);
  return {
    get time() {
      return time;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    update(change) {
      if (live) change();
      else held.push(change);
    },
    play() {
      if (playing || stopped()) return;
      playing = live = true;
      last = undefined;
      release();
      handle = requestAnimationFrame(frame);
    },
    pause() {
      if (!playing) return;
      playing = live = false;
      cancelAnimationFrame(handle);
    },
    step(seconds) {
      if (playing) throw new Error("step runs only while the clock is paused.");
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error("step takes a number of seconds, 0 or more.");
      if (stopped()) return;
      flushSync(() => {
        live = true;
        try {
          release();
          tick(seconds);
        } finally {
          live = false;
        }
      });
    },
    stop() {
      playing = live = false;
      cancelAnimationFrame(handle);
      subs.clear();
      held.length = 0;
    },
  };
}

const BoxContext = React.createContext<Box | null>(null);

function useBox(hook: string): Box {
  const box = React.useContext(BoxContext);
  if (!box) throw new Error(`${hook} runs only inside a mounted program.`);
  return box;
}

/** Deps cross the boundary as fresh copies each render, so they are compared by value. */
function same(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth > 8 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
}

function useDepsVersion(deps: unknown): number {
  const ref = React.useRef<{ deps: unknown; version: number } | null>(null);
  if (ref.current === null) ref.current = { deps, version: 0 };
  else if (deps === undefined || !same(ref.current.deps, deps)) ref.current = { deps, version: ref.current.version + 1 };
  return ref.current.version;
}

function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

/** The built-in "thixo" module for one runtime. `css` is the runtime's own. */
export function thixoModule(rt: Runtime, clock: Clock = createClock(true, () => rt.stopped)): Record<string, unknown> {
  const fn = <F extends (...args: never[]) => unknown>(f: F): F => rt.hostFunction(f);
  return {
    useState: fn((initial: unknown) => {
      const [value, setValue] = React.useState(initial);
      const setter = React.useRef<unknown>(null);
      setter.current ??= fn((next: unknown) => {
        if (rt.stopped) return;
        clock.update(() => setValue((previous: unknown) => (typeof next === "function" ? (next as (p: unknown) => unknown)(previous) : next)));
      });
      return [value, setter.current];
    }),
    useMemo: fn((compute: unknown, deps: unknown) => {
      const version = useDepsVersion(deps);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return React.useMemo(() => (typeof compute === "function" ? (compute as () => unknown)() : undefined), [version]);
    }),
    useEffect: fn((effect: unknown, deps?: unknown) => {
      const version = useDepsVersion(deps);
      const latest = useLatest(effect);
      React.useEffect(() => {
        if (rt.stopped || typeof latest.current !== "function") return;
        const cleanup = (latest.current as () => unknown)();
        return typeof cleanup === "function" ? () => void (cleanup as () => unknown)() : undefined;
      }, [version]);
    }),
    useFrame: fn((callback: unknown) => {
      const latest = useLatest(callback);
      React.useEffect(() => {
        const start = clock.time;
        return clock.subscribe((time, delta) => {
          if (typeof latest.current === "function") (latest.current as FrameFn)(time - start, delta);
        });
      }, []);
    }),
    usePointer: fn(() => {
      const box = useBox("usePointer");
      return React.useSyncExternalStore(box.subscribe, () => (box.get().input ? box.get().pointer : NO_POINTER));
    }),
    useGesture: fn((handlers: unknown) => {
      const box = useBox("useGesture");
      const latest = useLatest(handlers);
      React.useEffect(
        () =>
          box.listen((g) => {
            if (rt.stopped || !box.get().input) return;
            const h = latest.current;
            const f = h !== null && typeof h === "object" ? (h as Record<string, unknown>)[g.name] : undefined;
            if (typeof f === "function") (f as (p: Gesture["point"]) => unknown)(g.point);
          }),
        [box],
      );
    }),
    useSize: fn(() => {
      const box = useBox("useSize");
      return React.useSyncExternalStore(box.subscribe, () => box.get().size);
    }),
    useKeys: fn(() => {
      const box = useBox("useKeys");
      return React.useSyncExternalStore(box.subscribe, () => (box.get().input ? box.get().keys : NO_KEYS));
    }),
  };
}

const NO_KEYS: string[] = [];

/** Wraps a host's plain module as language values. */
export function wrapModule(rt: Runtime, mod: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === "function") out[name] = /^[A-Z]/.test(name) ? rt.hostComponent(value) : rt.hostFunction(value as (...args: never[]) => unknown);
    else if (value !== null && typeof value === "object" && (value as { $$typeof?: unknown }).$$typeof) out[name] = rt.hostComponent(value);
    else out[name] = rt.toThx(value);
  }
  return out;
}

const BOX_STYLE: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  contain: "strict",
  isolation: "isolate",
  width: "100%",
  height: "100%",
  outline: "none",
  touchAction: "none",
};

/** Mounts a compiled program in `target`. The program draws inside a box that fills `target` and clips it. */
export function mount(target: HTMLElement, module: CompiledModule, options: MountOptions = {}): Mounted {
  const rules = gestureRules(options.gestures);
  const styles = document.createElement("style");
  styles.dataset.thixo = "";
  document.head.appendChild(styles);
  const modules: Record<string, Record<string, unknown>> = {};
  let failed: Error | undefined;
  const onError = (error: Error) => {
    if (failed) return;
    failed = error;
    options.onError?.(error);
    root.render(null);
  };
  const rt = createRuntime({
    createElement: React.createElement as never,
    Fragment: React.Fragment,
    modules,
    budget: options.budget,
    onError,
    insertStyle: (_name, cssText) => {
      styles.appendChild(document.createTextNode(cssText + "\n"));
    },
  });
  const clock = createClock(options.clock !== "host", () => rt.stopped || failed !== undefined);
  modules.thixo = thixoModule(rt, clock);
  for (const [spec, mod] of Object.entries(options.modules ?? {})) {
    if (spec === "thixo") throw new Error('A host can\'t replace the built-in "thixo" module.');
    modules[spec] = wrapModule(rt, mod);
  }
  const def: ProgramDefinition = rt.instantiate(module);
  const box = createBox(options.input !== false);
  const Program = def.component as React.FC<Record<string, unknown>>;

  class Guard extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
    state: { error?: Error } = {};
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    componentDidCatch(error: Error) {
      onError(error);
    }
    render() {
      return this.state.error ? null : this.props.children;
    }
  }

  let committed = false;
  function Root() {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => {
      committed = true;
      const el = ref.current!;
      const measure = () => box.set({ size: { width: el.clientWidth, height: el.clientHeight } });
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const input = React.useSyncExternalStore(box.subscribe, () => box.get().input);
    const point = (e: React.PointerEvent, patch: Partial<BoxState["pointer"]> = {}) => {
      if (!box.get().input) return undefined;
      const r = ref.current!.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      box.set({ pointer: { ...box.get().pointer, ...at, inside: true, ...patch } });
      return at;
    };
    const ours = (e: React.PointerEvent) => press.current !== null && press.current.id === e.pointerId;
    const onDown = (e: React.PointerEvent) => {
      const at = point(e, { down: true });
      if (!at || !rules || !e.isPrimary || !rules.buttons.includes(e.button) || (e.pointerType === "touch" && !rules.touch) || press.current) return;
      press.current = { id: e.pointerId, ...at, lastX: at.x, lastY: at.y, dragging: false };
      box.emit({ name: "onDown", point: at });
    };
    const onMove = (e: React.PointerEvent) => {
      const at = point(e);
      if (!at || !ours(e)) return;
      const p = press.current!;
      if (!p.dragging) {
        if (Math.hypot(at.x - p.x, at.y - p.y) <= rules!.clickSlop) return;
        p.dragging = true;
        box.emit({ name: "onDragStart", point: { x: p.x, y: p.y } });
      }
      box.emit({ name: "onDrag", point: { ...at, dx: at.x - p.lastX, dy: at.y - p.lastY } });
      p.lastX = at.x;
      p.lastY = at.y;
    };
    const onUp = (e: React.PointerEvent) => {
      const at = point(e, { down: false });
      if (at && ours(e)) release(at, true);
    };
    const onLeave = (e: React.PointerEvent) => {
      const at = point(e, { inside: false, down: false });
      if (at && ours(e)) release(at, false);
    };
    const keys = (key: string, held: boolean) => {
      if (!box.get().input) return;
      const now = box.get().keys.filter((k) => k !== key);
      box.set({ keys: held ? [...now, key] : now });
    };
    return React.createElement(
      "div",
      {
        ref,
        style: BOX_STYLE,
        tabIndex: input ? 0 : -1,
        inert: !input,
        "data-thixo-box": "",
        onPointerMove: onMove,
        onPointerDown: onDown,
        onPointerUp: onUp,
        onPointerLeave: onLeave,
        onPointerCancel: onLeave,
        onKeyDown: (e: React.KeyboardEvent) => keys(e.key, true),
        onKeyUp: (e: React.KeyboardEvent) => keys(e.key, false),
        onBlur: () => box.set({ keys: [] }),
      },
      React.createElement(BoxContext.Provider, { value: box }, React.createElement(Guard, null, React.createElement(Program, options.props ?? {}))),
    );
  }

  const press: { current: Press | null } = { current: null };
  const release = (at: { x: number; y: number }, clicked: boolean) => {
    const p = press.current!;
    press.current = null;
    box.emit({ name: "onUp", point: at });
    if (p.dragging) box.emit({ name: "onDragEnd", point: at });
    else if (clicked) box.emit({ name: "onClick", point: at });
  };

  const root = createRoot(target);
  const element = React.createElement(Root);
  root.render(element);
  return {
    runtime: rt,
    play: () => clock.play(),
    pause: () => clock.pause(),
    step(seconds) {
      if (!committed) flushSync(() => root.render(element));
      clock.step(seconds);
    },
    setInput(on) {
      if (on === box.get().input) return;
      if (!on && press.current) release({ x: press.current.lastX, y: press.current.lastY }, false);
      box.set(on ? { input: true } : { input: false, pointer: NO_POINTER, keys: [] });
    },
    unmount() {
      clock.stop();
      root.unmount();
      styles.remove();
    },
  };
}
