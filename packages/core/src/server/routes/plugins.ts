import type { Route, ServerContext } from "../context.js";
import { wholeNumber } from "../registry/http.js";
import { services } from "./registry.js";

export function routes(ctx: ServerContext): Route[] {
  const registry = services(ctx);
  return [
    {
      method: "GET",
      path: "/_thixo/plugins/:id/:n.js",
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        const code = await registry.code({ user, ref: { plugin: params.id, number: wholeNumber(ctx, params.n, "version") } });
        return new Response(code, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } });
      },
    },
    {
      method: "GET",
      path: "/_thixo/plugins/:id/:n/load",
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        return ctx.json(await registry.load({ user, ref: { plugin: params.id, number: wholeNumber(ctx, params.n, "version") } }), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  ];
}
