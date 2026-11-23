import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { CompileResult } from "thixo-thx/contract";
import { buildClientBundle, buildServerBundle, closeAdapters, loadServerBundle, readTitle } from "./bundle.js";
import type { Deps } from "./deps.js";
import { CliError } from "./errors.js";
import type { Io } from "./io.js";
import { compilePlugins, readPlugins, reportOutcome, type PluginOutcome } from "./plugins.js";
import type { ProjectPaths } from "./project.js";

export interface BuildManifest {
  version: 1;
  ok: boolean;
  builtAt: string;
  mode: "production" | "development";
  /** sha256, hex, of the server bundle, the client bundle and each plugin's source hash. */
  hash: string;
  server: { file: string };
  client: { dir: string; index: string; script: string; css: string | null; files: string[] };
  endpoints: string[];
  slots: string[];
  plugins: Record<string, { ok: boolean; id?: string; name?: string; slot?: string; sourceHash?: string; errors?: number }>;
}

export interface BuildOptions {
  production: boolean;
}

export function hashOf(parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

export function manifestPlugins(outcomes: PluginOutcome[]): BuildManifest["plugins"] {
  const plugins: BuildManifest["plugins"] = {};
  for (const { name, result } of outcomes) {
    plugins[name] = result.ok
      ? { ok: true, id: result.meta.id, name: result.meta.name, slot: result.manifest.slot, sourceHash: result.sourceHash }
      : { ok: false, errors: result.errors.length };
  }
  return plugins;
}

export function failedPlugins(outcomes: PluginOutcome[]): PluginOutcome[] {
  return outcomes.filter((o): o is PluginOutcome & { result: Extract<CompileResult, { ok: false }> } => !o.result.ok);
}

/** `thixo build`: the server bundle, the browser bundle, a compile of every plugin, and `manifest.json`. */
export async function buildProject(paths: ProjectPaths, options: BuildOptions, io: Io, deps: Deps): Promise<BuildManifest> {
  const log = (line: string) => io.out(line);
  log(`Building ${paths.root}`);

  await buildServerBundle(paths);
  log("  server    .thixo/build/server.mjs");

  const server = await deps.server();
  const loaded = await loadServerBundle(paths, server);
  closeAdapters(loaded.config);

  const client = await buildClientBundle(paths, { libraries: loaded.config.libraries, production: options.production, title: readTitle(paths) });
  log(`  client    .thixo/build/client/ (${client.files.length} files${options.production ? ", minified" : ""})`);

  const thx = await deps.thx();
  const outcomes = compilePlugins(readPlugins(paths.pluginsDir), loaded.compileEnv, thx, paths.pluginsDir);
  log(outcomes.length ? "  plugins" : "  plugins   none in plugins/");
  const describe = server.describeManifest ? (m: Parameters<NonNullable<typeof server.describeManifest>>[1]) => server.describeManifest!(loaded.app, m).summary : undefined;
  for (const outcome of outcomes) for (const line of reportOutcome(outcome, io.cwd, describe)) log(line);

  const failed = failedPlugins(outcomes);
  const manifest: BuildManifest = {
    version: 1,
    ok: failed.length === 0,
    builtAt: new Date().toISOString(),
    mode: options.production ? "production" : "development",
    hash: hashOf([
      readFileSync(paths.serverBundle, "utf8"),
      readFileSync(`${paths.clientDir}/app.js`, "utf8"),
      ...outcomes.map((o) => (o.result.ok ? o.result.sourceHash : `failed:${o.name}`)),
    ]),
    server: { file: "server.mjs" },
    client: { dir: "client", index: "index.html", script: client.script, css: client.css, files: client.files },
    endpoints: loaded.app.endpoints.map((e) => e.name),
    slots: loaded.app.slots.map((s) => s.exportName),
    plugins: manifestPlugins(outcomes),
  };
  mkdirSync(paths.buildDir, { recursive: true });
  writeFileSync(paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  if (failed.length) {
    throw new CliError(`${failed.length} plugin${failed.length === 1 ? "" : "s"} failed to compile (${failed.map((f) => f.name).join(", ")}). The build is written to .thixo/build/ but \`thixo start\` will not use it.`);
  }
  log("Built.");
  return manifest;
}

export function readBuildManifest(paths: ProjectPaths): BuildManifest {
  try {
    return JSON.parse(readFileSync(paths.manifestFile, "utf8")) as BuildManifest;
  } catch {
    throw new CliError("There is no build yet. Run `thixo build` first, or use `thixo dev`.");
  }
}
