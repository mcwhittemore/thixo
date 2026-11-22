import type { LayoutReply, User } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { versionOf, visiblePlugin } from "./access.js";
import { fail, missingScopes } from "./errors.js";
import { requiredScopes } from "./scopes.js";
import type { LayoutServices } from "./types.js";

/** S9: the newest release is the default, and what a user changed sits over it. A slot they never changed follows
 * the next release. A slot they changed stays where they put it. */
export function createLayoutServices(ctx: ServerContext): LayoutServices {
  const data = ctx.adapters.data;

  async function get(user: User): Promise<LayoutReply> {
    const defaults = (await data.latestRelease())?.layout ?? {};
    const changes = await data.getLayoutChanges(user.id);
    return { defaults, changes, resolved: { ...defaults, ...changes } };
  }

  return {
    get,

    async set(user, { slot, plugin: id, number }) {
      const plugin = await visiblePlugin(ctx, user, id);
      const version = await versionOf(ctx, { plugin: id, number });
      missingScopes(ctx, user, requiredScopes(ctx, version.manifest), `Using ${plugin.name}`);
      const name = slot.split("/").filter(Boolean).pop();
      if (!name || version.manifest.slot !== name) {
        fail(ctx, 400, `${plugin.name} fills the slot "${version.manifest.slot}", not "${name ?? slot}"`, "wrong_slot");
      }
      await data.setLayoutSlot(user.id, slot, { plugin: id, number });
      return get(user);
    },

    async reset(user, slot) {
      await data.setLayoutSlot(user.id, slot, null);
      return get(user);
    },
  };
}
