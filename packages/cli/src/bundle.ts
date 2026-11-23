import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import type { AppDefinition, ThixoConfig } from "thixo/contract";
import type { CompileEnv } from "thixo-thx/contract";
import type { ServerApi } from "./deps.js";
import type { Builder } from "./plugins.js";
import { clientEntry, indexHtml, serverEntry } from "./entries.js";
import { CliError, formatEsbuildMessages, messageOf } from "./errors.js";
import { findApiFiles, findShellFile, findSlotsFile, type ProjectPaths } from "./project.js";

async function runEsbuild(paths: ProjectPaths, what: string, options: esbuild.BuildOptions): Promise<esbuild.BuildResult> {
  try {
    return await esbuild.build({ ...options, logLevel: "silent" });
  } catch (error) {
    const failure = error as { errors?: esbuild.Message[] };
    if (failure.errors?.length) {
      throw new CliError(`The ${what} did not build:\n${formatEsbuildMessages(failure.errors, paths.root).map((l) => `  ${l}`).join("\n")}`);
    }
    throw new CliError(`The ${what} did not build: ${messageOf(error)}`);
  }
}

/** api/**, app/slots and the config, bundled for Node into `.thixo/build/server.mjs`. Packages stay external, so
 * `thixo` and the adapters resolve from the project's node_modules, with the `node` condition (`thixo/shell` is then
 * the React-free slots module). */
export async function buildServerBundle(paths: ProjectPaths): Promise<{ file: string; entry: string }> {
  const entry = serverEntry({ configFile: paths.configFile, apiFiles: findApiFiles(paths), slotsFile: findSlotsFile(paths) });
  mkdirSync(paths.buildDir, { recursive: true });
  await runEsbuild(paths, "server bundle", {
    stdin: { contents: entry, resolveDir: paths.root, sourcefile: "thixo-server-entry.ts", loader: "ts" },
    outfile: paths.serverBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    conditions: ["node"],
    sourcemap: true,
    absWorkingDir: paths.root,
  });
  return { file: paths.serverBundle, entry };
}

export interface ClientBuild {
  entry: string;
  script: string;
  css: string | null;
  files: string[];
}

const ASSET_LOADERS: Record<string, esbuild.Loader> = Object.fromEntries(
  [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".otf"].map((ext) => [ext, "file"]),
);

/** The shell, bundled for the browser into `.thixo/build/client/`, with an index.html. */
export async function buildClientBundle(
  paths: ProjectPaths,
  options: { libraries: ThixoConfig["libraries"]; production: boolean; title?: string },
): Promise<ClientBuild> {
  const shellFile = findShellFile(paths);
  if (!shellFile) throw new CliError(`No app/shell.tsx in ${paths.root}. It is the app's base: a default-exported React component.`);
  const libraries = (options.libraries ?? []).map((lib) => ({ specifier: lib.specifier, module: resolve(paths.root, lib.module) }));
  const entry = clientEntry({ shellFile, libraries });

  rmSync(paths.clientDir, { recursive: true, force: true });
  mkdirSync(paths.clientDir, { recursive: true });
  const result = await runEsbuild(paths, "app shell", {
    stdin: { contents: entry, resolveDir: paths.root, sourcefile: "thixo-client-entry.tsx", loader: "tsx" },
    outfile: join(paths.clientDir, "app.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    sourcemap: true,
    minify: options.production,
    metafile: true,
    loader: ASSET_LOADERS,
    assetNames: "assets/[name]-[hash]",
    define: { "process.env.NODE_ENV": JSON.stringify(options.production ? "production" : "development") },
    absWorkingDir: paths.root,
  });

  const outputs = Object.keys(result.metafile?.outputs ?? {}).map((file) => relative(paths.clientDir, resolve(paths.root, file)));
  const css = outputs.includes("app.css") ? "/app.css" : null;
  writeFileSync(join(paths.clientDir, "index.html"), indexHtml({ title: options.title ?? basename(paths.root), script: "/app.js", css: css ?? undefined }));
  return { entry, script: "/app.js", css, files: listBuilt(paths.clientDir) };
}

function listBuilt(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

export interface LoadedApp {
  config: ThixoConfig;
  app: AppDefinition;
  compileEnv: CompileEnv;
}

let generation = 0;

/** Imports a server bundle (again, with a fresh copy of the app's modules) and collects the app from it. The
 * adapters in the config see `THIXO_PROJECT_DIR`, which is set here. */
export async function loadServerBundle(paths: ProjectPaths, server: ServerApi, bundleFile = paths.serverBundle): Promise<LoadedApp> {
  process.env.THIXO_PROJECT_DIR = paths.root;
  let mod: { config?: ThixoConfig; modules?: Record<string, unknown>[] };
  try {
    mod = await import(`${pathToFileURL(bundleFile).href}?v=${++generation}`);
  } catch (error) {
    throw new CliError(`The server bundle failed to load: ${messageOf(error)}`);
  }
  if (!mod.config || !Array.isArray(mod.modules)) throw new CliError(`${bundleFile} does not export a config and modules. Rebuild with \`thixo build\`.`);
  let app: AppDefinition;
  try {
    app = server.collectApp(mod.modules, mod.config);
  } catch (error) {
    closeAdapters(mod.config);
    throw new CliError(`The app's definitions are wrong: ${messageOf(error)}`);
  }
  return { config: mod.config, app, compileEnv: server.buildCompileEnv(app, mod.config) };
}

/** The server's build step for a loaded app, or undefined when the server or the config has none. */
export function builderFor(loaded: LoadedApp, server: ServerApi): Builder | undefined {
  const build = loaded.config.adapters?.build;
  if (!server.buildWithCopies || !build) return undefined;
  return (files, env) => server.buildWithCopies!(build, env, files);
}

/** `local()` adapters hold a database open. Close whatever has a `close`. */
export function closeAdapters(config: ThixoConfig): void {
  try {
    (config.adapters as { close?: () => void }).close?.();
  } catch {}
}

export function readTitle(paths: ProjectPaths): string {
  try {
    const pkg = JSON.parse(readFileSync(join(paths.root, "package.json"), "utf8")) as { name?: string };
    if (pkg.name) return pkg.name;
  } catch {}
  return basename(dirname(paths.configFile));
}
