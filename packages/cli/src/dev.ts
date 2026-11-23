import { existsSync, mkdirSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { buildClientBundle, buildServerBundle, closeAdapters, readTitle } from "./bundle.js";
import { classifyChange, hasImpact, mergeImpact, noImpact, type Impact } from "./changes.js";
import type { Deps, Served } from "./deps.js";
import { CliError, messageOf } from "./errors.js";
import { createHandler } from "./handler.js";
import { untilAborted, withNodeEnv, type Io } from "./io.js";
import { writeAgentKey } from "./keys.js";
import type { ProjectPaths } from "./project.js";
import { activateApp, deployPlugins, type RunningApp } from "./runtime.js";

export interface DevServer {
  url: string;
  /** Finishes when the rebuild that is running or queued is done. For tests. */
  idle(): Promise<void>;
  /** Report a changed file as the watcher would. */
  changed(file: string): void;
  close(): Promise<void>;
}

const DEBOUNCE_MS = 80;

function libraryKey(app: RunningApp | null): string {
  return JSON.stringify(app?.config.libraries?.map((l) => [l.specifier, l.module]) ?? []);
}

/** `thixo dev`, without waiting. Builds, deploys and serves; rebuilds on change. Errors from a rebuild are printed
 * and the last good server keeps answering. */
export async function startDev(paths: ProjectPaths, options: { port: number; hostname?: string; watch?: boolean }, io: Io, deps: Deps): Promise<DevServer> {
  const agentKey = writeAgentKey(paths.agentKeyFile);
  mkdirSync(paths.buildDir, { recursive: true });

  let app: RunningApp | null = null;
  let problem: string | null = null;
  let libraries = "[]";

  const report = (what: string, error: unknown) => {
    const message = error instanceof CliError ? error.message : messageOf(error);
    problem = message;
    io.err(`${what}:\n${message}`);
  };

  const rebuildServer = async (): Promise<boolean> => {
    try {
      await buildServerBundle(paths);
      const next = await activateApp(paths, deps, { agentKey, log: (line) => io.err(line) });
      const previous = app;
      app = next;
      problem = null;
      if (previous) setTimeout(() => closeAdapters(previous.config), 1000).unref();
      io.out("  server    rebuilt");
      return true;
    } catch (error) {
      report("Server did not build (still running the last good one)", error);
      return false;
    }
  };

  const rebuildClient = async (production = false): Promise<void> => {
    try {
      await buildClientBundle(paths, { libraries: app?.config.libraries, production, title: readTitle(paths) });
      io.out("  client    rebuilt (reload the page)");
    } catch (error) {
      report("The shell did not build", error);
    }
  };

  const redeploy = async (): Promise<void> => {
    if (!app) return;
    try {
      await deployPlugins(app, paths, deps, io, { strict: false });
    } catch (error) {
      io.err(`  deploy failed: ${messageOf(error)}`);
    }
  };

  io.out(`Starting ${paths.root}`);
  process.env.THIXO_PROJECT_DIR = paths.root;
  await rebuildServer();
  libraries = libraryKey(app);
  await rebuildClient();
  await redeploy();

  const node = await deps.node();
  const handler = createHandler({
    thixo: () => app?.thixo ?? null,
    problem: () => problem,
    clientDir: paths.clientDir,
  });
  let served: Served;
  try {
    served = await node.serve(handler, { port: options.port, hostname: options.hostname });
  } catch (error) {
    if (app) closeAdapters((app as RunningApp).config);
    const code = (error as NodeJS.ErrnoException).code;
    throw new CliError(code === "EADDRINUSE" ? `Port ${options.port} is already in use. Pass another with --port.` : `Could not listen on port ${options.port}: ${messageOf(error)}`);
  }
  writeFileSync(paths.devFile, `${JSON.stringify({ url: served.url, pid: process.pid, startedAt: new Date().toISOString() })}\n`);

  let pending: Impact = noImpact();
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const flush = () => {
    const impact = pending;
    pending = noImpact();
    running = running.then(async () => {
      let serverOk = true;
      if (impact.server) serverOk = await rebuildServer();
      const clientNeeded = impact.client || (impact.server && serverOk && libraryKey(app) !== libraries);
      if (impact.server && serverOk) libraries = libraryKey(app);
      if (clientNeeded) await rebuildClient();
      if (impact.plugins && serverOk) await redeploy();
    });
  };

  const changed = (file: string) => {
    const impact = classifyChange(paths, file);
    if (!hasImpact(impact)) return;
    pending = mergeImpact(pending, impact);
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];
  if (options.watch !== false) {
    for (const dir of [paths.apiDir, paths.appDir, paths.pluginsDir]) {
      if (!existsSync(dir)) continue;
      watchers.push(watch(dir, { recursive: true }, (_event, name) => name && changed(`${dir}/${name}`)));
    }
    watchers.push(watch(paths.root, (_event, name) => name && changed(`${paths.root}/${name}`)));
    for (const w of watchers) w.on("error", () => {});
  }

  return {
    url: served.url,
    changed,
    async idle() {
      for (;;) {
        if (hasImpact(pending)) {
          clearTimeout(timer);
          flush();
        }
        const current = running;
        await current;
        if (current === running && !hasImpact(pending)) return;
      }
    },
    async close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      await running;
      await served.close();
      if (app) closeAdapters((app as RunningApp).config);
      rmSync(paths.devFile, { force: true });
    },
  };
}

export async function runDev(paths: ProjectPaths, options: { port: number }, io: Io, deps: Deps): Promise<number> {
  return withNodeEnv("development", async () => {
    const dev = await startDev(paths, options, io, deps);
    io.out(`thixo dev  ready on ${dev.url}`);
    io.out(`  agent key in .thixo/agent-key; \`thixo agent\` is for a coding agent to use the authoring tools as a user here; try \`thixo agent describe --as <user>\``);
    await untilAborted(io.signal);
    await dev.close();
    return 0;
  });
}
