import { slotPaths } from "../../slots/paths.js";
import type { SourceFiles, ThxError } from "thixo-thx/contract";
import type { Plugin, PluginLoad, PluginSummary, PluginVersion, PluginVersionRef, SchemaDiff, SubmitReply, User } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { canSee, chainOf, latestVersion, versionOf, visiblePlugin } from "./access.js";
import { ASSET_FILE, assetType, buildWithCopies, readAsset, storeAssets } from "./assets.js";
import { assetQuotaError } from "./asset-quota.js";
import { readCompiled, readSource, storeCompiled, storeSource } from "./code-store.js";
import { fail, missingScopes } from "./errors.js";
import { newId } from "./hash.js";
import { createLayoutServices } from "./layouts.js";
import { withPluginId, withoutPluginId } from "./plugin-source.js";
import { createDataServices } from "./plugin-data.js";
import { diffSchemas, lineageTypeChanges } from "./schema-diff.js";
import { endpointsCallableBy, optionalScopes, requiredScopes } from "./scopes.js";
import { summarise } from "./summary.js";
import type { PluginDetail, PromotionReply, RegistryServices, SubmitResult } from "./types.js";

function slugOf(name: string, fallback: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** A name as a reader compares names: case, width, spacing and punctuation folded away, so "Due dates",
 * "due-dates" and full-width "Due dates" are one name. */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function createRegistryServices(ctx: ServerContext): RegistryServices {
  const data = ctx.adapters.data;

  /** Each default plugin of the newest release, with the version its layout serves (the highest, if two slots
   * differ). A deployed folder the layout does not name is a default with no version served. */
  async function defaultIds(): Promise<Map<string, number | undefined>> {
    const release = await data.latestRelease();
    const out = new Map<string, number | undefined>((release?.plugins ?? []).map((id) => [id, undefined]));
    for (const ref of Object.values(release?.layout ?? {})) {
      if (!out.has(ref.plugin)) continue;
      const seen = out.get(ref.plugin);
      out.set(ref.plugin, seen === undefined ? ref.number : Math.max(seen, ref.number));
    }
    return out;
  }

  function summaryOf(plugin: Plugin, version: PluginVersion, defaults: Map<string, number | undefined>): PluginSummary {
    const defaultVersion = defaults.get(plugin.id);
    return {
      ...(defaultVersion !== undefined ? { defaultVersion } : {}),
      plugin,
      latest: version.number,
      manifest: version.manifest,
      summary: summarise(ctx, version.manifest),
      requiredScopes: requiredScopes(ctx, version.manifest),
      optionalScopes: optionalScopes(ctx, version.manifest),
      isDefault: defaults.has(plugin.id),
    };
  }

  /** What every version of the plugin and of each plugin it reads through to has declared (D8). */
  async function lineageSchemas(plugin: Plugin) {
    const schemas = [];
    for (const id of await chainOf(ctx, plugin)) for (const v of await data.listVersions(id)) schemas.push(v.manifest.data);
    return schemas;
  }

  async function detailOf(user: User, pluginId: string): Promise<PluginDetail> {
    const plugin = await visiblePlugin(ctx, user, pluginId);
    const versions = await data.listVersions(plugin.id);
    const latest = await latestVersion(ctx, plugin.id);
    if (!latest) fail(ctx, 404, `Plugin ${plugin.id} has no versions`, "version_not_found");
    return {
      ...summaryOf(plugin, latest, await defaultIds()),
      versions: versions
        .sort((a, b) => a.number - b.number)
        .map((v) => ({ number: v.number, sourceHash: v.sourceHash, createdBy: v.createdBy, createdAt: v.createdAt, schemaHash: v.manifest.schemaHash })),
    };
  }

  /** Another plugin that others see under the same name: a default, or a shared one. A plugin others see must
   * not take a name its users already trust, since the name and description are most of what G5 shows. */
  async function nameHolder(plugin: Plugin, name: string): Promise<{ plugin: Plugin; isDefault: boolean } | null> {
    const key = nameKey(name);
    if (!key) return null;
    const defaults = await defaultIds();
    for (const other of await data.listPlugins()) {
      if (other.id === plugin.id) continue;
      const isDefault = defaults.has(other.id);
      if ((isDefault || other.visibility === "shared") && nameKey(other.name) === key) return { plugin: other, isDefault };
    }
    return null;
  }

  function nameTakenMessage(name: string, holder: { plugin: Plugin; isDefault: boolean }): string {
    const whose = holder.isDefault ? "a default plugin of this app" : `a plugin ${holder.plugin.author} shared`;
    return `"${holder.plugin.name}" is already the name of ${whose}. A plugin other people see needs a name of its own, so nobody takes "${name}" for it. Change the name in definePlugin and submit again.`;
  }

  async function checkLoadable(user: User, ref: PluginVersionRef): Promise<{ plugin: Plugin; version: PluginVersion }> {
    const plugin = await visiblePlugin(ctx, user, ref.plugin);
    const version = await versionOf(ctx, ref);
    if (plugin.visibility === "shared") missingScopes(ctx, user, requiredScopes(ctx, version.manifest), `Plugin ${plugin.name}`);
    return { plugin, version };
  }

  return {
    chainOf: (plugin) => chainOf(ctx, plugin),

    async submit({ user, files, plugin: pluginId }): Promise<SubmitResult> {
      let existing: Plugin | null = null;
      if (pluginId) {
        existing = await ctx.adapters.data.getPlugin(pluginId);
        if (!existing || !canSee(user, existing)) fail(ctx, 404, `There is no plugin ${pluginId}`, "plugin_not_found");
        if (existing.author !== user.id) fail(ctx, 403, "Only the author can add a version to a plugin. Fork it to change it.", "not_author");
      }
      const source = withoutPluginId(files);
      const built = await buildWithCopies(ctx.adapters.build, ctx.compileEnv, source);
      if (!built.ok) return { ok: false, errors: built.errors };
      const verdict = await ctx.adapters.build.verify?.(built.code);
      if (verdict && !verdict.ok) {
        return { ok: false, errors: verdict.errors.map((message): ThxError => ({ file: "", line: 0, column: 0, code: "thx/verify-output", message })) };
      }

      const history = existing ? await lineageSchemas(existing) : [];
      const typeChanged = lineageTypeChanges(built.manifest.data, history);
      if (typeChanged.length) {
        return {
          ok: false,
          typeChanged,
          errors: typeChanged.map((c): ThxError => ({
            file: "data.thx",
            line: 0,
            column: 0,
            code: "registry/field-type-changed",
            message: `${c.scope} field "${c.field}" was ${c.from} and this version declares it as ${c.to}. A field's type never changes.`,
            hint: `Give the ${c.to} value a new field name and keep "${c.field}" as ${c.from}.`,
          })),
        };
      }

      if (existing?.visibility === "shared") {
        const holder = await nameHolder(existing, built.meta.name);
        if (holder) return { ok: false, errors: [{ file: "plugin.thx", line: 0, column: 0, code: "registry/name-taken", message: nameTakenMessage(built.meta.name, holder) }] };
      }

      // A new version stores its copies: check the caps first, so a refused submit stores nothing.
      const stored = existing ? await data.findVersionByHash(existing.id, built.sourceHash) : null;
      if (!stored) {
        const over = await assetQuotaError(ctx, user, built.assets);
        if (over) return { ok: false, errors: [over] };
      }

      let plugin: Plugin;
      if (existing) {
        plugin = { ...existing, name: built.meta.name, description: built.meta.description };
        await data.putPlugin(plugin);
      } else {
        plugin = { id: newId("plg"), name: built.meta.name, description: built.meta.description, author: user.id, visibility: "personal", readsParentData: true };
        await data.putPlugin(plugin);
      }

      const versions = await data.listVersions(plugin.id);
      const previous = versions.reduce<PluginVersion | null>((best, v) => (!best || v.number > best.number ? v : best), null);
      let version = await data.findVersionByHash(plugin.id, built.sourceHash);
      let diff: SchemaDiff = { added: [], noLongerShown: [], typeChanged: [] };
      if (!version) {
        await storeAssets(ctx.adapters.code, built.assets);
        version = await data.addVersion({
          plugin: plugin.id,
          source: await storeSource(ctx, source),
          sourceHash: built.sourceHash,
          compiled: await storeCompiled(ctx, built.code),
          manifest: built.manifest,
          createdBy: user.id,
          createdAt: new Date().toISOString(),
        });
        diff = diffSchemas(previous?.manifest.data ?? null, version.manifest.data);
      }
      return { ok: true, plugin, version: version.number, manifest: version.manifest, summary: summarise(ctx, version.manifest), diff };
    },

    async search({ user, q, slot }) {
      const tokens = words(q ?? "");
      const defaults = await defaultIds();
      const found: { summary: PluginSummary; score: number }[] = [];
      for (const plugin of await data.listPlugins()) {
        if (!canSee(user, plugin)) continue;
        const latest = await latestVersion(ctx, plugin.id);
        if (!latest) continue;
        if (slot && latest.manifest.slot !== slot && !slot.endsWith(`/${latest.manifest.slot}`)) continue;
        if (!ctx.holds(user, requiredScopes(ctx, latest.manifest))) continue;
        const haystack = new Set(words(`${plugin.name} ${plugin.description}`));
        const score = tokens.filter((t) => haystack.has(t) || [...haystack].some((w) => w.startsWith(t))).length;
        if (tokens.length && score === 0) continue;
        found.push({ summary: summaryOf(plugin, latest, defaults), score });
      }
      return found.sort((a, b) => b.score - a.score || a.summary.plugin.name.localeCompare(b.summary.plugin.name)).map((f) => f.summary);
    },

    getPlugin: ({ user, plugin }) => detailOf(user, plugin),

    async listVersions({ user, plugin }) {
      await visiblePlugin(ctx, user, plugin);
      return (await data.listVersions(plugin)).sort((a, b) => a.number - b.number);
    },

    async getSource({ user, ref }): Promise<SourceFiles> {
      await visiblePlugin(ctx, user, ref.plugin);
      return readSource(ctx, (await versionOf(ctx, ref)).source);
    },

    async fork({ user, ref, empty }): Promise<SubmitReply> {
      const parent = await visiblePlugin(ctx, user, ref.plugin);
      const version = await versionOf(ctx, ref);
      missingScopes(ctx, user, requiredScopes(ctx, version.manifest), `Forking ${parent.name}`);
      const plugin: Plugin = {
        id: newId("plg"),
        name: parent.name,
        description: parent.description,
        author: user.id,
        visibility: "personal",
        forkedFrom: { plugin: ref.plugin, number: ref.number },
        readsParentData: !empty,
      };
      await data.putPlugin(plugin);
      const first = await data.addVersion({
        plugin: plugin.id,
        source: version.source,
        sourceHash: version.sourceHash,
        compiled: version.compiled,
        manifest: version.manifest,
        createdBy: user.id,
        createdAt: new Date().toISOString(),
      });
      return { plugin, version: first.number, manifest: first.manifest, summary: summarise(ctx, first.manifest), diff: { added: [], noLongerShown: [], typeChanged: [] } };
    },

    async share({ user, plugin: id }) {
      const plugin = await visiblePlugin(ctx, user, id);
      if (plugin.author !== user.id) fail(ctx, 403, "Only the author can share a plugin.", "not_author");
      missingScopes(ctx, user, ["thixo.plugins.share"], "Sharing a plugin");
      if (plugin.visibility === "shared") return plugin;
      const holder = await nameHolder(plugin, plugin.name);
      if (holder) fail(ctx, 409, nameTakenMessage(plugin.name, holder), "name_taken", { plugin: holder.plugin.id });
      const shared: Plugin = { ...plugin, visibility: "shared" };
      await data.putPlugin(shared);
      return shared;
    },

    async promote({ user, plugin: id, version: number }): Promise<PromotionReply> {
      const plugin = await visiblePlugin(ctx, user, id);
      const allowed = ctx.config.promotion ? await ctx.config.promotion.canPromote(user, plugin) : ctx.holds(user, ["thixo.plugins.promote"]);
      if (!allowed) fail(ctx, 403, "You may not promote plugins here.", "promotion_refused", ctx.config.promotion ? {} : { missingScopes: ["thixo.plugins.promote"] });
      if (plugin.visibility !== "shared") fail(ctx, 409, "Share the plugin before promoting it.", "not_shared");
      const target = number !== undefined ? await versionOf(ctx, { plugin: id, number }) : await latestVersion(ctx, id);
      if (!target) fail(ctx, 404, `Plugin ${id} has no versions`, "version_not_found");
      const files = withPluginId(await readSource(ctx, target.source), plugin.id);
      const folder = slugOf(plugin.name, plugin.id);
      const change = await ctx.adapters.code.openChange({
        title: `Promote ${plugin.name} (version ${target.number}) to a default plugin`,
        files: Object.fromEntries(Object.entries(files).map(([path, text]) => [`plugins/${folder}/${path}`, text])),
      });
      // Say what happened and what is left, in words a person reads: the folder is written (locally) or a change is
      // open (elsewhere), and it fills no slot until the layout names it. Where the layout already names the folder,
      // the next deploy serves this version.
      const paths = slotPaths(ctx.app.slots).filter((p) => p === target.manifest.slot || p.endsWith(`/${target.manifest.slot}`));
      const named = Object.entries(ctx.config.layout ?? {}).filter(([, f]) => f === folder).map(([slot]) => slot);
      const example = paths[0] ?? target.manifest.slot;
      const next = named.length
        ? `The layout already names "${folder}" in ${named.join(", ")}, so the next deploy serves this version there.`
        : `It fills no slot yet. To make it a default, name it in layout in thixo.config.ts, such as ${JSON.stringify(example)}: ${JSON.stringify(folder)}, and deploy (thixo dev redeploys when the config changes).`;
      return {
        where: change.where,
        folder,
        version: target.number,
        files: Object.keys(files).map((path) => `plugins/${folder}/${path}`),
        slotPaths: paths,
        inLayout: named,
        done: `Promoted ${plugin.name} (version ${target.number}): its files are at plugins/${folder}/ (${change.where}).`,
        next,
      };
    },

    async load({ user, ref }): Promise<PluginLoad> {
      const { plugin, version } = await checkLoadable(user, ref);
      const author = { id: plugin.author, scopes: await ctx.scopesOf(plugin.author) };
      return {
        plugin,
        version: version.number,
        manifest: version.manifest,
        code: `/_thixo/plugins/${plugin.id}/${version.number}.js`,
        assets: { path: `/_thixo/plugins/${plugin.id}/${version.number}/assets/`, query: "" },
        authorCan: endpointsCallableBy(ctx, version.manifest, author),
        userCan: endpointsCallableBy(ctx, version.manifest, user),
        authorData: { read: ctx.holds(author, ["thixo.data.read"]), write: ctx.holds(author, ["thixo.data.write"]) },
      };
    },

    async code({ user, ref }) {
      const { version } = await checkLoadable(user, ref);
      return readCompiled(ctx, version.compiled);
    },

    async asset({ user, ref, file }) {
      const { version } = await checkLoadable(user, ref);
      // Only a file this version copied: a plugin's address can't be used to read another plugin's files.
      if (!ASSET_FILE.test(file) || !Object.values(version.manifest.assets ?? {}).includes(file)) fail(ctx, 404, `Version ${ref.number} of ${ref.plugin} has no copied file ${file}`, "asset_not_found");
      const bytes = await readAsset(ctx.adapters.code, file);
      if (!bytes) fail(ctx, 404, `The copied file ${file} is not stored`, "asset_not_found");
      return { bytes, contentType: assetType(file)! };
    },

    layout: createLayoutServices(ctx),
    data: createDataServices(ctx),
  };
}
