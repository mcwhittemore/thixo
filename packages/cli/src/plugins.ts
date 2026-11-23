import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CompileEnv, CompileResult, Manifest, SourceFiles, ThxError } from "thixo-thx/contract";
import type { ThxApi } from "./deps.js";
import { formatThxErrors, messageOf } from "./errors.js";
import { listFiles } from "./project.js";

/** Every `.thx` file under `dir`, keyed by its path relative to `dir` with `/` separators. */
export function readPluginFolder(dir: string): SourceFiles {
  const files: SourceFiles = {};
  for (const file of listFiles(dir, (name) => name.endsWith(".thx"))) {
    files[relative(dir, file).split(sep).join("/")] = readFileSync(file, "utf8");
  }
  return files;
}

/** Each folder of `pluginsDir` as the plugin it holds, by folder name. A missing folder holds none. */
export function readPlugins(pluginsDir: string): Record<string, SourceFiles> {
  let entries;
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return {};
  }
  const plugins: Record<string, SourceFiles> = {};
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    plugins[entry.name] = readPluginFolder(join(pluginsDir, entry.name));
  }
  return plugins;
}

export interface PluginOutcome {
  name: string;
  /** The folder the plugin's files are in, absolute. */
  dir: string;
  result: CompileResult;
  /** The files the build copied, by stored name, when it went through the build step. */
  assets?: Record<string, Uint8Array>;
}

/** The server's build step for this app: compile, copy what the source loads from outside, compile again. */
export type Builder = (files: SourceFiles, env: CompileEnv) => Promise<CompileResult & { assets?: Record<string, Uint8Array> }>;

function failure(file: string, code: string, message: string, hint?: string): CompileResult {
  const error: ThxError = { file, line: 1, column: 1, code, message, ...(hint ? { hint } : {}) };
  return { ok: false, errors: [error] };
}

export function compileFolder(files: SourceFiles, env: CompileEnv, thx: Pick<ThxApi, "compile">, name = "plugin"): CompileResult {
  if (!("plugin.thx" in files)) {
    return failure("plugin.thx", "cli/missing-plugin-thx", `${name} has no plugin.thx.`, "Every plugin folder needs a plugin.thx that exports definePlugin(...) as its default.");
  }
  try {
    return thx.compile(files, env);
  } catch (error) {
    return failure("plugin.thx", "cli/compiler-crashed", `The compiler stopped on ${name}: ${messageOf(error)}`);
  }
}

/** One folder through the build step, as a deploy and the authoring agent build it: an outside load is copied, and a
 * copy that fails is a build error. Without a builder (a fake server), a plain compile. `dir` is the folder the files
 * came from, so errors can name a path. */
export async function buildFolder(files: SourceFiles, env: CompileEnv, thx: Pick<ThxApi, "compile">, name: string, dir: string, builder?: Builder): Promise<PluginOutcome> {
  if (!builder || !("plugin.thx" in files)) return { name, dir, result: compileFolder(files, env, thx, name) };
  try {
    const built = await builder(files, env);
    if (!built.ok) return { name, dir, result: built };
    const { assets, ...result } = built;
    return { name, dir, result, assets: assets ?? {} };
  } catch (error) {
    return { name, dir, result: failure("plugin.thx", "cli/compiler-crashed", `The build stopped on ${name}: ${messageOf(error)}`) };
  }
}

export async function buildPlugins(plugins: Record<string, SourceFiles>, env: CompileEnv, thx: Pick<ThxApi, "compile">, pluginsDir: string, builder?: Builder): Promise<PluginOutcome[]> {
  const out: PluginOutcome[] = [];
  for (const [name, files] of Object.entries(plugins)) out.push(await buildFolder(files, env, thx, name, join(pluginsDir, name), builder));
  return out;
}

/** The manifest in plain sentences. */
export function summarizeManifest(manifest: Manifest): string[] {
  const lines = [`Fills the slot ${manifest.slot}.`];
  if (manifest.requiredEndpoints.length) lines.push(`Needs the endpoints ${manifest.requiredEndpoints.join(", ")}.`);
  if (manifest.optionalEndpoints.length) lines.push(`Can use ${manifest.optionalEndpoints.join(", ")} when the user is allowed.`);
  if (manifest.annotates.length) lines.push(`Adds its own fields to ${manifest.annotates.join(", ")}.`);
  for (const [store, fields] of Object.entries(manifest.data.stores)) {
    lines.push(`Keeps a private ${store} store${fields.length ? ` with ${fields.map((f) => `${f.name} (${f.type})`).join(", ")}` : ""}.`);
  }
  for (const [record, fields] of Object.entries(manifest.data.annotations)) {
    if (fields.length) lines.push(`Annotates ${record} with ${fields.map((f) => `${f.name} (${f.type})`).join(", ")}.`);
  }
  if (manifest.shellServices.length) lines.push(`Uses the shell services ${manifest.shellServices.join(", ")}.`);
  if (manifest.libraries.length) lines.push(`Imports ${manifest.libraries.join(", ")}.`);
  const loads = manifest.loads ?? [];
  const links = manifest.links ?? manifest.addresses.filter((a) => !loads.includes(a));
  if (loads.length) lines.push(`Copies into the app at build, and loads from there: ${loads.join(", ")}.`);
  if (links.length) lines.push(`Links to ${links.join(", ")}.`);
  return lines;
}

/** Lines to print for one plugin: its summary, or its errors with paths relative to where the command was run. */
export function reportOutcome(outcome: PluginOutcome, cwd: string, describe?: (manifest: Manifest) => string[] | undefined): string[] {
  const { name, result } = outcome;
  if (result.ok) {
    const label = result.meta.name ? `${name} (${result.meta.name})` : name;
    // The registry's own summary when the app is at hand, so build, compile and the plugin browser say the same.
    const lines = describe?.(result.manifest) ?? summarizeManifest(result.manifest);
    return [`  ok  ${label}`, ...lines.map((line) => `      ${line}`)];
  }
  return [`  FAILED  ${name}`, ...formatThxErrors(result.errors, { cwd, dir: outcome.dir }).flatMap((e) => e.split("\n").map((l) => `      ${l}`))];
}
