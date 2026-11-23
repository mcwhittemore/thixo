import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeSecret(file: string, value: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${value}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function newKey(): string {
  return randomBytes(32).toString("hex");
}

/** The signing key in `.thixo/signing-key`, created (mode 600) when it is missing. */
export function ensureSigningKey(file: string): string {
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const key = newKey();
  writeSecret(file, key);
  return key;
}

/** `thixo dev` writes a new agent key on every start. */
export function writeAgentKey(file: string): string {
  const key = newKey();
  writeSecret(file, key);
  return key;
}

export function readAgentKey(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}
