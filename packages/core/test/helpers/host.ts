// A fake host: a createElement that builds plain objects, hooks over a flat array, and an SDK that records calls.
// Enough to run compiled plugins and look at what they render.

import { compile } from "../../src/index.js";
import { createRuntime } from "../../src/runtime/index.js";
import type { CompileOptions, ProgramDefinition, Runtime, RuntimeHost, SourceFiles } from "../../src/contract.js";
import { testOptions } from "../fixtures/env.js";

export interface HostElement {
  type: unknown;
  props: Record<string, unknown>;
}

export interface Rendered {
  type: string;
  props: Record<string, unknown>;
  children: (Rendered | string | number)[];
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
}

export interface FakeApp {
  rt: Runtime;
  host: RuntimeHost;
  def: ProgramDefinition;
  calls: { name: string; input: unknown }[];
  errors: Error[];
  leaked: unknown[];
  styles: Map<string, string>;
  render(props?: Record<string, unknown>): Rendered[];
  flush(): Promise<void>;
  /** Frame callbacks registered with `useFrame`, in order. */
  frames: ((time: number, delta: number) => void)[];
  pointer: { x: number; y: number; down: boolean; inside: boolean };
  todos: Todo[];
}

export interface FakeOptions {
  budget?: number;
  canCall?: string[];
  todos?: Todo[];
  assignees?: { todoId: string; name: string }[];
  /** Extra people `listPeople` answers with, after Ana. */
  people?: { id: string; name: string; avatar: string }[];
}

