import type { AgentEvent, AppInfo, LayoutReply, PluginLoad, PluginSummary, PluginVersionRef, SchemaJson } from "../contract.js";
import { ThixoCallError } from "../plugin-host/refused.js";
import type { Session } from "./session.js";

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    let message = `${what} failed with ${response.status}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) message = body.error.message;
      code = body.error?.code;
    } catch {
      // Not JSON: keep the status.
    }
    throw new ThixoCallError(message, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

/** Every route under `/_thixo` the shell uses, bound to one session. */
export function createClient(session: Session) {
  const authed = (path: string, init: RequestInit = {}) => session.request(path, init);
  const send = (method: string, path: string, body?: unknown) =>
    authed(path, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  return {
    async app(): Promise<AppInfo> {
      return json(await session.plain("/_thixo/app"), "Loading the app");
    },
    async layout(): Promise<LayoutReply> {
      return json(await authed("/_thixo/layout"), "Loading the layout");
    },
    async pluginLoad(ref: PluginVersionRef): Promise<PluginLoad> {
      return json(await authed(`/_thixo/plugins/${enc(ref.plugin)}/${ref.number}/load`), "Loading the plugin");
    },
    /** The compiled module's text, fetched with the token: a personal plugin is served to its author only. */
    async pluginCode(code: string): Promise<string> {
      const response = await authed(code, { headers: { accept: "text/javascript" } });
      if (!response.ok) await json(response, "Loading the plugin's code");
      return response.text();
    },
    async search(q: string, slot?: string): Promise<PluginSummary[]> {
      const params = new URLSearchParams({ q });
      if (slot) params.set("slot", slot);
      return json(await authed(`/_thixo/registry/search?${params}`), "Searching");
    },
    async plugin(id: string): Promise<PluginSummary> {
      return json(await authed(`/_thixo/registry/plugins/${enc(id)}`), "Loading the plugin");
    },
    async use(slot: string, ref: PluginVersionRef): Promise<void> {
      await json(await send("PUT", `/_thixo/layout/${enc(slot)}`, { plugin: ref.plugin, number: ref.number }), "Using the plugin");
    },
    async reset(slot: string): Promise<void> {
      await json(await send("DELETE", `/_thixo/layout/${enc(slot)}`), "Resetting the slot");
    },
    async fork(id: string, version: number, empty = false): Promise<unknown> {
      return json(await send("POST", `/_thixo/registry/plugins/${enc(id)}/fork`, { version, ...(empty ? { empty } : {}) }), "Forking");
    },
    async share(id: string): Promise<unknown> {
      return json(await send("POST", `/_thixo/registry/plugins/${enc(id)}/share`, {}), "Sharing");
    },
    async promote(id: string): Promise<unknown> {
      return json(await send("POST", `/_thixo/registry/plugins/${enc(id)}/promote`, {}), "Promoting");
    },
    /** Streams the authoring agent's events: newline-delimited JSON. */
    async *chat(message: string, conversation?: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      const response = await authed("/_thixo/authoring/chat", {
        method: "POST",
        headers: { accept: "application/x-ndjson", "content-type": "application/json" },
        body: JSON.stringify({ message, ...(conversation ? { conversation } : {}) }),
        signal,
      });
      if (!response.ok || !response.body) {
        await json(response, "The authoring chat");
        return;
      }
      yield* readLines(response.body);
    },
  };
}

export type Client = ReturnType<typeof createClient>;

/** An event from the authoring chat: the agent's events, plus a conversation id or an error the server may send. */
export type ChatEvent = AgentEvent | { type: "conversation"; id: string } | { type: "error"; message: string } | { type: string; [key: string]: unknown };

export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield parseLine(line);
    }
    if (done) break;
  }
  if (buffer.trim()) yield parseLine(buffer.trim());
}

function parseLine(line: string): ChatEvent {
  try {
    const event = JSON.parse(line) as ChatEvent;
    return event && typeof event === "object" && typeof event.type === "string" ? event : { type: "error", message: "An event without a type" };
  } catch {
    return { type: "error", message: `Not JSON: ${line.slice(0, 120)}` };
  }
}

type Records = Record<string, Record<string, SchemaJson>>;

function revive(schema: SchemaJson | undefined, value: unknown, records: Records): unknown {
  if (value === null || value === undefined || !schema) return value;
  switch (schema.kind) {
    case "date":
      return typeof value === "string" ? new Date(value) : value;
    case "optional":
      return revive(schema.of, value, records);
    case "array":
      return Array.isArray(value) ? value.map((v) => revive(schema.of, v, records)) : value;
    case "object":
    case "record": {
      const fields = schema.kind === "object" ? schema.fields : records[schema.name];
      if (!fields || typeof value !== "object") return value;
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const key of Object.keys(fields)) if (key in out) out[key] = revive(fields[key], out[key], records);
      return out;
    }
    default:
      return value;
  }
}

function plain(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export type ApiFunction = (input?: unknown) => Promise<any>;

/** The API SDK for the implementor's own shell code (A9), built from `AppInfo` and bound to the session: one
 * function per endpoint, taking its input. It makes the same requests as `/_thixo/sdk.js`. Dates in replies are
 * `Date`s; urls are strings, as the base app is not a plugin. */
export function createApi(app: AppInfo, session: Session): Record<string, ApiFunction> {
  const records: Records = Object.fromEntries(app.records.map((r) => [r.name, r.fields ?? {}]));
  const api: Record<string, ApiFunction> = {};
  for (const spec of app.endpoints) {
    api[spec.name] = async (input?: unknown) => {
      const rest: Record<string, unknown> = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
      let path = spec.path.replace(/:([A-Za-z_]\w*)/g, (_, name: string) => {
        if (rest[name] === undefined || rest[name] === null) throw new Error(`${spec.name}: missing path parameter "${name}"`);
        const value = rest[name];
        delete rest[name];
        return encodeURIComponent(plain(value));
      });
      path = `/api${path}`;
      const init: RequestInit & { headers: Record<string, string> } = { method: spec.method, headers: { accept: "application/json" } };
      const keys = Object.keys(rest).filter((k) => rest[k] !== undefined);
      if (spec.method === "GET" || spec.method === "DELETE") {
        const query = new URLSearchParams();
        for (const key of keys) for (const item of Array.isArray(rest[key]) ? (rest[key] as unknown[]) : [rest[key]]) query.append(key, plain(item));
        if (query.toString()) path += `?${query}`;
      } else if (keys.length) {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(rest);
      }
      const body = await json<unknown>(await session.request(path, init), spec.name);
      return revive(spec.output, body, records);
    };
  }
  return api;
}
