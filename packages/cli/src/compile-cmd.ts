import { mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { SourceFiles, ThxError } from "thixo-thx/contract";
import { buildServerBundle, builderFor, closeAdapters, loadServerBundle } from "./bundle.js";
import type { Deps } from "./deps.js";
import { CliError, formatThxErrors, locateThxErrors } from "./errors.js";
import type { Io } from "./io.js";
import { buildFolder, readPluginFolder, summarizeManifest } from "./plugins.js";
import { findProjectRoot, openProject } from "./project.js";

export interface CompileOptions {
  target: string;
  out?: string;
  json: boolean;
  project?: string;
}

export function readTarget(target: string): { files: SourceFiles; label: string } {
  let info;
  try {
    info = statSync(target);
  } catch {
    throw new CliError(`${target} does not exist.`);
  }
  if (info.isDirectory()) return { files: readPluginFolder(target), label: basename(target) };
  return { files: { "plugin.thx": readFileSync(target, "utf8") }, label: basename(target) };
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB (${bytes} bytes)`;
}

/** `thixo compile`: compiles a plugin folder or file against the project's real compile env. */
export async function runCompile(options: CompileOptions, io: Io, deps: Deps): Promise<number> {
  const target = resolve(io.cwd, options.target);
  const { files, label } = readTarget(target);

  const root = options.project ? openProject(resolve(io.cwd, options.project)).root : findProjectRoot(target);
  if (!root) {
    throw new CliError(
      `No project found above ${target}. A plugin compiles against the app it fills, because @app/sdk and @app/slots are generated from it.\nRun the command inside an app (a folder with thixo.config.ts) or pass --project <dir>.`,
    );
  }
  const paths = openProject(root);
  await buildServerBundle(paths);
  const loaded = await loadServerBundle(paths, await deps.server());
  closeAdapters(loaded.config);

  // The same build step a deploy and the authoring agent use: an outside image is copied into the app here too.
  const thx = await deps.thx();
  const isFolder = statSync(target).isDirectory();
  const base = { cwd: io.cwd, dir: isFolder ? target : dirname(target) };
  // A single file is compiled as the plugin's `plugin.thx`; its errors name the file it came from.
  const named = (errors: ThxError[]) => (isFolder ? errors : errors.map((e) => (e.file === "plugin.thx" ? { ...e, file: basename(target) } : e)));
  const outcome = await buildFolder(files, loaded.compileEnv, thx, label, base.dir, builderFor(loaded, await deps.server()));
  const result = outcome.result;
  const assets = outcome.assets ?? {};

  if (!result.ok) {
    if (options.json) io.out(JSON.stringify({ ok: false, errors: locateThxErrors(named(result.errors), base) }, null, 2));
    else for (const line of formatThxErrors(named(result.errors), base)) io.err(line);
    return 1;
  }

  const verified = thx.verifyOutput(result.code);
  const server = await deps.server();
  const told = server.describeManifest?.(loaded.app, result.manifest);
  const details = summarizeManifest(result.manifest);
  const summary = told?.summary ?? details;
  const size = Buffer.byteLength(result.code);
  if (!verified.ok) {
    const errors = verified.errors.map((message) => ({ file: "(output)", line: 0, column: 0, code: "thx/output-rejected", message }));
    if (options.json) io.out(JSON.stringify({ ok: false, errors }, null, 2));
    else for (const line of formatThxErrors(errors, base)) io.err(line);
    return 1;
  }

  if (options.out) {
    const out = resolve(io.cwd, options.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "plugin.js"), result.code);
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
    if (Object.keys(assets).length) {
      mkdirSync(join(out, "assets"), { recursive: true });
      for (const [file, bytes] of Object.entries(assets)) writeFileSync(join(out, "assets", file), bytes);
    }
  }

  if (options.json) {
    io.out(JSON.stringify({ ok: true, meta: result.meta, manifest: result.manifest, summary, ...(told ? { details, requiredScopes: told.requiredScopes, optionalScopes: told.optionalScopes } : {}), size, sourceHash: result.sourceHash, ...(options.out ? { out: resolve(io.cwd, options.out) } : {}) }, null, 2));
    return 0;
  }
  io.out(`Compiled ${label}${result.meta.name ? ` (${result.meta.name})` : ""}`);
  io.out("");
  io.out(told ? "Summary (what the plugin browser and `thixo agent check` say)" : "Summary");
  for (const line of summary) io.out(`  ${line}`);
  io.out("");
  if (told) {
    io.out("Scopes");
    const label = (scope: string) => told.scopeLabels?.[scope] ?? scope;
    io.out(`  needs: ${told.requiredScopes.map(label).join(", ") || "nothing"}`);
    if (told.optionalScopes.length) io.out(`  uses if the user holds them: ${told.optionalScopes.map(label).join(", ")}`);
    io.out("");
    io.out("Details");
    for (const line of details) io.out(`  ${line}`);
    io.out("");
  }
  io.out("Manifest");
  for (const line of JSON.stringify(result.manifest, null, 2).split("\n")) io.out(`  ${line}`);
  io.out("");
  io.out(`Output  ${formatBytes(size)}, source ${result.sourceHash.slice(0, 12)}`);
  if (options.out) io.out(`Wrote   ${join(resolve(io.cwd, options.out), "plugin.js")} and manifest.json`);
  return 0;
}
