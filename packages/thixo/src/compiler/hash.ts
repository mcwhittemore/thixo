import { createHash } from "node:crypto";
import type { SourceFiles } from "../contract.js";

/** JSON with every object's keys sorted and no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The files as canonical JSON: paths sorted, so the same files always hash the same. */
export function sourceHash(files: SourceFiles): string {
  return sha256(canonicalJson(files));
}
