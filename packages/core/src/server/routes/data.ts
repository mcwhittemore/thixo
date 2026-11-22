import type { DataServices } from "../registry/types.js";
import type { Route, ServerContext } from "../context.js";
import { fail } from "../registry/errors.js";
import { readBody, text, wholeNumber } from "../registry/http.js";
import { services } from "./registry.js";

type Handler = (data: DataServices, user: Parameters<DataServices["read"]>[0], input: any) => Promise<unknown>;

/** Every body names the plugin version (`plugin`, `version`) and one target: `store` or `record`. */
export function routes(ctx: ServerContext): Route[] {
  const data = services(ctx).data;

  function target(body: Record<string, unknown>) {
    const store = body.store === undefined ? undefined : text(ctx, body.store, "store");
    const record = body.record === undefined ? undefined : text(ctx, body.record, "record");
    if ((store === undefined) === (record === undefined)) fail(ctx, 400, "Name a store or a record, not both", "bad_request");
    return store !== undefined ? { store } : { record: record! };
  }
  function scope(body: Record<string, unknown>) {
    return { plugin: text(ctx, body.plugin, "plugin"), version: wholeNumber(ctx, body.version, "version") };
  }
  const optionalId = (body: Record<string, unknown>) => (body.id === undefined ? undefined : text(ctx, body.id, "id"));

  const route = (name: string, run: Handler): Route => ({
    method: "POST",
    path: `/_thixo/data/${name}`,
    async handler({ request }) {
      const user = await ctx.authenticate(request);
      const body = await readBody(ctx, request);
      const result = await run(data, user, body);
      return result === undefined ? new Response(null, { status: 204 }) : ctx.json(result);
    },
  });

  return [
    route("read", (d, u, b) => d.read(u, { ...scope(b), ...target(b), id: optionalId(b) })),
    route("read-many", async (d, u, b) => {
      if (!Array.isArray(b.ids)) fail(ctx, 400, "ids must be a list", "bad_request");
      return { records: await d.readMany(u, { ...scope(b), ...target(b), ids: b.ids as string[] }) };
    }),
    route("patch", (d, u, b) =>
      d.patch(u, { ...scope(b), ...target(b), id: optionalId(b), create: b.create === true, fields: b.fields as Record<string, unknown> }),
    ),
    route("list", async (d, u, b) => ({ records: await d.list(u, { ...scope(b), store: text(ctx, b.store, "store") }) })),
    route("remove", (d, u, b) => d.remove(u, { ...scope(b), store: text(ctx, b.store, "store"), id: text(ctx, b.id, "id") })),
    route("remove-field", (d, u, b) => d.removeField(u, { plugin: text(ctx, b.plugin, "plugin"), ...target(b), field: text(ctx, b.field, "field") })),
  ];
}
