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

/** `thixo new plugin <name> --slot <export name>`: `plugins/<name>/plugin.thx` with a fresh id. */
export function newPlugin(options: { name: string; slot: string; dir: string }, io: Io): string {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(options.name)) throw new CliError(`"${options.name}" is not a plugin name. Use kebab-case, such as due-dates.`);
  if (!/^[A-Za-z_$][\w$]*$/.test(options.slot)) throw new CliError(`"${options.slot}" is not a slot export name. It is the name exported from app/slots.ts, such as main.`);
  const paths = openProject(options.dir);
  const folder = join(paths.pluginsDir, options.name);
  if (existsSync(folder)) throw new CliError(`plugins/${options.name} already exists.`);

  const slotsFile = findSlotsFile(paths);
  if (slotsFile) {
    const text = readFileSync(slotsFile, "utf8");
    if (!new RegExp(`export\\s+(const|let|var)\\s+${options.slot.replace(/\$/g, "\\$")}\\b|export\\s*\\{[^}]*\\b${options.slot.replace(/\$/g, "\\$")}\\b`).test(text)) {
      io.err(`warning: ${slotsFile.slice(paths.root.length + 1)} does not export ${options.slot}. The plugin will not compile until it does.`);
    }
  }

  mkdirSync(folder, { recursive: true });
  const file = join(folder, "plugin.thx");
  writeFileSync(file, pluginTemplate({ name: options.name, slot: options.slot, id: pluginId() }));
  io.out(`Created plugins/${options.name}/plugin.thx`);
  io.out(`Add it to the layout in thixo.config.ts to make it the default for ${options.slot}: { ${options.slot}: ${JSON.stringify(options.name)} }`);
  return file;
}
