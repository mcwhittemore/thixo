import type { User } from "../../contract.js";
import type { Route, ServerContext } from "../context.js";
import { wholeNumber } from "../registry/http.js";
import { assetTicket, checkAssetTicket, checkCodeTicket, codeTicket } from "../tokens.js";
import { services } from "./registry.js";

export function routes(ctx: ServerContext): Route[] {
  const registry = services(ctx);

  /** The code route takes a token, or the ticket a load reply put in `code` so the shell can import it by address. */
  async function codeReader(request: Request, url: URL, plugin: string, version: number): Promise<User> {
    if (request.headers.has("authorization") || !url.searchParams.has("k")) return ctx.authenticate(request);
    const id = await checkCodeTicket(ctx.signingKey, url.searchParams, plugin, version);
    if (!id) throw ctx.httpError(401, "The code address has expired or is not for this version. Load the plugin again.", { code: "ticket_invalid" });
    return { id, scopes: await ctx.scopesOf(id) };
  }

  async function assetReader(request: Request, url: URL, plugin: string, version: number): Promise<User> {
    if (request.headers.has("authorization") || !url.searchParams.has("k")) return ctx.authenticate(request);
    const id = await checkAssetTicket(ctx.signingKey, url.searchParams, plugin, version);
    if (!id) throw ctx.httpError(401, "The file's address has expired or is not for this version. Load the plugin again.", { code: "ticket_invalid" });
    return { id, scopes: await ctx.scopesOf(id) };
  }

  return [
    {
      method: "GET",
      path: "/_thixo/plugins/:id/:n.js",
      async handler({ request, url, params }) {
        const number = wholeNumber(ctx, params.n, "version");
        const user = await codeReader(request, url, params.id, number);
        const code = await registry.code({ user, ref: { plugin: params.id, number } });
        return new Response(code, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      },
    },
    {
      method: "GET",
      path: "/_thixo/plugins/:id/:n/load",
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        const load = await registry.load({ user, ref: { plugin: params.id, number: wholeNumber(ctx, params.n, "version") } });
        const ticket = await codeTicket(ctx.signingKey, user.id, load.plugin.id, load.version);
        const files = await assetTicket(ctx.signingKey, user.id, load.plugin.id, load.version);
        return ctx.json({ ...load, code: `${load.code}?${ticket}`, assets: { ...load.assets, query: files } }, { headers: { "cache-control": "no-store" } });
      },
    },
    {
      // A file the build copied for this version (copy at build). Same rule as the code: a personal plugin's files
      // are its author's. Served so that, opened on its own, it can run nothing: an SVG is sandboxed by its CSP.
      method: "GET",
      path: "/_thixo/plugins/:id/:n/assets/:file",
      async handler({ request, url, params }) {
        const number = wholeNumber(ctx, params.n, "version");
        const user = await assetReader(request, url, params.id, number);
        const { bytes, contentType } = await registry.asset({ user, ref: { plugin: params.id, number }, file: params.file });
        return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: assetHeaders(contentType) });
      },
    },
  ];
}

/** Headers for a copied file. `nosniff` holds the browser to the stored type; the CSP's `sandbox` and
 * `default-src 'none'` mean an SVG opened directly runs no script and loads nothing; an SVG downloads rather than
 * opens. The address names a content hash, so it never changes, but it is the user's: `private`. */
export function assetHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "private, max-age=31536000, immutable",
    ...(contentType === "image/svg+xml" ? { "content-disposition": "attachment" } : {}),
  };
}
