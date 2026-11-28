import type { ThixoError } from "@thixo/core";

export function formatErrors(errors: readonly ThixoError[]): string {
  return errors
    .map((e) => `${e.file}:${e.line}:${e.column} ${e.code}: ${e.message}${e.hint ? `\n  ${e.hint}` : ""}`)
    .join("\n");
}
