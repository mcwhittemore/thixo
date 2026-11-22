import type { PluginDefinition, Runtime, RuntimeHost, Url } from "thixo-thx/contract";

/** What a fake compiled module gets instead of the real guarded `rt`: the host modules by specifier, a way to mark
 * its own functions as language functions, and the element function. */
export interface FakePluginApi {
  import(specifier: string): Record<string, any>;
  fn<F extends (...args: any[]) => unknown>(f: F): F;
  h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): any;
  Fragment: unknown;
}

export type FakeModule = { default: (rt: unknown) => unknown };

export interface FakeRuntime extends Runtime {
  host: RuntimeHost;
  /** Every value the runtime let into the plugin's world: arguments to plugin functions, returns of host functions. */
  handedIn: unknown[];
}

/** A small stand-in for thx's runtime, written to `RuntimeHost` and `Runtime` in packages/thx/src/contract.ts. It is
 * strict where the contract is: `toThx` refuses a raw host function or a non-plain object, so a host module that
 * hands a plugin something it should not fails here. There is no budget and no guard on field reads. */
export function createFakeRuntime(host: RuntimeHost): FakeRuntime {
  const urls = new WeakMap<object, string>();
  const language = new WeakSet<object>();
  const components = new WeakSet<object>();
  const handedIn: unknown[] = [];

  const isElement = (v: unknown) => typeof v === "object" && v !== null && "$$typeof" in v;

  function toThx<T>(value: T): T {
    const out = convert(value);
    handedIn.push(out);
    return out as T;
  }

  function convert(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
      if (typeof value === "function") {
        if (language.has(value) || components.has(value)) return value;
        throw new TypeError(`toThx: a raw host function (${value.name || "anonymous"}) is not a language value`);
      }
      return value;
    }
    if (urls.has(value) || components.has(value) || isElement(value)) return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [convert(k), convert(v)]));
    if (Array.isArray(value)) return Object.freeze(value.map(convert));
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(`toThx: ${proto?.constructor?.name ?? "an object"} is not plain data`);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v);
    return Object.freeze(out);
  }

  function plain(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (urls.has(value) || components.has(value) || isElement(value)) return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) return new Map([...value].map(([k, v]) => [plain(k), plain(v)]));
    if (Array.isArray(value)) return value.map(plain);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }

  const rt: FakeRuntime = {
    host,
    handedIn,
    hostFunction(fn) {
      const wrapper = function (this: unknown, ...args: unknown[]) {
        const result = (fn as unknown as (...a: unknown[]) => unknown)(...args.map(plain));
        if (result && typeof (result as Promise<unknown>).then === "function") return (result as Promise<unknown>).then((v) => toThx(v));
        return toThx(result);
      };
      language.add(wrapper);
      return wrapper as unknown as typeof fn;
    },
    hostComponent(component) {
      components.add(component as object);
      return component;
    },
    toThx,
    url(address) {
      const u = Object.freeze(Object.create(null)) as Url;
      urls.set(u, address);
      return u;
    },
    isUrl(value): value is Url {
      return typeof value === "object" && value !== null && urls.has(value);
    },
    unwrapUrl(url) {
      const address = urls.get(url as object);
      if (address === undefined) throw new TypeError("not a Url");
      return address;
    },
    instantiate(module) {
      const api: FakePluginApi = {
        import(specifier) {
          const m = host.modules[specifier];
          if (!m) throw new Error(`no host module ${specifier}`);
          return m;
        },
        fn(f) {
          const wrapper = (...args: unknown[]) => {
            for (const a of args) handedIn.push(a);
            return f(...args);
          };
          language.add(wrapper);
          return wrapper as typeof f;
        },
        h: (type, props, ...children) => host.createElement(type, props, ...children),
        Fragment: host.Fragment,
      };
      return module.default(api) as PluginDefinition;
    },
  };
  return rt;
}
