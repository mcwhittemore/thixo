import type { Route, ServerContext } from "../context.js";
import { readBody, text, wholeNumber } from "../registry/http.js";
import { services } from "./registry.js";

/** A slot path has slashes (`main/todo-row`), so it travels in the URL percent-encoded: `/_thixo/layout/main%2Ftodo-row`. */
export function routes(ctx: ServerContext): Route[] {
  const layout = services(ctx).layout;
  return [
    {
      method: "GET",
      path: "/_thixo/layout",
      async handler({ request }) {
        return ctx.json(await layout.get(await ctx.authenticate(request)));
      },
    },
    {
      method: "PUT",
      path: "/_thixo/layout/:slot",
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        const body = await readBody(ctx, request);
        return ctx.json(await layout.set(user, { slot: params.slot, plugin: text(ctx, body.plugin, "plugin"), number: wholeNumber(ctx, body.number, "number") }));
      },
    },
    {
      method: "DELETE",
      path: "/_thixo/layout/:slot",
      async handler({ request, params }) {
        return ctx.json(await layout.reset(await ctx.authenticate(request), params.slot));
      },
    },
  ];
}
