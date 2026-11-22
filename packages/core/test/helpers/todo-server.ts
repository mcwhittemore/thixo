import * as scopesModule from "../../../../examples/todo/api/scopes.js";
import * as sessionModule from "../../../../examples/todo/api/session.js";
import * as todosModule from "../../../../examples/todo/api/todos.js";
import * as slotsModule from "../../../../examples/todo/app/slots.js";
import { collectApp } from "../../src/api/index.js";
import type { AppInfo, LayoutReply, PluginLoad, PluginSummary, PluginVersionRef } from "../../src/contract.js";
import { defineConfig } from "../../src/index.js";
import { createThixo } from "../../src/server/index.js";
import { memoryAdapters } from "./adapters.js";

export const ORIGIN = "http://thixo.test";

export const app = collectApp([scopesModule, sessionModule, todosModule, slotsModule] as Record<string, unknown>[], {});

export const thixo = createThixo(
  app,
  defineConfig({
    identity: {
      identify: async (request) => {
        const s = await sessionModule.readSession(request);
        return s && { id: s.userId, scopes: s.scopes, groups: s.groups };
      },
      scopesOf: sessionModule.scopesOf,
    },
    adapters: memoryAdapters(),
    layout: { main: "todo-list" },
  }),
);

export interface FakeVersion {
  load: PluginLoad;
  code: string;
}

export interface Recorded {
  method: string;
  path: string;
  body?: unknown;
  authorization?: string | null;
}

/** The real server for the token, `/_thixo/app` and `/api`, and in-memory stand-ins for the routes other agents
 * build: layout, plugin loads and code, registry, plugin data and authoring. Every request is recorded. */
export function fakeServer(options: { user: string; versions: FakeVersion[]; layout: Record<string, PluginVersionRef>; summaries?: PluginSummary[]; chat?: string[] }) {
  const requests: Recorded[] = [];
  const changes: Record<string, PluginVersionRef> = {};
  const data = new Map<string, Record<string, unknown>>();
  const storeIds = new Map<string, string[]>();
  const versions = new Map(options.versions.map((v) => [`${v.load.plugin.id}/${v.load.version}`, v]));

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const layout = (): LayoutReply => ({ defaults: options.layout, changes: { ...changes }, resolved: { ...options.layout, ...changes } });
  const key = (at: { store?: string; record?: string; id: string }) => (at.store ? `store:${at.store}:${at.id}` : `record:${at.record}:${at.id}`);

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    requests.push({ method, path: url.pathname + url.search, body, authorization: headers.get("authorization") });
    const path = url.pathname;
    if (path === "/_thixo/token" || path === "/_thixo/app" || path.startsWith("/api/")) {
      headers.set("cookie", `thixo-user=${options.user}`);
      return thixo.fetch(new Request(url, { method, headers, body: bodyText }));
    }
    if (!headers.get("authorization")?.startsWith("Bearer ")) return json({ error: { code: "unauthorized", message: "No token" } }, 401);
    if (path === "/_thixo/layout") return json(layout());
    let m = /^\/_thixo\/layout\/(.+)$/.exec(path);
    if (m) {
      const slot = decodeURIComponent(m[1]);
      if (method === "PUT") changes[slot] = body as PluginVersionRef;
      else delete changes[slot];
      return new Response(null, { status: 204 });
    }
    m = /^\/_thixo\/plugins\/([^/]+)\/(\d+)\/load$/.exec(path);
    if (m) {
      const v = versions.get(`${m[1]}/${m[2]}`);
      return v ? json(v.load) : json({ error: { code: "not_found", message: "No such version" } }, 404);
    }
    m = /^\/_thixo\/plugins\/([^/]+)\/(\d+)\.js$/.exec(path);
    if (m) {
      const v = versions.get(`${m[1]}/${m[2]}`);
      return v ? new Response(v.code, { headers: { "content-type": "text/javascript" } }) : json({ error: { message: "No such version" } }, 404);
    }
    if (path === "/_thixo/registry/search") return json(options.summaries ?? []);
    m = /^\/_thixo\/registry\/plugins\/([^/]+)$/.exec(path);
    if (m) {
      const s = options.summaries?.find((x) => x.plugin.id === m![1]);
      return s ? json(s) : json({ error: { message: "No such plugin" } }, 404);
    }
    m = /^\/_thixo\/registry\/plugins\/([^/]+)\/(fork|share|promote)$/.exec(path);
    if (m) return json({ ok: true });
    m = /^\/_thixo\/data\/(read|read-many|patch|list|remove)$/.exec(path);
    if (m) {
      const op = m[1];
      if (op === "read") return json({ fields: data.get(key(body.at)) ?? {} });
      if (op === "read-many") return json({ fields: body.at.map((at: never) => data.get(key(at)) ?? {}) });
      if (op === "patch") {
        data.set(key(body.at), { ...(data.get(key(body.at)) ?? {}), ...body.fields });
        if (body.at.store) {
          const ids = storeIds.get(body.at.store) ?? [];
          if (!ids.includes(body.at.id)) storeIds.set(body.at.store, [...ids, body.at.id]);
        }
        return new Response(null, { status: 204 });
      }
      if (op === "list") return json({ ids: storeIds.get(body.store) ?? [] });
      if (op === "remove") {
        data.delete(key({ store: body.store, id: body.id }));
        storeIds.set(body.store, (storeIds.get(body.store) ?? []).filter((id) => id !== body.id));
        return new Response(null, { status: 204 });
      }
    }
    if (path === "/_thixo/authoring/chat") {
      return new Response((options.chat ?? []).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } });
    }
    return json({ error: { code: "not_found", message: `No route ${method} ${path}` } }, 404);
  }

  const fetch = (input: string, init: RequestInit = {}) => handle(new URL(input, ORIGIN), init);
  return { fetch, requests, data, changes };
}

export async function appInfo(): Promise<AppInfo> {
  return (await thixo.fetch(new Request(`${ORIGIN}/_thixo/app`))).json() as Promise<AppInfo>;
}
