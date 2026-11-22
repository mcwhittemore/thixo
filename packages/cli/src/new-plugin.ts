import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./errors.js";
import type { Io } from "./io.js";
import { findSlotsFile, openProject } from "./project.js";

export function pluginId(): string {
  return `plg_${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}`;
}

const sentence = (name: string) => {
  const text = name.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const pascal = (name: string) => name.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

export function pluginTemplate(input: { name: string; slot: string; id: string }): string {
  const title = sentence(input.name);
  return `import { definePlugin } from "thixo/plugin";
import { Stack, Text } from "thixo/ui";
import { ${input.slot} } from "@app/slots";

export default definePlugin(
  ${input.slot},
  {
    id: ${JSON.stringify(input.id)},
    name: ${JSON.stringify(title)},
    description: ${JSON.stringify(`${title}. Change this to say what the plugin does.`)},
  },
  function ${pascal(input.name)}() {
    return (
      <Stack>
        <Text>${title} works.</Text>
      </Stack>
    );
  },
);
`;
}

/** The export name in app/slots.ts of a slot given by its name (`todo-detail`) or its export name (`todoDetail`). */
export function slotExport(slotsText: string, slot: string): string | null {
  const escaped = slot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byName = new RegExp(`export\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*slot\\.\\w+\\(\\s*\\{\\s*name:\\s*["']${escaped}["']`).exec(slotsText);
  if (byName) return byName[1];
  if (/^[A-Za-z_$][\w$]*$/.test(slot) && new RegExp(`export\\s+(const|let|var)\\s+${escaped}\\b|export\\s*\\{[^}]*\\b${escaped}\\b`).test(slotsText)) return slot;
  return null;
}

/** `thixo new plugin <name> --slot <slot>`: `plugins/<name>/plugin.thx` with a fresh id. The slot is its name, such
 * as todo-detail, or its export name in app/slots.ts, such as todoDetail. */
export function newPlugin(options: { name: string; slot: string; dir: string }, io: Io): string {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(options.name)) throw new CliError(`"${options.name}" is not a plugin name. Use kebab-case, such as due-dates.`);
  const paths = openProject(options.dir);
  const folder = join(paths.pluginsDir, options.name);
  if (existsSync(folder)) throw new CliError(`plugins/${options.name} already exists.`);

  const slotsFile = findSlotsFile(paths);
  let exportName = /^[A-Za-z_$][\w$]*$/.test(options.slot) ? options.slot : null;
  if (slotsFile) {
    const found = slotExport(readFileSync(slotsFile, "utf8"), options.slot);
    if (found) exportName = found;
    else if (exportName) io.err(`warning: ${slotsFile.slice(paths.root.length + 1)} has no slot ${options.slot}. The plugin will not compile until it does.`);
  }
  if (!exportName) throw new CliError(`"${options.slot}" is not a slot in app/slots.ts. Give its name, such as todo-detail, or its export name, such as todoDetail.`);

  mkdirSync(folder, { recursive: true });
  const file = join(folder, "plugin.thx");
  writeFileSync(file, pluginTemplate({ name: options.name, slot: exportName, id: pluginId() }));
  io.out(`Created plugins/${options.name}/plugin.thx`);
  io.out(`Add it to the layout in thixo.config.ts to make it a default: { "<slot path>": ${JSON.stringify(options.name)} }`);
  return file;
}
