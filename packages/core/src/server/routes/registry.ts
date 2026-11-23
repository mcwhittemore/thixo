import type { RegistryServices, Route, ServerContext } from "../context.js";
import { fail } from "../registry/errors.js";
import { readBody, wholeNumber } from "../registry/http.js";
import { trackContext } from "../registry/record-deleted.js";
import { createRegistryServices } from "../registry/service.js";

const registries = new WeakMap<ServerContext, RegistryServices>();

/** One service layer per context, shared by the routes and by `createThixo`'s `services`. */
export function services(ctx: ServerContext): RegistryServices {
  let registry = registries.get(ctx);
  if (!registry) {
    registry = createRegistryServices(ctx);
    registries.set(ctx, registry);
    trackContext(ctx);
  }
  return registry;
}

export function routes(ctx: ServerContext): Route[] {
  const registry = services(ctx);
  const base = "/_thixo/registry";
  return [
    {
      method: "GET",
      path: `${base}/search`,
      async handler({ request, url }) {
        const user = await ctx.authenticate(request);
        return ctx.json(await registry.search({ user, q: url.searchParams.get("q") ?? undefined, slot: url.searchParams.get("slot") ?? undefined }));
      },
    },
    {
      method: "GET",
      path: `${base}/plugins/:id`,
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        return ctx.json(await registry.getPlugin({ user, plugin: params.id }));
      },
    },
    {
      method: "POST",
      path: `${base}/plugins/:id/fork`,
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        const body = await readBody(ctx, request);
        const number = wholeNumber(ctx, body.version, "version");
        if (body.empty !== undefined && typeof body.empty !== "boolean") fail(ctx, 400, "empty must be true or false", "bad_request");
        return ctx.json(await registry.fork({ user, ref: { plugin: params.id, number }, empty: body.empty as boolean | undefined }), 201);
      },
    },
    {
      method: "POST",
      path: `${base}/plugins/:id/share`,
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        return ctx.json(await registry.share({ user, plugin: params.id }));
      },
    },
    {
      method: "POST",
      path: `${base}/plugins/:id/promote`,
      async handler({ request, params }) {
        const user = await ctx.authenticate(request);
        const body = await readBody(ctx, request);
        const version = body.version === undefined ? undefined : wholeNumber(ctx, body.version, "version");
        return ctx.json(await registry.promote({ user, plugin: params.id, version }));
      },
    },
  ];
}
