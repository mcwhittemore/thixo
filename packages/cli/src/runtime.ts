import { execFileSync } from "node:child_process";
import type { Release, ThixoConfig } from "thixo/contract";
import type { DeployInput } from "thixo/server";
import type { Thixo } from "thixo/server";
import { hashOf } from "./build.js";
import { loadServerBundle, type LoadedApp } from "./bundle.js";
import type { Deps } from "./deps.js";
import { CliError, messageOf } from "./errors.js";
import type { Io } from "./io.js";
import { ensureSigningKey } from "./keys.js";
import { buildPlugins, readPlugins, reportOutcome } from "./plugins.js";
import { builderFor } from "./bundle.js";
import type { ProjectPaths } from "./project.js";

export interface RunningApp {
  thixo: Thixo;
  /** The config as the server was made with it: the signing key and, in dev, the agent key are set. */
  config: ThixoConfig;
  loaded: LoadedApp;
}

/** Loads the server bundle, makes sure there is a signing key, makes the server and migrates the data adapter. */
export async function activateApp(paths: ProjectPaths, deps: Deps, options: { agentKey?: string }): Promise<RunningApp> {
  const server = await deps.server();
  const loaded = await loadServerBundle(paths, server);
  const signingKey = ensureSigningKey(paths.signingKeyFile);
  const config: ThixoConfig = {
    ...loaded.config,
    signingKey: loaded.config.signingKey ?? signingKey,
    ...(options.agentKey ? { agentKey: options.agentKey } : {}),
  };
  try {
    await config.adapters.data.migrate();
  } catch (error) {
    throw new CliError(`The data adapter could not migrate: ${messageOf(error)}`);
  }
  return { thixo: server.createThixo(loaded.app, config), config, loaded };
}

/** The git sha when the project is in a git work tree. */
export function gitSha(root: string): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

export function deploymentId(root: string, buildHash: string): string {
  return gitSha(root) ?? buildHash.slice(0, 12);
}

export interface DeployReport {
  release: Release | null;
  failed: string[];
}

/** Compiles `plugins/` for the diagnostics, then deploys the folders that compiled, with the config's layout.
 * `strict` makes a failing folder an error; otherwise it is printed and left out. */
export async function deployPlugins(app: RunningApp, paths: ProjectPaths, deps: Deps, io: Io, options: { strict: boolean; buildHash?: string }): Promise<DeployReport> {
  const thx = await deps.thx();
  const plugins = readPlugins(paths.pluginsDir);
  const outcomes = await buildPlugins(plugins, app.loaded.compileEnv, thx, builderFor(app.loaded, await deps.server()));
  const failed = outcomes.filter((o) => !o.result.ok);
  for (const outcome of failed) for (const line of reportOutcome(outcome)) io.err(line);
  if (failed.length && options.strict) throw new CliError(`${failed.length} plugin${failed.length === 1 ? "" : "s"} failed to compile. Run \`thixo build\` and fix them.`);

  // A folder the layout names but that did not compile would make the deploy refuse it as missing, which reads like
  // a config error. Say what happened instead, and keep the last release.
  const named = new Set(Object.values(app.config.layout));
  const blocking = failed.filter((o) => named.has(o.name)).map((o) => `plugins/${o.name}`);
  if (blocking.length && !options.strict) {
    io.err(`  not deployed: the layout names ${blocking.join(", ")}, which did not compile (see above). The app keeps the last release until ${blocking.length === 1 ? "it compiles" : "they compile"}.`);
    return { release: null, failed: failed.map((o) => o.name) };
  }

  const passing = Object.fromEntries(outcomes.filter((o) => o.result.ok).map((o) => [o.name, plugins[o.name]]));
  const buildHash = options.buildHash ?? hashOf(outcomes.map((o) => (o.result.ok ? o.result.sourceHash : `failed:${o.name}`)));
  const input: DeployInput & { deployment: string } = { plugins: passing, layout: app.config.layout, deployment: deploymentId(paths.root, buildHash) };
  try {
    const release = await app.thixo.services.deploy(input);
    const slots = Object.entries(release.layout).map(([slot, ref]) => `${slot} -> ${ref.plugin}@${ref.number}`);
    io.out(`  deployed  release ${release.id} (${Object.keys(passing).length} plugins${slots.length ? `; ${slots.join(", ")}` : ""})`);
    return { release, failed: failed.map((o) => o.name) };
  } catch (error) {
    if (options.strict) throw new CliError(`The deploy failed: ${messageOf(error)}`);
    io.err(`  deploy failed: ${messageOf(error)}`);
    io.err("  The app keeps the last release until a deploy succeeds.");
    return { release: null, failed: failed.map((o) => o.name) };
  }
}
