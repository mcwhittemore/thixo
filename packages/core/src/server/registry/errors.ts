import { HttpError } from "../../api/errors.js";
import type { ServerContext } from "../context.js";

export function fail(_ctx: ServerContext, status: number, message: string, code?: string, extra: Record<string, unknown> = {}): never {
  throw new HttpError(status, message, { code, details: Object.keys(extra).length ? extra : undefined });
}

export function missingScopes(ctx: ServerContext, user: { id: string; scopes: string[] }, scopes: string[], what: string): void {
  const missing = ctx.missing(user, scopes);
  if (missing.length) fail(ctx, 403, `${what} needs ${missing.length > 1 ? "scopes" : "the scope"} ${missing.join(", ")}`, "missing_scopes", { missingScopes: missing });
}
