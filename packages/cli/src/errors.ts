import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Message } from "esbuild";
import type { ThxError } from "thixo-thx/contract";

/** A failure the user can act on. The message is printed as is and the process exits with `exitCode`. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = "CliError";
  }
}

/** Where a plugin's errors are printed from: the folder its files are in, and where the command was run. */
export interface ErrorBase {
  cwd: string;
  dir: string;
}

/** An error's file as a path relative to where the command was run, or its full path when it is outside that folder,
 * since `../../../var/...` is harder to read than the path itself. `(output)` and other non-files are left alone. */
export function errorPath(file: string, base: ErrorBase): string {
  if (file.startsWith("(")) return file;
  const full = resolve(base.dir, file);
  const rel = relative(base.cwd, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return full.split(sep).join("/");
  return rel.split(sep).join("/") || file;
}

/** The one way every command prints a plugin error: `path:line:column code message`, then the hint on its own line.
 * The path is relative to where the command was run. */
export function formatThxError(error: ThxError, base: ErrorBase): string {
  const head = `${errorPath(error.file, base)}:${error.line}:${error.column} ${error.code} ${error.message}`;
  return error.hint ? `${head}\n  hint: ${error.hint}` : head;
}

export function formatThxErrors(errors: ThxError[], base: ErrorBase): string[] {
  return errors.map((e) => formatThxError(e, base));
}

/** The errors with their files made relative to where the command was run, for `--json`. */
export function locateThxErrors(errors: ThxError[], base: ErrorBase): ThxError[] {
  return errors.map((e) => ({ ...e, file: errorPath(e.file, base) }));
}

export function formatEsbuildMessages(messages: Message[], root: string): string[] {
  return messages.map((m) => {
    const where = m.location ? `${relativeTo(root, m.location.file)}:${m.location.line}:${m.location.column + 1} ` : "";
    return `${where}${m.text}`;
  });
}

function relativeTo(root: string, file: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
