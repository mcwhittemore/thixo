// How much copy at build may store for people who make plugins. Content addressing stores identical bytes once, but
// distinct bytes grow with every submit, so each person, and everyone together, has a cap. A deploy is the
// implementor's and does not count. A fork's first version copies its parent's files by reference and stores
// nothing, so it does not count either.

import type { ThxError } from "thixo-thx/contract";
import { IMPLEMENTOR, type CodeAdapter, type User } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { assetKey } from "./assets.js";

export const DEFAULT_ASSET_QUOTA = {
  authorBytes: 64 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
};

/** A stored file's size never changes (its name is its hash), so it is read once per process. */
const sizes = new WeakMap<CodeAdapter, Map<string, number>>();

async function sizeOf(code: CodeAdapter, file: string, known: Record<string, Uint8Array>): Promise<number> {
  if (known[file]) return known[file].byteLength;
  let cache = sizes.get(code);
  if (!cache) sizes.set(code, (cache = new Map()));
  let size = cache.get(file);
  if (size === undefined) {
    size = (await code.get(assetKey(file)))?.byteLength ?? 0;
    cache.set(file, size);
  }
  return size;
}

const mib = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MiB`;

/** A build error when storing `assets` for `user` would go over a cap, or null. */
export async function assetQuotaError(ctx: ServerContext, user: User, assets: Record<string, Uint8Array>): Promise<ThxError | null> {
  if (user.id === IMPLEMENTOR || !Object.keys(assets).length) return null;
  const authorBytes = ctx.config.assetQuota?.authorBytes ?? DEFAULT_ASSET_QUOTA.authorBytes;
  const totalBytes = ctx.config.assetQuota?.totalBytes ?? DEFAULT_ASSET_QUOTA.totalBytes;
  const data = ctx.adapters.data;
  const code = ctx.adapters.code;

  const mine = new Set<string>();
  const everyone = new Set<string>();
  for (const plugin of await data.listPlugins()) {
    for (const version of await data.listVersions(plugin.id)) {
      if (version.createdBy === IMPLEMENTOR) continue;
      if (plugin.forkedFrom && version.number === 1) continue;
      for (const file of Object.values(version.manifest.assets ?? {})) {
        everyone.add(file);
        if (version.createdBy === user.id) mine.add(file);
      }
    }
  }

  const sum = async (files: Iterable<string>) => {
    let n = 0;
    for (const file of files) n += await sizeOf(code, file, assets);
    return n;
  };
  const fresh = (held: Set<string>) => Object.keys(assets).filter((file) => !held.has(file));

  const error = (message: string): ThxError => ({
    file: "plugin.thx",
    line: 0,
    column: 0,
    code: "build/asset-quota",
    message,
    hint: "Use fewer or smaller images or fonts, a `data:` address, or an image the app hands the plugin as a `Url`. A plugin you no longer need still counts.",
  });

  const used = await sum(mine);
  const adding = await sum(fresh(mine));
  if (adding && used + adding > authorBytes) {
    return error(`Storing this plugin's copied files would bring yours to ${mib(used + adding)}, over the ${mib(authorBytes)} one person may store in this app.`);
  }
  const all = await sum(everyone);
  const growing = await sum(fresh(everyone));
  if (growing && all + growing > totalBytes) {
    return error(`Storing this plugin's copied files would bring this app's to ${mib(all + growing)}, over the ${mib(totalBytes)} its people may store together.`);
  }
  return null;
}
