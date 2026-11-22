import { isHttpError } from "../api/errors.js";
import type { AppInfo, EndpointDef, TokenReply, User } from "../contract.js";
import { coerceStrings, parseJson, serializeJson, SchemaError, type RecordTable } from "../schema/index.js";
import type { Route, ServerContext } from "./context.js";
import { generateSdk } from "./sdk.js";
import { signToken } from "./tokens.js";

function appInfo(ctx: ServerContext): AppInfo {
  const { app } = ctx;
  return {
    scopes: app.scopes,
    endpoints: app.endpoints.map((e) => ({ name: e.name, method: e.method, path: e.path, scopes: e.scopes })),
    records: app.records.map((r) => ({ name: r.name, exportName: r.exportName, read: r.read })),
    slots: app.slots,
    libraries: app.libraries.map((l) => l.specifier),
  };
}

async function readInput(ctx: ServerContext, endpoint: EndpointDef, records: RecordTable, request: Request, url: URL, params: Record<string, string>): Promise<unknown> {
  if (!endpoint.input) return undefined;

  const query: Record<string, unknown> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }
  const fromUrl = coerceStrings(endpoint.input, { ...query, ...params }, records);

  let body: unknown;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw ctx.httpError(400, "The request body is not valid JSON", { code: "bad_input" });
      }
    }
  }
  const bodyObject = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  if (body !== undefined && !bodyObject && Object.keys(fromUrl).length === 0) return body;
  return { ...fromUrl, ...bodyObject, ...pick(fromUrl, Object.keys(params)) };
}

function pick(from: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in from).map((k) => [k, from[k]]));
}

function apiRoute(ctx: ServerContext, endpoint: EndpointDef, records: RecordTable): Route {
  return {
    method: endpoint.method,
    path: `/api${endpoint.path}`,
    async handler({ request, url, params }) {
      const user: User = await ctx.authenticate(request);
      const missing = ctx.missing(user, endpoint.scopes);
      if (missing.length) {
        throw ctx.httpError(403, `Missing scope${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, { code: "missing_scopes", missingScopes: missing });
      }
      let input: unknown;
      try {
        const raw = await readInput(ctx, endpoint, records, request, url, params);
        input = endpoint.input ? parseJson(endpoint.input, raw, records) : undefined;
      } catch (error) {
        if (error instanceof SchemaError) throw ctx.httpError(400, `Bad input: ${error.message}`, { code: "bad_input", issues: error.issues });
        throw error;
      }
      let result: unknown;
      try {
        result = await endpoint.handler({ input, user, request });
      } catch (error) {
        if (isHttpError(error)) throw error;
        console.error(`endpoint ${endpoint.name} failed`, error);
        throw ctx.httpError(500, "The endpoint failed", { code: "internal" });
      }
      if (result === undefined) return new Response(null, { status: 204 });
      return ctx.json(serializeJson(endpoint.output, result, records));
    },
  };
}

/** The routes the app itself needs: the token, the app description, the SDK and the app's own endpoints. */
export function routes(ctx: ServerContext): Route[] {
  const records: RecordTable = Object.fromEntries(ctx.app.records.map((r) => [r.name, r.fields]));
  const sdk = generateSdk(ctx.app);
  return [
    {
      method: "POST",
      path: "/_thixo/token",
      async handler({ request }) {
        const identified = await ctx.identity.identify(request);
        if (!identified) throw ctx.httpError(401, "Not signed in");
        const user: User = { id: identified.id, scopes: [...identified.scopes], ...(identified.groups ? { groups: [...identified.groups] } : {}) };
        await ctx.adapters.data.rememberUser(user);
        const { token, expiresAt } = await signToken(ctx.signingKey, user);
        const reply: TokenReply = { token, expiresAt, user };
        return ctx.json(reply, { headers: { "cache-control": "no-store" } });
      },
    },
    { method: "GET", path: "/_thixo/app", handler: () => ctx.json(appInfo(ctx)) },
    {
      method: "GET",
      path: "/_thixo/sdk.js",
      handler: () => new Response(sdk, { headers: { "content-type": "text/javascript; charset=utf-8" } }),
    },
    ...ctx.app.endpoints.map((e) => apiRoute(ctx, e, records)),
  ];
}
