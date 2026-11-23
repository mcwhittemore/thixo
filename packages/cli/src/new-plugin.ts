import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { CliError } from "./errors.js";
import type { Io } from "./io.js";
import { findSlotsFile, openProject } from "./project.js";

/** A fresh plugin id: `plg_` and 18 random hex characters, as create-thixo-app makes them. */
export function pluginId(): string {
  return `plg_${randomBytes(9).toString("hex")}`;
}

/** What `new plugin` knows of the app when its definitions load: each slot, and every path a layout can name. */
export interface AppSlots {
  slots: { name: string; exportName: string; children: string[] }[];
  paths: string[];
}

/** The layout line to print: the slot's real path, or each of them, so the line can be pasted as it is. */
export function layoutHint(folder: string, slot: string, app?: AppSlots): string {
  const def = app?.slots.find((s) => s.exportName === slot || s.name === slot);
  if (!app || !def) return `Add it to the layout in thixo.config.ts to make it a default: { "<the slot's path>": ${JSON.stringify(folder)} }`;
  const at = app.paths.filter((p) => p === def.name || p.endsWith(`/${def.name}`));
  if (!at.length) return `The slot ${def.name} is not placed in any other slot yet, so no layout can name it. Add it to a parent slot's children in app/slots.ts.`;
  const entries = at.map((p) => `${JSON.stringify(p)}: ${JSON.stringify(folder)}`);
  return at.length === 1
    ? `Add it to the layout in thixo.config.ts to make it a default: ${entries[0]}`
    : `Add it to the layout in thixo.config.ts to make it a default, at one or more of: ${entries.join(", ")}`;
}

const sentence = (name: string) => {
  const text = name.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const pascal = (name: string) => name.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

/** The plugin's first file. `id` is for a default plugin's folder in plugins/ only: a personal plugin, stored with
 * `thixo agent submit`, has none, and the registry gives it its id. */
export function pluginTemplate(input: { name: string; slot: string; id?: string }): string {
  const title = sentence(input.name);
  return `import { definePlugin } from "thixo/plugin";
import { Stack, Text } from "thixo/ui";
import { ${input.slot} } from "@app/slots";

export default definePlugin(
  ${input.slot},
  {
${input.id ? `    id: ${JSON.stringify(input.id)},\n` : ""}    name: ${JSON.stringify(title)},
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

/** Every slot app/slots.ts declares, as `name (exportName)`, read from its text when the app did not load. */
function slotsInText(slotsText: string): string[] {
  return [...slotsText.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*slot\.\w+\(\s*\{\s*name:\s*["']([^"']+)["']/g)].map((m) => `${m[2]} (${m[1]})`);
}

export interface NewPluginOptions {
  name: string;
  slot: string;
  /** The app's folder. */
  dir: string;
  /** `--personal <folder>`: write the plugin there, outside plugins/ and without an id, for `thixo agent submit`. */
  personal?: string;
}

/** `thixo new plugin <name> --slot <slot>`: `plugins/<name>/plugin.thx` with a fresh id, a default plugin's
 * folder. With `--personal <folder>`, the plugin goes in that folder instead, with no id: a personal plugin for the
 * agent path, which the registry gives an id when it is submitted. The slot is its name, such as todo-detail, or its
 * export name in app/slots.ts, such as todoDetail. A slot the app does not have is refused, with the ones it has. */
export function newPlugin(options: NewPluginOptions, io: Io, app?: AppSlots): string {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(options.name)) throw new CliError(`"${options.name}" is not a plugin name. Use kebab-case, such as due-dates.`);
  const paths = openProject(options.dir);

  let folder: string;
  let shown: string;
  if (options.personal !== undefined) {
    folder = resolve(options.dir, options.personal);
    const fromPlugins = relative(paths.pluginsDir, folder);
    if (fromPlugins === "" || (!fromPlugins.startsWith("..") && !isAbsolute(fromPlugins))) {
      throw new CliError(`--personal is for a folder outside plugins/: everything in plugins/ deploys as a default plugin. Pick another folder, such as my-plugins/${options.name}.`);
    }
    if (existsSync(folder) && readdirSync(folder).length) throw new CliError(`${folder} is not empty.`);
    const rel = relative(paths.root, folder);
    shown = !rel ? "." : rel.startsWith("..") ? folder : rel;
  } else {
    folder = join(paths.pluginsDir, options.name);
    if (existsSync(folder)) throw new CliError(`plugins/${options.name} already exists.`);
    shown = `plugins/${options.name}`;
  }

  // The slot: from the loaded app when there is one, else from app/slots.ts's text. Refused when neither has it.
  let exportName: string | null = null;
  let known: string[] | null = null;
  if (app) {
    const def = app.slots.find((s) => s.name === options.slot) ?? app.slots.find((s) => s.exportName === options.slot);
    exportName = def?.exportName ?? null;
    known = app.slots.map((s) => `${s.name} (${s.exportName})`);
  } else {
    const slotsFile = findSlotsFile(paths);
    if (slotsFile) {
      const text = readFileSync(slotsFile, "utf8");
      exportName = slotExport(text, options.slot);
      known = slotsInText(text);
    } else if (/^[A-Za-z_$][\w$]*$/.test(options.slot)) {
      exportName = options.slot;
    }
  }
  if (!exportName) {
    const list = known?.length ? ` The slots are: ${known.join(", ")}.` : "";
    throw new CliError(`There is no slot "${options.slot}" in app/slots.ts. Give a slot's name or its export name.${list}`);
  }

  mkdirSync(folder, { recursive: true });
  const file = join(folder, "plugin.thx");
  const personal = options.personal !== undefined;
  writeFileSync(file, pluginTemplate({ name: options.name, slot: exportName, ...(personal ? {} : { id: pluginId() }) }));
  io.out(`Created ${shown}/plugin.thx`);
  if (!personal) {
    io.out(layoutHint(options.name, exportName, app));
    io.out("The id in its definePlugin is for a default plugin's folder in plugins/. For a personal plugin, which you store with `thixo agent submit`, use --personal <folder>: it has no id.");
    return file;
  }
  const def = app?.slots.find((s) => s.exportName === exportName);
  const at = def && app ? app.paths.filter((p) => p === def.name || p.endsWith(`/${def.name}`)) : [];
  const dir = /\s/.test(shown) ? JSON.stringify(shown) : shown;
  io.out("A personal plugin: it has no id and is outside plugins/, so it is no default. The registry gives it an id when you submit it.");
  io.out(`Check it:  thixo agent check --as <user> --dir ${dir}`);
  io.out(`Store it:  thixo agent submit --as <user> --dir ${dir}`);
  io.out(`Show it:   thixo agent use --as <user> <the id submit prints>@1 --slot ${at[0] ?? "<the slot's path>"}`);
  return file;
}
