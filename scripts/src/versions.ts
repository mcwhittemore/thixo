import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  [field: string]: unknown;
}

export interface Workspace {
  dir: string;
  manifest: Manifest;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(version: string): [number, number, number] {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`${version} is not a MAJOR.MINOR.PATCH version`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function showFile(repo: string, ref: string, path: string): string | undefined {
  try {
    return git(repo, ["show", `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

export function readWorkspaces(repo: string): Workspace[] {
  return readdirSync(join(repo, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = `packages/${entry.name}`;
      const manifest = JSON.parse(readFileSync(join(repo, dir, "package.json"), "utf8")) as Manifest;
      return { dir, manifest };
    })
    .filter((workspace) => !workspace.manifest.private);
}

function withoutVersion(manifest: Manifest): string {
  const { version: _version, ...rest } = manifest;
  return JSON.stringify(rest);
}

export function shipsChanges(repo: string, base: string, workspace: Workspace): boolean {
  const changed = git(repo, ["diff", "--name-only", `${base}...HEAD`, "--", workspace.dir])
    .split("\n")
    .filter((path) => path !== "" && !path.startsWith(`${workspace.dir}/test/`));
  const manifestPath = `${workspace.dir}/package.json`;
  if (changed.some((path) => path !== manifestPath)) return true;
  if (!changed.includes(manifestPath)) return false;
  const before = showFile(repo, base, manifestPath);
  if (before === undefined) return true;
  return withoutVersion(JSON.parse(before) as Manifest) !== withoutVersion(workspace.manifest);
}

export function checkVersions(repo: string, base: string): string[] {
  const workspaces = readWorkspaces(repo);
  const versions = new Map(workspaces.map((w) => [w.manifest.name, w.manifest.version]));
  const problems: string[] = [];

  for (const workspace of workspaces) {
    const { name, version, dependencies = {} } = workspace.manifest;

    for (const [dependency, range] of Object.entries(dependencies)) {
      const current = versions.get(dependency);
      if (current !== undefined && range !== current) {
        problems.push(`${name} depends on ${dependency}@${range}, but ${dependency} is ${current}. Pin it to ${current}.`);
      }
    }

    try {
      parseVersion(version);
    } catch (error) {
      problems.push(`${name}: ${(error as Error).message}.`);
      continue;
    }

    if (!shipsChanges(repo, base, workspace)) continue;
    const before = showFile(repo, base, `${workspace.dir}/package.json`);
    if (before === undefined) continue;
    const baseVersion = (JSON.parse(before) as Manifest).version;
    if (compareVersions(version, baseVersion) <= 0) {
      problems.push(
        `${name} changed but its version is still ${version}. Raise it above ${baseVersion}: patch for a fix, minor for a feature or, while it is 0.x, a breaking change.`,
      );
    }
  }

  return problems;
}

export function publishOrder(workspaces: Workspace[]): Workspace[] {
  const byName = new Map(workspaces.map((w) => [w.manifest.name, w]));
  const ordered: Workspace[] = [];
  const visiting = new Set<string>();

  const visit = (workspace: Workspace): void => {
    const { name, dependencies = {} } = workspace.manifest;
    if (ordered.includes(workspace)) return;
    if (visiting.has(name)) throw new Error(`${name} is in a dependency cycle`);
    visiting.add(name);
    for (const dependency of Object.keys(dependencies)) {
      const internal = byName.get(dependency);
      if (internal) visit(internal);
    }
    visiting.delete(name);
    ordered.push(workspace);
  };

  for (const workspace of workspaces) visit(workspace);
  return ordered;
}
