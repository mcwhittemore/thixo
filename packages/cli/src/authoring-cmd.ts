import type { AuthoringBlock, AuthoringRefusal, ThixoConfig, UserId } from "thixo/contract";
import type { Services } from "thixo/server";
import { buildServerBundle, closeAdapters, loadServerBundle } from "./bundle.js";
import type { Deps } from "./deps.js";
import { CliError, messageOf } from "./errors.js";
import type { Io } from "./io.js";
import type { ProjectPaths } from "./project.js";

/** Who the command acts as. Whoever runs the CLI on the app's own folder holds its data, as the implementor does. */
const OPERATOR: UserId = "implementor";

export type AuthoringCommand =
  | { what: "blocks"; all: boolean; json: boolean }
  | { what: "refusals"; user?: string; json: boolean }
  | { what: "unblock"; user: string; json: boolean };

/** Runs `use` with the app's own server services, on the app's data adapter. A running `thixo dev` sees the change at
 * once: it reads the block from the data adapter on every request. */
async function withServices<T>(paths: ProjectPaths, deps: Deps, use: (services: Services["authoring"]) => Promise<T>): Promise<T> {
  await buildServerBundle(paths);
  const server = await deps.server();
  const loaded = await loadServerBundle(paths, server);
  const config: ThixoConfig = loaded.config;
  try {
    try {
      await config.adapters.data.migrate();
    } catch (error) {
      throw new CliError(`The data adapter could not migrate: ${messageOf(error)}`);
    }
    return await use(server.createThixo(loaded.app, config).services.authoring);
  } finally {
    closeAdapters(config);
  }
}

function table(rows: string[][]): string[] {
  if (!rows.length) return [];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd());
}

const oneLine = (text: string, max = 72) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function printBlocks(blocks: AuthoringBlock[], io: Io): void {
  if (!blocks.length) {
    io.out("No one is blocked from making plugins.");
    return;
  }
  const rows = blocks.map((b) => [b.user, b.at, b.liftedAt ? `lifted ${b.liftedAt} by ${b.liftedBy ?? "?"}` : "blocked", String(b.refusals.length), oneLine(b.reason)]);
  for (const line of table([["USER", "SINCE", "STATE", "REFUSALS", "REASON"], ...rows])) io.out(line);
  if (blocks.some((b) => !b.liftedAt)) io.out("Lift one with `thixo authoring unblock <user>`.");
}

function printRefusals(refusals: AuthoringRefusal[], io: Io): void {
  if (!refusals.length) {
    io.out("The authoring agent has refused nothing.");
    return;
  }
  for (const r of refusals) {
    io.out(`${r.at}  ${r.user}  ${r.category}  ${r.source === "check" ? "check" : "agent"}${r.from === "data" ? ", from data (not counted)" : ""}${r.conversation ? `  conversation ${r.conversation}` : ""}`);
    io.out(`  reason:  ${oneLine(r.reason, 200)}`);
    io.out(`  trigger: ${oneLine(r.trigger, 200)}`);
    if (r.quote) io.out(`  quote:   ${oneLine(r.quote, 200)}`);
  }
}

/** `thixo authoring blocks | refusals | unblock <user>`. */
export async function runAuthoringCommand(paths: ProjectPaths, command: AuthoringCommand, io: Io, deps: Deps): Promise<number> {
  return withServices(paths, deps, async (authoring) => {
    switch (command.what) {
      case "blocks": {
        const blocks = await authoring.blocks({ all: command.all });
        if (command.json) io.out(JSON.stringify(blocks, null, 2));
        else printBlocks(blocks, io);
        return 0;
      }
      case "refusals": {
        const refusals = await authoring.refusals(command.user ? { user: command.user } : {});
        if (command.json) io.out(JSON.stringify(refusals, null, 2));
        else printRefusals(refusals, io);
        return 0;
      }
      case "unblock": {
        const result = await authoring.unblock(command.user, OPERATOR);
        if (command.json) io.out(JSON.stringify(result, null, 2));
        else
          io.out(
            result.lifted
              ? `Lifted the block on ${command.user}. They can make plugins again, and their count of refusals starts again.`
              : `${command.user} was not blocked. Their count of refusals starts again.`,
          );
        return 0;
      }
    }
  });
}
