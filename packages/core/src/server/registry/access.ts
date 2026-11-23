import type { Plugin, PluginId, PluginVersion, PluginVersionRef, User } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { fail } from "./errors.js";

/** A personal plugin is seen by its author. A shared or default one by everyone. */
export function canSee(user: Pick<User, "id">, plugin: Plugin): boolean {
  return plugin.visibility === "shared" || plugin.author === user.id;
}

export async function visiblePlugin(ctx: ServerContext, user: User, id: PluginId): Promise<Plugin> {
  const plugin = await ctx.adapters.data.getPlugin(id);
  if (!plugin || !canSee(user, plugin)) fail(ctx, 404, `There is no plugin ${id}`, "plugin_not_found");
  return plugin;
}

export async function versionOf(ctx: ServerContext, ref: PluginVersionRef): Promise<PluginVersion> {
  const version = await ctx.adapters.data.getVersion(ref);
  if (!version) fail(ctx, 404, `Plugin ${ref.plugin} has no version ${ref.number}`, "version_not_found");
  return version;
}

export async function latestVersion(ctx: ServerContext, plugin: PluginId): Promise<PluginVersion | null> {
  const versions = await ctx.adapters.data.listVersions(plugin);
  return versions.reduce<PluginVersion | null>((best, v) => (!best || v.number > best.number ? v : best), null);
}

/** D10: the plugin, then its parent, and so on, stopping at a fork that started empty. Nearest first. */
export async function chainOf(ctx: ServerContext, plugin: PluginId | Plugin): Promise<PluginId[]> {
  const chain: PluginId[] = [];
  let current: Plugin | null = typeof plugin === "string" ? await ctx.adapters.data.getPlugin(plugin) : plugin;
  while (current && !chain.includes(current.id)) {
    chain.push(current.id);
    if (!current.forkedFrom || !current.readsParentData) break;
    current = await ctx.adapters.data.getPlugin(current.forkedFrom.plugin);
  }
  return chain;
}
