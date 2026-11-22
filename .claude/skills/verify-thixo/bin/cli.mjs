#!/usr/bin/env node
// Runs the `thixo` command against this run's copy of the app and saves the transcript.
//   node .claude/skills/verify-thixo/bin/cli.mjs [--run <id>] [--save <label>] -- <thixo args>
// Runs in the copy's folder, so `thixo agent` finds its .thixo/agent-key and port. Paths in the args are used as
// given. The transcript (command, exit code, stdout, stderr) goes to artifacts/verify/<run>/cli/<label>.txt.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { args, fail, readState, runDir, THIXO } from "./common.mjs";

const a = args();
const run = a.run ?? "default";
const rest = a["--"];
if (!rest?.length) fail("give the thixo arguments after --, such as -- agent describe --as ana");
const state = readState(run);
if (!state?.dir) fail(`no instance for run "${run}". Run launch.mjs first.`);

const result = spawnSync(process.execPath, [THIXO, ...rest], { cwd: state.dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
const label = a.save && a.save !== true ? a.save : rest.slice(0, 2).join("-").replace(/[^\w-]/g, "_");
const dir = join(runDir(run), "cli");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${label}.txt`), `$ thixo ${rest.join(" ")}\n(cwd ${state.dir})\nexit ${result.status}\n--- stdout\n${result.stdout}--- stderr\n${result.stderr}`);
console.error(`transcript in ${join(dir, `${label}.txt`)}`);
process.exit(result.status ?? 1);
