import { buildServerBundle, closeAdapters, loadServerBundle } from "./bundle.js";
import type { Deps } from "./deps.js";
import type { Io } from "./io.js";
import type { ProjectPaths } from "./project.js";

async function withConfig<T>(paths: ProjectPaths, deps: Deps, use: (config: import("thixo/contract").ThixoConfig, slotPathsOf: (slot: string) => string[]) => Promise<T>): Promise<T> {
  await buildServerBundle(paths);
  const server = await deps.server();
  const loaded = await loadServerBundle(paths, server);
  // A plugin names the slot it fills; a layout names where that slot is (main/todo-row). Show the path.
  const all = server.slotPaths ? server.slotPaths(loaded.app.slots) : [];
  const slotPathsOf = (slot: string) => {
    const at = all.filter((p) => p === slot || p.endsWith(`/${slot}`));
    return at.length ? at : [slot];
  };
  try {
    return await use(loaded.config, slotPathsOf);
  } finally {
    closeAdapters(loaded.config);
  }
}

function table(rows: string[][]): string[] {
  if (!rows.length) return [];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
}

/** `thixo registry list`: every plugin in the local registry with its versions, visibility and author. */
export async function runRegistryList(paths: ProjectPaths, options: { json: boolean }, io: Io, deps: Deps): Promise<number> {
  const rows = await withConfig(paths, deps, async (config, slotPathsOf) => {
    const plugins = await config.adapters.data.listPlugins();
    return Promise.all(
      plugins.map(async (plugin) => {
        const versions = await config.adapters.data.listVersions(plugin.id);
        const slot = versions.at(-1)?.manifest.slot;
        return { plugin, versions, paths: slot ? slotPathsOf(slot) : [] };
      }),
    );
  });
  if (options.json) {
    io.out(JSON.stringify(rows.map(({ plugin, versions, paths }) => ({ ...plugin, slotPaths: paths, versions: versions.map((v) => ({ number: v.number, createdBy: v.createdBy, createdAt: v.createdAt, slot: v.manifest.slot })) })), null, 2));
    return 0;
  }
  if (!rows.length) {
    io.out("The registry is empty. `thixo dev` deploys the plugins in plugins/ when it starts.");
    return 0;
  }
  const header = ["ID", "NAME", "VISIBILITY", "AUTHOR", "VERSIONS", "SLOT"];
  const body = rows.map(({ plugin, versions, paths }) => [
    plugin.id,
    plugin.name,
    plugin.visibility,
    plugin.author,
    versions.length ? versions.map((v) => `${v.number}`).join(",") : "-",
    paths.join(", ") || "-",
  ]);
  for (const line of table([header, ...body])) io.out(line);
  return 0;
}

/** `thixo release`: the current release and its layout. */
export async function runRelease(paths: ProjectPaths, options: { json: boolean }, io: Io, deps: Deps): Promise<number> {
  const result = await withConfig(paths, deps, async (config) => {
    const release = await config.adapters.data.latestRelease();
    const names: Record<string, string> = {};
    if (release) for (const ref of Object.values(release.layout)) names[ref.plugin] ??= (await config.adapters.data.getPlugin(ref.plugin))?.name ?? ref.plugin;
    return { release, names };
  });
  if (options.json) {
    io.out(JSON.stringify(result.release, null, 2));
    return 0;
  }
  const { release, names } = result;
  if (!release) {
    io.out("No release yet. `thixo dev` and `thixo start` deploy one when they start.");
    return 0;
  }
  io.out(`Release     ${release.id}`);
  io.out(`Deployment  ${release.deployment}`);
  io.out(`Created     ${release.createdAt}`);
  io.out(`Plugins     ${release.plugins.length}`);
  io.out("Layout");
  const entries = Object.entries(release.layout);
  if (!entries.length) io.out("  (empty)");
  for (const line of table(entries.map(([slot, ref]) => [`  ${slot}`, `${ref.plugin}@${ref.number}`, names[ref.plugin] ?? ""]))) io.out(line);
  return 0;
}
