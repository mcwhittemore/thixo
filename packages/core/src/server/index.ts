import { isHttpError } from "../api/errors.js";
import type { AppDefinition, ThixoConfig } from "../contract.js";
import { routes as appRoutes } from "./app-routes.js";
import { createContext, type Route, type ServerContext, type Services } from "./context.js";
import type { Manifest } from "thixo-thx/contract";
import { optionalScopes, requiredScopes } from "./registry/scopes.js";
import { summarise } from "./registry/summary.js";
import { scopeLabel } from "../scope-words.js";
import { deploy } from "./deploy.js";
import { createRouter } from "./router.js";
import { routes as authoringRoutes } from "./routes/authoring.js";
import { routes as dataRoutes } from "./routes/data.js";
import { routes as layoutRoutes } from "./routes/layout.js";
import { routes as pluginsRoutes } from "./routes/plugins.js";
import { routes as registryRoutes, services as registryServices } from "./routes/registry.js";
import { guardOf } from "./authoring/guard.js";

export { collectApp } from "../api/collect.js";
export { HttpError } from "../api/errors.js";
export { buildCompileEnv } from "./compile-env.js";
export { createContext } from "./context.js";
export type { Route, RouteCall, RouteMethod, ServerContext, Services, RegistryServices } from "./context.js";
export { DeployError } from "./deploy.js";
export type { DeployInput, DeployResult } from "./deploy.js";
export { runAuthoring, scriptedModel } from "./authoring/index.js";
export type { AuthoringEvent, AuthoringRequest, ScriptedModel, ScriptedStep, ScriptedTurn } from "./authoring/index.js";
export { DEFAULT_REFUSAL_LIMIT, DEFAULT_REFUSAL_WINDOW_HOURS, REFUSAL_CATEGORIES, blockedMessage } from "./authoring/guard.js";
export type { AuthoringGuard } from "./authoring/guard.js";
export { flagSource } from "./authoring/source-check.js";
export { recordDeleted } from "./registry/record-deleted.js";
export { isAddress } from "./registry/plugin-data.js";
export { buildWithCopies, ASSET_LIMITS, ASSET_TYPES } from "./registry/assets.js";
export type { BuildOutcome, BuiltPlugin } from "./registry/assets.js";
export { withPluginId, withoutPluginId, readPluginId } from "./registry/plugin-source.js";
export { STORE_SINGLETON_ID } from "./registry/types.js";
export type { DataServices, LayoutServices, PluginDetail, PromotionReply, SubmitResult, VersionInfo } from "./registry/types.js";
export { generateSdk } from "./sdk.js";
export { signToken, verifyToken, userOf, TokenError, TOKEN_LIFETIME_SECONDS } from "./tokens.js";
export type { TokenClaims } from "./tokens.js";

export interface Thixo {
  /** Web-standard: a `Request` in, a `Response` out (X3). Mount it under any host. */
  fetch(request: Request): Promise<Response>;
  services: Services;
}

function errorResponse(status: number, code: string, message: string, details?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { code, message, ...details } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function createThixo(app: AppDefinition, config: ThixoConfig): Thixo {
  const ctx = createContext(app, config);
  const all: Route[] = [
    ...appRoutes(ctx),
    ...registryRoutes(ctx),
    ...pluginsRoutes(ctx),
    ...dataRoutes(ctx),
    ...layoutRoutes(ctx),
    ...authoringRoutes(ctx),
  ];
  const router = createRouter(all);

  return {
    services: {
      deploy: (input) => deploy(ctx, input),
      registry: registryServices(ctx),
      authoring: (() => {
        const guard = guardOf(ctx);
        return { status: guard.status, refusals: guard.refusals, blocks: guard.blocks, unblock: guard.unblock };
      })(),
    },
    async fetch(request) {
      const url = new URL(request.url);
      const match = router.match(request.method.toUpperCase(), url.pathname);
      if (!match) return errorResponse(404, "not_found", `No route for ${request.method} ${url.pathname}`);
      try {
        return await match.route.handler({ request, url, params: match.params });
      } catch (error) {
        if (isHttpError(error)) return errorResponse(error.status, error.code, error.message, error.details);
        console.error(`${request.method} ${url.pathname} failed`, error);
        return errorResponse(500, "internal", "Something went wrong on the server");
      }
    },
  };
}
export { slotPaths, resolveSlotPath } from "../slots/paths.js";

/** What the registry tells a user about a plugin built from `manifest` in `app` (G5): the summary sentences and the
 * scopes. `thixo compile` prints the same words the plugin browser and `thixo agent check` show. */
export function describeManifest(
  app: AppDefinition,
  manifest: Manifest,
): { summary: string[]; requiredScopes: string[]; optionalScopes: string[]; scopeLabels: Record<string, string> } {
  const ctx = { app } as ServerContext;
  const required = requiredScopes(ctx, manifest);
  const optional = optionalScopes(ctx, manifest);
  const scopeLabels = Object.fromEntries([...required, ...optional].map((scope) => [scope, scopeLabel(app.scopes, scope)]));
  return { summary: summarise(ctx, manifest), requiredScopes: required, optionalScopes: optional, scopeLabels };
}

export { scopeLabel, scopeSentence } from "../scope-words.js";
