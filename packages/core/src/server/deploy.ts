import { IMPLEMENTOR, type Plugin, type PluginVersion, type PluginVersionRef, type Release, type SlotPath } from "../contract.js";
import type { SourceFiles, ThxError } from "thixo-thx/contract";
import type { ServerContext } from "./context.js";
import { storeCompiled, storeSource } from "./registry/code-store.js";
import { newId } from "./registry/hash.js";
import { withoutPluginId } from "./registry/plugin-source.js";
import { resolveSlotPath, slotPaths } from "../slots/paths.js";

/** What a deploy takes: each default plugin's folder name and files, the layout from the config, and the
 * implementor's name for this deploy, such as a commit sha. */
export interface DeployInput {
  plugins: Record<string, SourceFiles>;
  layout: Record<SlotPath, string>;
  deployment: string;
}

export type DeployResult = Release;

/** A deploy that did not happen. Nothing was stored. */
export class DeployError extends Error {
  readonly problems: { folder: string; errors: ThxError[] }[];

  constructor(problems: { folder: string; errors: ThxError[] }[]) {
    super(
      `Deploy refused:\n${problems.map((p) => p.errors.map((e) => `  plugins/${p.folder}${e.file ? `/${e.file}` : ""}${e.line ? `:${e.line}` : ""}: ${e.message}${e.hint ? ` ${e.hint}` : ""}`).join("\n")).join("\n")}`,
    );
    this.name = "DeployError";
    this.problems = problems;
  }
}

const problem = (message: string, code: string, hint?: string): ThxError => ({ file: "", line: 0, column: 0, code, message, ...(hint ? { hint } : {}) });

/** G3, docs/06 "Default plugins and deploys". Builds each folder, finds a version by `sourceHash` or stores one, and
 * writes a release. The same input twice stores nothing new, and an older commit finds its old versions by hash.
 *
 * A version is stored and hashed without the id in its `definePlugin` metadata. Promotion adds the id to a copy of
 * the source, and a deploy takes it out again before it hashes, so the promoted folder lands on the version it was
 * promoted from. */
export async function deploy(ctx: ServerContext, input: DeployInput): Promise<DeployResult> {
  const data = ctx.adapters.data;
  const problems: { folder: string; errors: ThxError[] }[] = [];

  interface Built {
    folder: string;
    id: string;
    source: SourceFiles;
    code: string;
    sourceHash: string;
    manifest: PluginVersion["manifest"];
    name: string;
    description: string;
  }
  const built: Built[] = [];
  const idToFolder = new Map<string, string>();

  for (const folder of Object.keys(input.plugins).sort()) {
    const files = input.plugins[folder];
    const first = await ctx.adapters.build.build(files, ctx.compileEnv);
    if (!first.ok) {
      problems.push({ folder, errors: first.errors });
      continue;
    }
    const id = first.meta.id;
    if (!id) {
      problems.push({
        folder,
        errors: [problem(`plugins/${folder} has no id in its definePlugin metadata.`, "deploy/no-plugin-id", 'Run `thixo new plugin` to make a folder with one, or add `id: "<plugin id>"` to the metadata literal.')],
      });
      continue;
    }
    if (idToFolder.has(id)) {
      problems.push({ folder, errors: [problem(`plugins/${folder} and plugins/${idToFolder.get(id)} both name the plugin "${id}".`, "deploy/duplicate-id")] });
      continue;
    }
    idToFolder.set(id, folder);

    const source = withoutPluginId(files);
    const result = await ctx.adapters.build.build(source, ctx.compileEnv);
    if (!result.ok) {
      problems.push({ folder, errors: result.errors });
      continue;
    }
    const verdict = await ctx.adapters.build.verify?.(result.code);
    if (verdict && !verdict.ok) {
      problems.push({ folder, errors: verdict.errors.map((m) => problem(m, "thx/verify-output")) });
      continue;
    }
    built.push({ folder, id, source, code: result.code, sourceHash: result.sourceHash, manifest: result.manifest, name: result.meta.name, description: result.meta.description });
  }

  const byFolder = new Map(built.map((b) => [b.folder, b]));
  const paths = slotPaths(ctx.app.slots);
  for (const [slot, folder] of Object.entries(input.layout)) {
    const b = byFolder.get(folder);
    if (!paths.includes(slot)) {
      const where = resolveSlotPath(ctx.app.slots, slot);
      const hint = where.ok ? `Write "${where.path}": a child slot's path has its parent in front.` : `The slot paths are: ${paths.join(", ") || "(none)"}.`;
      problems.push({ folder, errors: [problem(`The layout names the slot "${slot}", which no part of the app shows.`, "deploy/unknown-slot", hint)] });
      continue;
    }
    const name = slot.split("/").filter(Boolean).pop();
    if (!Object.hasOwn(input.plugins, folder)) problems.push({ folder, errors: [problem(`The layout puts "${folder}" in "${slot}", but there is no plugins/${folder}.`, "deploy/unknown-folder")] });
    else if (b && b.manifest.slot !== name) {
      problems.push({ folder, errors: [problem(`plugins/${folder} fills the slot "${b.manifest.slot}", but the layout puts it in "${slot}".`, "deploy/wrong-slot")] });
    }
  }
  if (problems.length) throw new DeployError(problems);

  const versions = new Map<string, PluginVersion>();
  for (const b of built) {
    const existing = await data.getPlugin(b.id);
    const plugin: Plugin = {
      ...(existing ?? { readsParentData: true }),
      id: b.id,
      name: b.name,
      description: b.description,
      author: IMPLEMENTOR,
      visibility: "shared",
    };
    if (!existing || existing.name !== plugin.name || existing.description !== plugin.description || existing.author !== IMPLEMENTOR || existing.visibility !== "shared") {
      await data.putPlugin(plugin);
    }
    let version = await data.findVersionByHash(b.id, b.sourceHash);
    if (!version) {
      version = await data.addVersion({
        plugin: b.id,
        source: await storeSource(ctx, b.source),
        sourceHash: b.sourceHash,
        compiled: await storeCompiled(ctx, b.code),
        manifest: b.manifest,
        createdBy: IMPLEMENTOR,
        createdAt: new Date().toISOString(),
      });
    }
    versions.set(b.folder, version);
  }

  const layout: Record<SlotPath, PluginVersionRef> = {};
  for (const [slot, folder] of Object.entries(input.layout)) {
    const v = versions.get(folder)!;
    layout[slot] = { plugin: v.plugin, number: v.number };
  }
  const plugins = built.map((b) => b.id);

  const latest = await data.latestRelease();
  if (latest && latest.deployment === input.deployment && sameJson(latest.plugins, plugins) && sameJson(sorted(latest.layout), sorted(layout))) return latest;

  const release: Release = { id: newId("rel"), deployment: input.deployment, plugins, layout, createdAt: new Date().toISOString() };
  await data.putRelease(release);
  return release;
}

function sorted<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