export async function macrotask(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

export function compileOrThrow(files: SourceFiles, options: CompileOptions = testOptions()) {
  const r = compile(files, options);
  if (!r.ok) throw new Error(`compile failed:\n${r.errors.map((e) => `${e.file}:${e.line}:${e.column} ${e.code} ${e.message}`).join("\n")}`);
  return r;
}

/** Loads emitted code as a module without touching the file system. */
export async function load(code: string): Promise<{ default: (rt: unknown) => unknown }> {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

export async function fakeApp(code: string, opts: FakeOptions = {}): Promise<FakeApp> {
  const calls: { name: string; input: unknown }[] = [];
  const errors: Error[] = [];
  const leaked: unknown[] = [];
  const styles = new Map<string, string>();
  const hostComponentNames = new Map<unknown, string>();
  const todos: Todo[] = (opts.todos ?? [
    { id: "1", title: "Buy milk", done: false },
    { id: "2", title: "Walk dog", done: true },
  ]).map((t) => ({ ...t }));
  const assignees = opts.assignees ?? [{ todoId: "1", name: "Ana" }];
  const frames: ((time: number, delta: number) => void)[] = [];
  const pointer = { x: 0, y: 0, down: false, inside: false };
  const canCall = new Set(opts.canCall ?? ["listTodos", "getTodo", "createTodo", "updateTodo", "listAssignees", "listPeople"]);

  const host: RuntimeHost = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children } } satisfies HostElement;
    },
    Fragment: "Fragment",
    modules: {},
    budget: opts.budget,
    onError: (e) => errors.push(e),
    insertStyle: (cls, text) => styles.set(cls, text),
  };
  const rt = createRuntime(host);

  let hooks: unknown[] = [];
  let index = 0;
  const pending: Promise<unknown>[] = [];

  const sdk: Record<string, (input?: unknown) => Promise<unknown>> = {
    listTodos: async () => todos.map((t) => ({ ...t })),
    getTodo: async (input) => ({ ...todos.find((t) => t.id === (input as { id: string }).id)! }),
    createTodo: async (input) => {
      const t = { id: String(todos.length + 1), title: (input as { title: string }).title, done: false };
      todos.push(t);
      return { ...t };
    },
    updateTodo: async (input) => {
      const i = input as { id: string; done?: boolean; title?: string };
      const t = todos.find((x) => x.id === i.id)!;
      if (i.done !== undefined) t.done = i.done;
      if (i.title !== undefined) t.title = i.title;
      return { ...t };
    },
    deleteTodo: async (input) => {
      const i = todos.findIndex((x) => x.id === (input as { id: string }).id);
      todos.splice(i, 1);
    },
    listAssignees: async () => assignees.map((a) => ({ ...a })),
    listPeople: async () => [
      { id: "p1", name: "Ana", avatar: rt.url("https://avatars.example.com/ana.png") },
      ...(opts.people ?? []).map((p) => ({ ...p, avatar: rt.url(p.avatar) })),
    ],
  };
  const endpointName = new Map<unknown, string>();
  const sdkModule: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(sdk)) {
    const recorded = (input?: unknown) => {
      calls.push({ name, input });
      if (!canCall.has(name)) return Promise.reject(new Error(`refused: ${name}`));
      return fn(input);
    };
    endpointName.set(recorded, name);
    sdkModule[name] = rt.hostFunction(recorded);
  }

  function useState(initial: unknown) {
    const i = index++;
    if (!(i in hooks)) hooks[i] = { value: initial, set: (v: unknown) => (hooks[i] = { ...(hooks[i] as object), value: v }) };
    const h = hooks[i] as { value: unknown; set: (v: unknown) => void };
    return [h.value, (hooks[i] as { set: unknown }).set];
  }
  function useQuery(endpoint: (input?: unknown) => Promise<unknown>, input?: unknown) {
    const i = index++;
    if (!(i in hooks)) {
      const load = () => {
        const p = endpoint(input).then(
          (data) => {
            hooks[i] = { ...(hooks[i] as object), data, loading: false };
          },
          (error) => {
            hooks[i] = { ...(hooks[i] as object), error, loading: false };
          },
        );
        pending.push(p);
      };
      hooks[i] = { data: undefined, error: undefined, loading: true, refresh: () => load() };
      if (canCall.has(endpointName.get(endpoint) ?? "")) load();
      else hooks[i] = { ...(hooks[i] as object), loading: false };
    }
    return hooks[i];
  }
  function useCan(endpoint: unknown) {
    return canCall.has(endpointName.get(endpoint) ?? "");
  }
  function useMemo(fn: () => unknown) {
    return fn();
  }
  function useEffect(fn: () => void) {
    fn();
  }
  function useFrame(fn: (time: number, delta: number) => void) {
    const i = index++;
    if (!(i in hooks)) {
      hooks[i] = true;
      frames.push(fn);
    }
  }
  const component = (name: string) => {
    const c = function (props: unknown) {
      return props;
    };
    hostComponentNames.set(c, name);
    return rt.hostComponent(c);
  };

  host.modules = {
    thixo: {
      useState: rt.hostFunction(useState),
      useMemo: rt.hostFunction(useMemo),
      useEffect: rt.hostFunction(useEffect),
      useFrame: rt.hostFunction(useFrame),
      usePointer: rt.hostFunction(() => ({ ...pointer })),
      useGesture: rt.hostFunction(() => undefined),
      useSize: rt.hostFunction(() => ({ width: 200, height: 100 })),
      useKeys: rt.hostFunction(() => []),
    },
    "@app/hooks": {
      useQuery: rt.hostFunction(useQuery),
      useCan: rt.hostFunction(useCan),
    },
    "@app/ui": {
      Stack: component("Stack"),
      Text: component("Text"),
      Button: component("Button"),
      TextInput: component("TextInput"),
      Checkbox: component("Checkbox"),
      Avatar: component("Avatar"),
      tokens: rt.toThx({ space: 8, accent: "#0af" }),
    },
    "@app/services": {
      toast: rt.hostFunction((text: string) => calls.push({ name: "toast", input: text })),
      navigate: rt.hostFunction((route: unknown) => calls.push({ name: "navigate", input: route })),
      copyToClipboard: rt.hostFunction(async (text: string) => {
        calls.push({ name: "copyToClipboard", input: text });
      }),
    },
    "@app/sdk": sdkModule,
    "@app/charts": {
      Sparkline: component("Sparkline"),
      mean: rt.hostFunction((values: number[]) => values.reduce((a, b) => a + b, 0) / values.length),
    },
    "@app/probe": {
      leak: rt.hostFunction((v: unknown) => {
        leaked.push(v);
      }),
    },
  };

  const def = rt.instantiate(await load(code));

  function expand(node: unknown): (Rendered | string | number)[] {
    if (node === null || node === undefined || typeof node === "boolean") return [];
    if (typeof node === "string" || typeof node === "number") return [node];
    if (Array.isArray(node)) return node.flatMap(expand);
    const el = node as HostElement;
    const { children, ...props } = el.props;
    const kids = expand(children);
    if (el.type === "Fragment") return kids;
    if (typeof el.type === "string") return [{ type: el.type, props, children: kids }];
    const hostName = hostComponentNames.get(el.type);
    if (hostName) return [{ type: hostName, props, children: kids }];
    return expand((el.type as (p: unknown) => unknown)(el.props));
  }

  const app: FakeApp = {
    rt,
    host,
    def,
    calls,
    errors,
    leaked,
    styles,
    frames,
    pointer,
    todos,
    render(props = {}) {
      index = 0;
      return expand(def.component(props));
    },
    async flush() {
      for (let i = 0; i < 5; i++) {
        await Promise.all(pending.splice(0));
        await macrotask();
      }
    },
  };
  return app;
}

/** Every element in a rendered tree, depth first. */
export function all(tree: (Rendered | string | number)[]): Rendered[] {
  const out: Rendered[] = [];
  const walk = (n: Rendered | string | number) => {
    if (typeof n === "object") {
      out.push(n);
      n.children.forEach(walk);
    }
  };
  tree.forEach(walk);
  return out;
}

export function text(tree: (Rendered | string | number)[]): string {
  const parts: string[] = [];
  const walk = (n: Rendered | string | number) => {
    if (typeof n === "object") n.children.forEach(walk);
    else parts.push(String(n));
  };
  tree.forEach(walk);
  return parts.join(" ");
}
