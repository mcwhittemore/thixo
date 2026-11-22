import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_NAME_TOKEN = "__APP_NAME__";
export const DEFAULT_TEMPLATE = fileURLToPath(new URL("../template/", import.meta.url));

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PLUGIN_FILE_PATTERN = /^plugins\/[^/]+\/plugin\.thx$/;
const PLUGIN_ID_PATTERN = /id: "plg_[^"]*"/g;

export class UsageError extends Error {}

/** Each template file name that is written under another name in an app. */
const RENAMED = { gitignore: ".gitignore" };

export function checkName(name) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.length > 214) {
    throw new UsageError(`"${name}" is not an app name. Use lower-case letters, digits and dashes, such as my-app.`);
  }
}

/** A fresh plugin id: `plg_` and 18 random hex characters. */
export function freshPluginId(random = () => randomBytes(9).toString("hex")) {
  return `plg_${random()}`;
}

async function listFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, full)));
    else files.push(relative(root, full).split(sep).join("/"));
  }
  return files.sort();
}

async function ensureFreeFolder(dir, name) {
  let info;
  try {
    info = await stat(dir);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!info.isDirectory()) throw new UsageError(`${name} exists and is not a folder.`);
  if ((await readdir(dir)).length > 0) throw new UsageError(`${name} already exists and is not empty. Pick another name or an empty folder.`);
}

/** Copies the template into `<cwd>/<name>`, names the app and gives each default plugin a fresh id. */
export async function createApp({ name, cwd = process.cwd(), template = DEFAULT_TEMPLATE, random } = {}) {
  checkName(name);
  const dir = resolve(cwd, name);
  await ensureFreeFolder(dir, name);

  const files = await listFiles(template);
  const pluginIds = [];
  const written = [];

  for (const file of files) {
    let text = await readFile(join(template, file), "utf8");
    text = text.split(APP_NAME_TOKEN).join(name);
    if (PLUGIN_FILE_PATTERN.test(file)) {
      text = text.replace(PLUGIN_ID_PATTERN, () => {
        const id = freshPluginId(random);
        pluginIds.push(id);
        return `id: "${id}"`;
      });
    }
    const target = join(dir, RENAMED[file] ?? file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    written.push(RENAMED[file] ?? file);
  }

  return { dir, name, files: written, pluginIds };
}
