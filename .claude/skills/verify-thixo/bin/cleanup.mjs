#!/usr/bin/env node
// Stops the instance a launch started and removes its disposable copy. Keeps the evidence.
//   node .claude/skills/verify-thixo/bin/cleanup.mjs [--run <id>]
// Kills only the pid recorded in artifacts/verify/<run>/state.json, never by process name.

import { rmSync } from "node:fs";
import { alive, args, readState, runDir, stateFile } from "./common.mjs";
import { removeCopy } from "../../../../tests/e2e/support.mjs";

const run = args().run ?? "default";
const state = readState(run);
if (!state) {
  console.log(`nothing to clean for run "${run}"`);
  process.exit(0);
}
if (state.pid && alive(state.pid)) {
  process.kill(state.pid, "SIGTERM");
  for (let i = 0; i < 50 && alive(state.pid); i++) await new Promise((ok) => setTimeout(ok, 100));
  if (alive(state.pid)) process.kill(state.pid, "SIGKILL");
  console.log(`stopped pid ${state.pid}`);
}
if (removeCopy(state.dir)) console.log(`removed ${state.dir}`);
else if (state.dir) console.log(`left ${state.dir} in place: only a copy launch.mjs made (its name starts thixo-) is deleted`);
rmSync(stateFile(run), { force: true });
console.log(`evidence kept in ${runDir(run)}`);
