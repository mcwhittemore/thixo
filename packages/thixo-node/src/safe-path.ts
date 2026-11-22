import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolves `key` under `root` and refuses anything that lands outside it: `..` segments, absolute paths, null
 * bytes, and the root itself. */
export function resolveInside(root: string, key: string, what = "path"): string {
  if (typeof key !== "string" || key.length === 0) throw new Error(`The ${what} is empty`);
  if (key.includes("\0")) throw new Error(`The ${what} ${JSON.stringify(key)} has a null byte`);
  if (isAbsolute(key) || /^[a-zA-Z]:/.test(key)) throw new Error(`The ${what} ${JSON.stringify(key)} is absolute`);
  const base = resolve(root);
  const full = resolve(base, key);
  const rel = relative(base, full);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`The ${what} ${JSON.stringify(key)} is outside ${base}`);
  }
  return full;
}
