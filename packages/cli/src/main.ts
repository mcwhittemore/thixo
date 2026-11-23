import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent, type Fetch } from "./agent.js";
import { helpText, parseCommand } from "./args.js";
import { buildProject } from "./build.js";
import { runCompile } from "./compile-cmd.js";
import { realDeps, type Deps } from "./deps.js";
import { runDev } from "./dev.js";
import { CliError } from "./errors.js";
import { processIo, type Io } from "./io.js";
import { newPlugin, type AppSlots } from "./new-plugin.js";
import { buildServerBundle, closeAdapters, loadServerBundle } from "./bundle.js";
import { openProject } from "./project.js";
import { runRegistryList, runRelease } from "./registry-cmd.js";
import { runAuthoringCommand } from "./authoring-cmd.js";
import { runStart } from "./start.js";

export interface RunContext {
  io?: Io;
  deps?: Deps;
  fetch?: Fetch;
}

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}

/** The app's slots and slot paths, for the layout line `new plugin` prints. Undefined when the app does not load:
 * the folder is still made. */
async function appSlots(dir: string, deps: Deps): Promise<AppSlots | undefined> {
  try {
    const paths = openProject(dir);
    const server = await deps.server();
    if (!server.slotPaths) return undefined;
    await buildServerBundle(paths);
    const loaded = await loadServerBundle(paths, server);
    closeAdapters(loaded.config);
    return { slots: loaded.app.slots, paths: server.slotPaths(loaded.app.slots) };
  } catch {
    return undefined;
  }
}

/** Runs one command line and returns the exit code. */
export async function run(argv: string[], context: RunContext = {}): Promise<number> {
  const io = context.io ?? processIo();
  const deps = context.deps ?? realDeps;
  try {
    const command = parseCommand(argv, io.env);
    const at = (dir: string) => openProject(resolve(io.cwd, dir));
    switch (command.name) {
      case "help":
        io.out(helpText(command.topic));
        return 0;
      case "version":
        io.out(version());
        return 0;
      case "build":
        await buildProject(at(command.dir), { production: command.minify }, io, deps);
        return 0;
      case "start":
        return await runStart(at(command.dir), command, io, deps);
      case "dev":
        return await runDev(at(command.dir), command, io, deps);
      case "compile":
        return await runCompile(command, io, deps);
      case "new-plugin":
        newPlugin(
          { name: command.pluginName, slot: command.slot, dir: resolve(io.cwd, command.dir), ...(command.personal !== undefined ? { personal: resolve(io.cwd, command.personal) } : {}) },
          io,
          await appSlots(resolve(io.cwd, command.dir), deps),
        );
        return 0;
      case "agent":
        return await runAgent(command.options, io, context.fetch);
      case "registry-list":
        return await runRegistryList(at(command.dir), command, io, deps);
      case "release":
        return await runRelease(at(command.dir), command, io, deps);
      case "authoring":
        return await runAuthoringCommand(at(command.dir), command.command, io, deps);
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`thixo: ${error.message}`);
      return error.exitCode;
    }
    io.err(`thixo: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return 1;
  }
}
