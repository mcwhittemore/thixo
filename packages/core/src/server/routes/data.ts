import type { DataAt } from "../../contract.js";
import type { DataServices, DataTargetRef } from "../registry/types.js";
import type { Route, ServerContext } from "../context.js";
import { fail } from "../registry/errors.js";
import { readBody, text, wholeNumber } from "../registry/http.js";
import { services } from "./registry.js";

type Handler = (data: DataServices, user: Parameters<DataServices["read"]>[0], input: any) => Promise<unknown>;

/** The bodies are `DataBodies` in the contract: every one names the plugin version (`plugin`, `version`), and a
 * target is `at: { store, id } | { record, id }`. `read` answers `{ fields }`, `read-many` `{ fields: [...] }` in the
 * order asked (a record the user can't read comes back as `{}`), `list` `{ ids }`, and `patch` and `remove` 204. */
export function routes(ctx: ServerContext): Route[] {
  const data = services(ctx).data;

  function where(value: unknown, name: string): DataTargetRef & { id: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(ctx, 400, `${name} must be { store, id } or { record, id }`, "bad_request");
    const at = value as Record<string, unknown>;
    const store = at.store === undefined ? undefined : text(ctx, at.store, `${name}.store`);
    const record = at.record === undefined ? undefined : text(ctx, at.record, `${name}.record`);
    if ((store === undefined) === (record === undefined)) fail(ctx, 400, "Name a store or a record, not both", "bad_request");
    const id = text(ctx, at.id, `${name}.id`);
    return store !== undefined ? { store, id } : { record: record!, id };
  }
  function scope(body: Record<string, unknown>) {
    return { plugin: text(ctx, body.plugin, "plugin"), version: wholeNumber(ctx, body.version, "version") };
  }

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
    route("read", async (d, u, b) => ({ fields: (await d.read(u, { ...scope(b), ...where(b.at, "at") })).fields })),
    route("read-many", async (d, u, b) => {
      if (!Array.isArray(b.at)) fail(ctx, 400, "at must be a list", "bad_request");
      const at = (b.at as DataAt[]).map((a, i) => where(a, `at[${i}]`));
      const groups = new Map<string, { ref: DataTargetRef; ids: string[] }>();
      for (const a of at) {
        const key = a.store !== undefined ? `s:${a.store}` : `r:${a.record}`;
        const ref: DataTargetRef = a.store !== undefined ? { store: a.store } : { record: a.record! };
        const group = groups.get(key) ?? groups.set(key, { ref, ids: [] }).get(key)!;
        group.ids.push(a.id);
      }
      const found = new Map<string, Record<string, unknown>>();
      for (const [key, group] of groups) {
        for (const r of await d.readMany(u, { ...scope(b), ...group.ref, ids: group.ids })) found.set(`${key}:${r.id}`, r.fields);
      }
      return { fields: at.map((a) => found.get(`${a.store !== undefined ? `s:${a.store}` : `r:${a.record}`}:${a.id}`) ?? {}) };
    }),
    route("patch", async (d, u, b) => {
      await d.patch(u, { ...scope(b), ...where(b.at, "at"), fields: b.fields as Record<string, unknown> });
    }),
    route("list", async (d, u, b) => ({ ids: (await d.list(u, { ...scope(b), store: text(ctx, b.store, "store") })).map((r) => r.id) })),
    route("remove", (d, u, b) => d.remove(u, { ...scope(b), store: text(ctx, b.store, "store"), id: text(ctx, b.id, "id") })),
    route("remove-field", (d, u, b) => {
      const store = b.store === undefined ? undefined : text(ctx, b.store, "store");
      const record = b.record === undefined ? undefined : text(ctx, b.record, "record");
      if ((store === undefined) === (record === undefined)) fail(ctx, 400, "Name a store or a record, not both", "bad_request");
      const target: DataTargetRef = store !== undefined ? { store } : { record: record! };
      return d.removeField(u, { plugin: text(ctx, b.plugin, "plugin"), ...target, field: text(ctx, b.field, "field") });
    }),
  ];
}
