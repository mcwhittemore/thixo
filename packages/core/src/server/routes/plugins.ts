import type { User } from "../../contract.js";
import type { Route, ServerContext } from "../context.js";
import { wholeNumber } from "../registry/http.js";
import { checkCodeTicket, codeTicket } from "../tokens.js";
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
        return ctx.json({ ...load, code: `${load.code}?${ticket}` }, { headers: { "cache-control": "no-store" } });
      },
    },
  ];
}
