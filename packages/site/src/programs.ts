import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const PROGRAMS_DIR = fileURLToPath(new URL("../programs", import.meta.url));

export function readProgram(name: string): Record<string, string> {
  const root = join(PROGRAMS_DIR, name);
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".thx")) files[relative(root, full).split("\\").join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  const { "main.thx": main, ...rest } = files;
  return main === undefined ? files : { "main.thx": main, ...rest };
}
