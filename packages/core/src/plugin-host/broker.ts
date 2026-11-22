import type { FieldDecl } from "thixo-thx/contract";
import type { AppInfo, DataAt, DataBodies, PluginLoad } from "../contract.js";
import { ConvertError, fieldsFromWire, fieldsToWire, hostToPlugin, pluginToHost, type RecordFields, type UrlMint } from "./convert.js";
import { ThixoCallError, ThixoRefused } from "./refused.js";

/** Makes a request to the app's own server with the user's token attached. The broker never sees the token (P5). */
export type AuthorizedRequest = (path: string, init: RequestInit) => Promise<Response>;

export interface BrokerOptions {
  load: PluginLoad;
  app: AppInfo;
  rt: UrlMint & { toThx<T>(value: T): T };
  request: AuthorizedRequest;
  /** Aborted when the plugin stops (P7): pending calls are cancelled and later ones refused. */
  signal: AbortSignal;
}

export interface Broker {
  /** Calls an endpoint for the plugin, and resolves to a language value. */
  call(endpoint: string, input: unknown): Promise<unknown>;
  /** P4: whether the user can call an endpoint the plugin imports, and the plugin's author too. */
  can(endpoint: string): boolean;
  /** Whether calling the endpoint would be refused without a request, and why. */
  refusal(endpoint: string): string | undefined;
  data: DataBroker;
}

export interface DataBroker {
  read(at: DataAt): Promise<Record<string, unknown>>;
  readMany(at: DataAt[]): Promise<Record<string, unknown>[]>;
  patch(at: DataAt, fields: unknown): Promise<void>;
  list(store: string): Promise<string[]>;
  remove(store: string, id: string): Promise<void>;
}

function plainParam(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function failure(response: Response, what: string): Promise<ThixoCallError> {
  let body: { error?: { message?: string; code?: string } } | undefined;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = undefined;
  }
  return new ThixoCallError(body?.error?.message ?? `${what} failed with ${response.status}`, response.status, body?.error?.code);
}

/** One broker per loaded plugin version: a closure over the authorized request, the manifest and `authorCan`. Every
 * `@app/sdk` function and every data hook goes through it. */
