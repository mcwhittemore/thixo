import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { CodeAdapter } from "thixo/contract";
import { resolveInside } from "./safe-path.js";

export interface FileCodeOptions {
  /** Where `put` and `get` keep bytes. */
  dir: string;
  /** The implementor's project, where `openChange` writes. */
  projectDir: string;
}

async function ensureInside(root: string, file: string, what: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const [realRoot, realParent] = await Promise.all([realpath(root).catch(() => resolve(root)), realpath(dirname(file))]);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new Error(`The ${what} ${JSON.stringify(file)} leaves ${root} through a link`);
  }
}

async function writeAtomic(file: string, bytes: Uint8Array | string): Promise<void> {
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export function fileCodeAdapter(options: FileCodeOptions): CodeAdapter {
  const dir = resolve(options.dir);
  const projectDir = resolve(options.projectDir);

  return {
    async put(key, bytes) {
      const file = resolveInside(dir, key, "key");
      await mkdir(dir, { recursive: true });
      await ensureInside(dir, file, "key");
      await writeAtomic(file, bytes);
    },

    async get(key) {
      const file = resolveInside(dir, key, "key");
      try {
        await mkdir(dir, { recursive: true });
        const [realRoot, realFile] = await Promise.all([realpath(dir), realpath(file)]);
        if (!realFile.startsWith(realRoot + sep)) throw new Error(`The key ${JSON.stringify(key)} leaves ${dir} through a link`);
        return new Uint8Array(await readFile(file));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return null;
        throw error;
      }
    },

    async openChange(change) {
      const writes = Object.entries(change.files).map(([path, text]) => [resolveInside(projectDir, path, "file path"), text] as const);
      const removals = (change.remove ?? []).map((path) => resolveInside(projectDir, path, "file path"));
      await mkdir(projectDir, { recursive: true });
      for (const [file] of writes) await ensureInside(projectDir, file, "file path");
      for (const [file, text] of writes) await writeAtomic(file, text);
      for (const file of removals) await rm(file, { recursive: true, force: true });
      return { where: join(projectDir) };
    },
  };
}
