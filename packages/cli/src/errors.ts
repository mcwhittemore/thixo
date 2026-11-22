import type { Message } from "esbuild";
import type { ThxError } from "thixo-thx/contract";

/** A failure the user can act on. The message is printed as is and the process exits with `exitCode`. */
export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = "CliError";
  }
}

/** `file:line:col code message`, then the hint on its own line. */
export function formatThxError(error: ThxError, filePrefix = ""): string {
  const head = `${filePrefix}${error.file}:${error.line}:${error.column} ${error.code} ${error.message}`;
  return error.hint ? `${head}\n  hint: ${error.hint}` : head;
}

export function formatThxErrors(errors: ThxError[], filePrefix = ""): string[] {
  return errors.map((e) => formatThxError(e, filePrefix));
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
