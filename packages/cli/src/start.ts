import { existsSync } from "node:fs";
import { join } from "node:path";
import { readBuildManifest } from "./build.js";
import { closeAdapters } from "./bundle.js";
import type { Deps, Served } from "./deps.js";
import { CliError } from "./errors.js";
import { createHandler } from "./handler.js";
import { untilAborted, type Io } from "./io.js";
import type { ProjectPaths } from "./project.js";
import { activateApp, deployPlugins } from "./runtime.js";

export interface Started {
  url: string;
  close(): Promise<void>;
}

/** `thixo start`, without waiting: serves the build in `.thixo/build/`. */
export async function startServer(paths: ProjectPaths, options: { port: number; hostname?: string }, io: Io, deps: Deps): Promise<Started> {
  const manifest = readBuildManifest(paths);
  if (!manifest.ok) throw new CliError("The last build failed. Fix it and run `thixo build` again.");
  if (!existsSync(paths.serverBundle) || !existsSync(join(paths.clientDir, manifest.client.index))) {
    throw new CliError("The build in .thixo/build/ is incomplete. Run `thixo build` again.");
  }

  const app = await activateApp(paths, deps, {});
  try {
    await deployPlugins(app, paths, deps, io, { strict: true, buildHash: manifest.hash });
    const node = await deps.node();
    const handler = createHandler({ thixo: () => app.thixo, clientDir: paths.clientDir, addressHosts: () => app.config.addressHosts ?? [] });
    let served: Served;
    try {
      served = await node.serve(handler, { port: options.port, hostname: options.hostname });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new CliError(code === "EADDRINUSE" ? `Port ${options.port} is already in use. Pass another with --port.` : `Could not listen on port ${options.port}: ${(error as Error).message}`);
    }
    return {
      url: served.url,
      close: async () => {
        await served.close();
        closeAdapters(app.config);
      },
    };
  } catch (error) {
    closeAdapters(app.config);
    throw error;
  }
}

export async function runStart(paths: ProjectPaths, options: { port: number }, io: Io, deps: Deps): Promise<number> {
  const started = await startServer(paths, options, io, deps);
  io.out(`thixo start  ready on ${started.url}`);
  await untilAborted(io.signal);
  await started.close();
  return 0;
}
