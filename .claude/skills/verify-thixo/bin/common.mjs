// Shared by the verify-thixo helpers: where a run's state and evidence live.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const THIXO = join(ROOT, "packages/cli/bin/thixo.js");

/** `--name value` and `--flag` from argv, plus the rest as positionals. */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      out["--"] = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else {
        out[a.slice(2)] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

/** A run's folder: `artifacts/verify/<run>/` at the repo root. `artifacts/` is git-ignored. Evidence goes here and
 * survives cleanup. */
export function runDir(run = "default") {
  const dir = join(ROOT, "artifacts", "verify", run);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function stateFile(run) {
  return join(runDir(run), "state.json");
}

export function readState(run) {
  const file = stateFile(run);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function writeState(run, state) {
  writeFileSync(stateFile(run), JSON.stringify(state, null, 2) + "\n");
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function fail(message) {
  console.error(`verify-thixo: ${message}`);
  process.exit(1);
}
