import { mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { SourceFiles } from "thixo-thx/contract";
import { buildServerBundle, closeAdapters, loadServerBundle } from "./bundle.js";
import type { Deps } from "./deps.js";
import { CliError, formatThxErrors } from "./errors.js";
import type { Io } from "./io.js";
import { compileFolder, readPluginFolder, summarizeManifest } from "./plugins.js";
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

  const thx = await deps.thx();
  const result = compileFolder(files, loaded.compileEnv, thx, label);

  if (!result.ok) {
    if (options.json) io.out(JSON.stringify({ ok: false, errors: result.errors }, null, 2));
    else for (const line of formatThxErrors(result.errors)) io.err(line);
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
    else for (const line of formatThxErrors(errors)) io.err(line);
    return 1;
  }

  if (options.out) {
    const out = resolve(io.cwd, options.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "plugin.js"), result.code);
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
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
    io.out(`  needs: ${told.requiredScopes.join(", ") || "nothing"}`);
    if (told.optionalScopes.length) io.out(`  uses if the user holds them: ${told.optionalScopes.join(", ")}`);
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
