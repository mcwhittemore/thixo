import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CliError } from "./errors.js";

const CONFIG_NAMES = ["thixo.config.ts", "thixo.config.mts", "thixo.config.js", "thixo.config.mjs"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

export interface ProjectPaths {
  root: string;
  configFile: string;
  apiDir: string;
  appDir: string;
  pluginsDir: string;
  stateDir: string;
  buildDir: string;
  serverBundle: string;
  clientDir: string;
  manifestFile: string;
  signingKeyFile: string;
  agentKeyFile: string;
  devFile: string;
}

function configIn(dir: string): string | null {
  for (const name of CONFIG_NAMES) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Walks up from `from` to the nearest folder that holds a `thixo.config.*`. */
export function findProjectRoot(from: string): string | null {
  let dir = resolve(from);
  try {
    if (statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    dir = dirname(dir);
  }
  for (;;) {
    if (configIn(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function projectPaths(root: string, configFile?: string): ProjectPaths {
  const stateDir = join(root, ".thixo");
  const buildDir = join(stateDir, "build");
  return {
    root,
    configFile: configFile ?? configIn(root) ?? join(root, "thixo.config.ts"),
    apiDir: join(root, "api"),
    appDir: join(root, "app"),
    pluginsDir: join(root, "plugins"),
    stateDir,
    buildDir,
    serverBundle: join(buildDir, "server.mjs"),
    clientDir: join(buildDir, "client"),
    manifestFile: join(buildDir, "manifest.json"),
    signingKeyFile: join(stateDir, "signing-key"),
    agentKeyFile: join(stateDir, "agent-key"),
    devFile: join(stateDir, "dev.json"),
  };
}

/** The project in `dir` itself, which must have a config. */
export function openProject(dir: string): ProjectPaths {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new CliError(`${root} is not a folder.`);
  const configFile = configIn(root);
  if (!configFile) {
    const above = findProjectRoot(root);
    throw new CliError(
      `No thixo.config.ts in ${root}.${above ? ` The project is ${above}: run the command there, or pass it as the folder.` : " Run the command in an app's folder, or pass the folder."}`,
    );
  }
  return projectPaths(root, configFile);
}

export function listFiles(dir: string, keep: (name: string) => boolean = () => true): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && keep(entry.name)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

function isSource(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.endsWith(".d.ts") && !/\.(test|spec)\.[^.]+$/.test(name);
}

export function findApiFiles(paths: ProjectPaths): string[] {
  return listFiles(paths.apiDir, isSource);
}

function firstExisting(dir: string, base: string): string | null {
  for (const ext of SOURCE_EXTENSIONS) {
    const file = join(dir, base + ext);
    if (existsSync(file)) return file;
  }
  return null;
}

export function findSlotsFile(paths: ProjectPaths): string | null {
  return firstExisting(paths.appDir, "slots");
}

export function findShellFile(paths: ProjectPaths): string | null {
  return firstExisting(paths.appDir, "shell");
}
