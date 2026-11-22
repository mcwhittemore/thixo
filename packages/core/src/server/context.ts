import { HttpError } from "../api/errors.js";
import { IMPLEMENTOR, type Adapters, type AppDefinition, type IdentityAdapter, type ThixoConfig, type User, type UserId } from "../contract.js";
import type { CompileEnv } from "thixo-thx/contract";
import { buildCompileEnv } from "./compile-env.js";
import type { DeployInput, DeployResult } from "./deploy.js";
import type { RegistryServices } from "./registry/types.js";
import { TokenError, userOf, verifyToken } from "./tokens.js";

export { HttpError };

export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL";

export interface RouteCall {
  request: Request;
  url: URL;
  /** `:name` segments of the route's path, decoded. */
  params: Record<string, string>;
}

/** One route. A route module exports `routes(ctx): Route[]`. Throw an `HttpError` to answer with its status. */
export interface Route {
  method: RouteMethod;
  /** Absolute, such as `/_thixo/registry/plugins/:id/fork`. A segment may be `:n.js`. */
  path: string;
  handler(call: RouteCall): Response | Promise<Response>;
}

export type { RegistryServices };

/** What the host (the CLI, a test) can call on the server directly, beside `fetch`. */
export interface Services {
  deploy(input: DeployInput): Promise<DeployResult>;
  registry: RegistryServices;
}

export interface ServerContext {
  app: AppDefinition;
  config: ThixoConfig;
  adapters: Adapters;
  /** The identity adapter, as `{ identify, scopesOf? }` whichever way it was written. */
  identity: Exclude<IdentityAdapter, Function>;
  /** The bearer token's user. Throws an `HttpError`: 401 when it is missing, malformed, tampered or expired. */
  authenticate(request: Request): Promise<User>;
  /** The scopes Thixo believes a user holds now: the identity adapter's `scopesOf`, else what was saved when it
   * last issued them a token. `IMPLEMENTOR` holds every scope. Empty when the user is unknown. */
  scopesOf(userId: UserId): Promise<string[]>;
  /** A3: whether `user` holds every one of `scopes`. `IMPLEMENTOR` does. */
  holds(user: { id: UserId; scopes: string[] }, scopes: string[]): boolean;
  /** The scopes of `scopes` that `user` lacks. */
  missing(user: { id: UserId; scopes: string[] }, scopes: string[]): string[];
  /** A JSON response. Dates are written as ISO strings. */
  json(data: unknown, init?: number | ResponseInit): Response;
  /** An error to throw. */
  httpError(status: number, message: string, details?: Record<string, unknown>): HttpError;
  /** What the compiler needs about the app (the contract's `CompileEnv`). */
  compileEnv: CompileEnv;
  /** Signs a token for a user. Used by the token route. */
  signingKey: string;
}

export function createContext(app: AppDefinition, config: ThixoConfig): ServerContext {
  const identity = typeof config.identity === "function" ? { identify: config.identity } : config.identity;
  const adapters = config.adapters;
  const signingKey = config.signingKey ?? randomKey();

  const missing: ServerContext["missing"] = (user, scopes) => (user.id === IMPLEMENTOR ? [] : scopes.filter((s) => !user.scopes.includes(s)));

  return {
    app,
    config,
    adapters,
    identity,
    signingKey,
    compileEnv: buildCompileEnv(app, config),
    holds: (user, scopes) => missing(user, scopes).length === 0,
    missing,
    json,
    httpError: (status, message, details) => new HttpError(status, message, { details }),
    async scopesOf(userId) {
      if (userId === IMPLEMENTOR) return Object.keys(app.scopes);
      const fromIdentity = await identity.scopesOf?.(userId);
      if (fromIdentity) return fromIdentity;
      return (await adapters.data.recallUser(userId))?.scopes ?? [];
    },
    async authenticate(request) {
      const header = request.headers.get("authorization");
      const match = header && /^Bearer\s+(.+)$/i.exec(header);
      if (!match) throw new HttpError(401, "Send a token as `Authorization: Bearer <token>`. Get one from POST /_thixo/token.");
      try {
        return userOf(await verifyToken(signingKey, match[1].trim()));
      } catch (error) {
        if (error instanceof TokenError) throw new HttpError(401, error.message, { code: error.reason === "expired" ? "token_expired" : "invalid_token" });
        throw error;
      }
    },
  };
}

export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const options = typeof init === "number" ? { status: init } : init;
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...options, headers });
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
