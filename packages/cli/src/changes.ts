import { basename, relative, resolve, sep } from "node:path";
import type { ProjectPaths } from "./project.js";

/** What a changed file means for a running `thixo dev`. */
export interface Impact {
  /** Rebuild the server bundle and swap the handler (api/, the config, app/slots). */
  server: boolean;
  /** Rebuild the browser bundle (app/). */
  client: boolean;
  /** Recompile and redeploy plugins/. A new server bundle can change what plugins compile against, so it does too. */
  plugins: boolean;
}

const NONE: Impact = { server: false, client: false, plugins: false };

function ignored(name: string): boolean {
  return name.startsWith(".") || name.endsWith("~") || name.endsWith(".swp") || name.endsWith(".tmp");
}

export function classifyChange(paths: ProjectPaths, file: string): Impact {
  const rel = relative(paths.root, resolve(paths.root, file));
  if (rel.startsWith("..")) return NONE;
  const parts = rel.split(sep);
  if (parts.some((p) => p === "node_modules" || p === ".thixo" || ignored(p))) return NONE;
  const [top] = parts;
  if (parts.length === 1 && /^thixo\.config\.[cm]?[jt]s$/.test(top)) return { server: true, client: false, plugins: true };
  if (top === "api") return { server: true, client: false, plugins: true };
  if (top === "plugins") return { server: false, client: false, plugins: true };
  if (top === "app") {
    const isSlots = parts.length === 2 && /^slots\.[cm]?[jt]sx?$/.test(basename(rel));
    return { server: isSlots, client: true, plugins: isSlots };
  }
  return NONE;
}

export function mergeImpact(a: Impact, b: Impact): Impact {
  return { server: a.server || b.server, client: a.client || b.client, plugins: a.plugins || b.plugins };
}

export const noImpact = (): Impact => ({ ...NONE });

export function hasImpact(i: Impact): boolean {
  return i.server || i.client || i.plugins;
}