export function createBroker(options: BrokerOptions): Broker {
  const { load, app, rt, request, signal } = options;
  const { manifest } = load;
  const required = new Set(manifest.requiredEndpoints);
  const optional = new Set(manifest.optionalEndpoints);
  const authorCan = new Set(load.authorCan);
  const userCan = new Set(load.userCan);
  const endpoints = new Map(app.endpoints.map((e) => [e.name, e]));
  const records: RecordFields = Object.fromEntries(app.records.map((r) => [r.name, r.fields ?? {}]));
  const caller = { plugin: load.plugin.id, version: load.version };

  function refusal(endpoint: string): string | undefined {
    if (signal.aborted) return "the plugin has stopped";
    if (!required.has(endpoint) && !optional.has(endpoint)) return "it is not in the plugin version's manifest";
    if (!endpoints.has(endpoint)) return "the app has no such endpoint";
    if (!authorCan.has(endpoint)) return "the plugin's author does not hold the endpoint's scopes";
    if (optional.has(endpoint) && !userCan.has(endpoint)) return "the user can't call this optional endpoint";
    return undefined;
  }

  async function send(path: string, init: RequestInit, what: string): Promise<Response> {
    if (signal.aborted) throw new ThixoRefused(what, "the plugin has stopped");
    let response: Response;
    try {
      response = await request(path, { ...init, signal });
    } catch (error) {
      if (signal.aborted) throw new ThixoRefused(what, "the plugin has stopped");
      throw new ThixoCallError(`${what} could not reach the server`, 0);
    }
    if (signal.aborted) throw new ThixoRefused(what, "the plugin has stopped");
    if (!response.ok) throw await failure(response, what);
    return response;
  }

  async function call(name: string, input: unknown): Promise<unknown> {
    const why = refusal(name);
    if (why) throw new ThixoRefused(name, why);
    const spec = endpoints.get(name)!;
    let hostInput: unknown;
    try {
      hostInput = spec.input ? pluginToHost(spec.input, input, rt, records) : undefined;
    } catch (error) {
      if (error instanceof ConvertError) throw new ThixoRefused(name, `bad input: ${error.message}`);
      throw error;
    }
    const rest: Record<string, unknown> = hostInput && typeof hostInput === "object" && !Array.isArray(hostInput) ? { ...(hostInput as Record<string, unknown>) } : {};
    let missing: string | undefined;
    let path = spec.path.replace(/:([A-Za-z_]\w*)/g, (_, param: string) => {
      const value = rest[param];
      if (value === undefined || value === null) missing = param;
      delete rest[param];
      return encodeURIComponent(plainParam(value));
    });
    if (missing) throw new ThixoRefused(name, `bad input: missing path parameter "${missing}"`);
    path = `/api${path}`;
    const init: RequestInit & { headers: Record<string, string> } = { method: spec.method, headers: { accept: "application/json" } };
    const keys = Object.keys(rest).filter((k) => rest[k] !== undefined);
    if (spec.method === "GET" || spec.method === "DELETE") {
      const query = new URLSearchParams();
      for (const key of keys) for (const item of Array.isArray(rest[key]) ? (rest[key] as unknown[]) : [rest[key]]) query.append(key, plainParam(item));
      const text = query.toString();
      if (text) path += `?${text}`;
    } else if (keys.length) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(rest);
    }
    const response = await send(path, init, name);
    const text = response.status === 204 ? "" : await response.text();
    if (signal.aborted) throw new ThixoRefused(name, "the plugin has stopped");
    if (!text || !spec.output) return undefined;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ThixoCallError(`${name} answered with something that is not JSON`, response.status);
    }
    return rt.toThx(hostToPlugin(spec.output, body, rt, records));
  }

  function declsFor(at: { store: string } | { record: string }, what: string): FieldDecl[] {
    if ("store" in at) {
      const decls = manifest.data.stores[at.store];
      if (!decls) throw new ThixoRefused(what, `the plugin version declares no store "${at.store}"`);
      return decls;
    }
    const decls = manifest.data.annotations[at.record];
    if (!decls) throw new ThixoRefused(what, `the plugin version declares no annotation on "${at.record}"`);
    return decls;
  }

  function guard(op: keyof DataBodies, write: boolean): string {
    const what = `data.${op}`;
    if (signal.aborted) throw new ThixoRefused(what, "the plugin has stopped");
    if (write ? !load.authorData.write : !load.authorData.read) {
      throw new ThixoRefused(what, `the plugin's author does not hold thixo.data.${write ? "write" : "read"}`);
    }
    return what;
  }

  async function post<K extends keyof DataBodies>(op: K, body: DataBodies[K], what: string): Promise<unknown> {
    const response = await send(`/_thixo/data/${op}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, what);
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }

  function checkAt(at: DataAt, what: string): FieldDecl[] {
    if (typeof at.id !== "string" || at.id === "") throw new ThixoRefused(what, "a record id must be a non-empty string");
    return declsFor(at, what);
  }

  const data: DataBroker = {
    async read(at) {
      const what = guard("read", false);
      const decls = checkAt(at, what);
      const reply = (await post("read", { ...caller, at }, what)) as { fields?: unknown } | undefined;
      return rt.toThx(fieldsFromWire(decls, reply?.fields, rt));
    },
    async readMany(at) {
      const what = guard("read-many", false);
      const decls = at.map((a) => checkAt(a, what));
      if (at.length === 0) return rt.toThx([]);
      const reply = (await post("read-many", { ...caller, at }, what)) as { fields?: unknown[] } | undefined;
      const list = Array.isArray(reply?.fields) ? reply.fields : [];
      return rt.toThx(decls.map((d, i) => fieldsFromWire(d, list[i], rt)));
    },
    async patch(at, fields) {
      const what = guard("patch", true);
      const decls = checkAt(at, what);
      let wire: Record<string, unknown>;
      try {
        wire = fieldsToWire(decls, fields, rt);
      } catch (error) {
        if (error instanceof ConvertError) throw new ThixoRefused(what, `bad fields: ${error.message}`);
        throw error;
      }
      await post("patch", { ...caller, at, fields: wire }, what);
    },
    async list(store) {
      const what = guard("list", false);
      declsFor({ store }, what);
      const reply = (await post("list", { ...caller, store }, what)) as { ids?: unknown } | undefined;
      const ids = Array.isArray(reply?.ids) ? reply.ids.filter((id): id is string => typeof id === "string") : [];
      return rt.toThx(ids);
    },
    async remove(store, id) {
      const what = guard("remove", true);
      checkAt({ store, id }, what);
      await post("remove", { ...caller, store, id }, what);
    },
  };

  return {
    call,
    can: (endpoint) => refusal(endpoint) === undefined && userCan.has(endpoint),
    refusal,
    data,
  };
}
