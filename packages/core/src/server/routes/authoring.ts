import type { User } from "../../contract.js";
import { readBody } from "../registry/http.js";
import { fail } from "../registry/errors.js";
import { runAuthoring, toolList, toolsOf } from "../authoring/loop.js";
import { GUARD_ADMIN_SCOPE, guardOf } from "../authoring/guard.js";
import type { AuthoringEvent } from "../authoring/types.js";
import type { Route, ServerContext } from "../context.js";

const AUTHOR_SCOPE = "thixo.plugins.author";

/** Compares sha256 digests without stopping at the first difference, so the time does not depend on the lengths or on
 * how much of the key matched. */
async function sameKey(given: string, expected: string): Promise<boolean> {
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function lines(events: AsyncIterable<AuthoringEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch (error) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) })}\n`));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export function routes(ctx: ServerContext): Route[] {
  const base = "/_thixo/authoring";
  const ndjson = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" };
  return [
    {
      method: "POST",
      path: `${base}/chat`,
      async handler({ request }) {
        const user = await ctx.authenticate(request);
        if (!ctx.holds(user, [AUTHOR_SCOPE])) {
          fail(ctx, 403, `The authoring chat needs the scope ${AUTHOR_SCOPE}`, "missing_scopes", { missingScopes: ctx.missing(user, [AUTHOR_SCOPE]) });
        }
        await guardOf(ctx).assertAllowed(user);
        const body = await readBody(ctx, request);
        if (typeof body.message !== "string" || !body.message.trim()) fail(ctx, 400, "message must be a non-empty string", "bad_request");
        if (body.conversation !== undefined && typeof body.conversation !== "string") fail(ctx, 400, "conversation must be a string", "bad_request");
        const model = ctx.config.model;
        if (!model) {
          const event: AuthoringEvent = { type: "error", message: "No model adapter is configured. Set `model` in the Thixo config, such as anthropic() from thixo-anthropic or claudeCode() from thixo-node." };
          return new Response(`${JSON.stringify(event)}\n`, { headers: ndjson });
        }
        return new Response(lines(runAuthoring(ctx, { user, conversation: body.conversation, message: body.message, model })), { headers: ndjson });
      },
    },
    {
      method: "POST",
      path: `${base}/tool`,
      async handler({ request }) {
        const expected = ctx.config.agentKey;
        if (!expected) fail(ctx, 404, "The tool route is off: this server has no agent key.", "not_found");
        const given = request.headers.get("x-thixo-agent-key");
        if (!given) fail(ctx, 401, "Send the agent key in the x-thixo-agent-key header.", "agent_key_missing");
        if (!(await sameKey(given, expected))) fail(ctx, 403, "The agent key is wrong.", "agent_key_wrong");

        const body = await readBody(ctx, request);
        if (typeof body.tool !== "string" || !body.tool) fail(ctx, 400, "tool must be the name of a tool", "bad_request");
        if (typeof body.as !== "string" || !body.as) fail(ctx, 400, "as must be a user id", "bad_request");
        const names = toolList(ctx).map((t) => t.name);
        if (!names.includes(body.tool)) fail(ctx, 404, `There is no tool named ${body.tool}. The tools are ${names.join(", ")}.`, "unknown_tool");

        const remembered = await ctx.adapters.data.recallUser(body.as);
        const scopes = await ctx.scopesOf(body.as);
        if (!remembered && !scopes.length) fail(ctx, 404, `Thixo does not know a user ${body.as}. They need to have signed in once, or the identity adapter's scopesOf must know them.`, "unknown_user");
        const user: User = { id: body.as, scopes, ...(remembered?.groups ? { groups: remembered.groups } : {}) };

        return ctx.json(await toolsOf(ctx).run(body.tool, body.input, user));
      },
    },
    {
      // The current user's own standing: the chat reads it to say, before anyone types, that they are blocked.
      method: "GET",
      path: `${base}/status`,
      async handler({ request }) {
        const user = await ctx.authenticate(request);
        return ctx.json(await guardOf(ctx).status(user.id));
      },
    },
    {
      method: "GET",
      path: `${base}/refusals`,
      async handler({ request, url }) {
        await admin(request);
        const user = url.searchParams.get("user") || undefined;
        const since = url.searchParams.get("since") || undefined;
        return ctx.json({ refusals: await guardOf(ctx).refusals({ ...(user ? { user } : {}), ...(since ? { since } : {}) }) });
      },
    },
    {
      method: "GET",
      path: `${base}/blocks`,
      async handler({ request, url }) {
        await admin(request);
        const all = url.searchParams.get("all");
        return ctx.json({ blocks: await guardOf(ctx).blocks({ all: all === "1" || all === "true" }) });
      },
    },
    {
      method: "DELETE",
      path: `${base}/blocks/:user`,
      async handler({ request, params }) {
        const who = await admin(request);
        return ctx.json(await guardOf(ctx).unblock(params.user, who.id));
      },
    },
  ];

  /** The guard's own records are the implementor's: they need a scope the implementor grants. */
  async function admin(request: Request): Promise<User> {
    const user = await ctx.authenticate(request);
    if (!ctx.holds(user, [GUARD_ADMIN_SCOPE])) {
      fail(ctx, 403, `Seeing refusals and lifting blocks needs the scope ${GUARD_ADMIN_SCOPE}`, "missing_scopes", { missingScopes: ctx.missing(user, [GUARD_ADMIN_SCOPE]) });
    }
    return user;
  }
}
