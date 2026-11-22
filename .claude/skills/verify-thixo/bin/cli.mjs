#!/usr/bin/env node
// Runs the `thixo` command against this run's copy of the app and saves the transcript.
//   node .claude/skills/verify-thixo/bin/cli.mjs [--run <id>] [--save <label>] [--cwd <dir>] -- <thixo args>
// Runs in the copy's folder, so `thixo agent` finds its .thixo/agent-key and port, and a relative path in the args
// is read from the copy. --cwd runs it in another folder instead (relative to the repo root), such as
// --cwd examples/todo for `compile plugins/due-dates` after the copy is gone. The transcript (command, exit code, stdout, stderr) goes to artifacts/verify/<run>/cli/<label>.txt.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { args, fail, readState, ROOT, runDir, THIXO } from "./common.mjs";

const a = args();
const run = a.run ?? "default";
const rest = a["--"];
if (!rest?.length) fail("give the thixo arguments after --, such as -- agent describe --as ana");
const state = readState(run);
const cwd = a.cwd && a.cwd !== true ? resolve(ROOT, a.cwd) : state?.dir;
if (!cwd) fail(`no instance for run "${run}". Run launch.mjs first, or pass --cwd <dir>.`);

const result = spawnSync(process.execPath, [THIXO, ...rest], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
const label = a.save && a.save !== true ? a.save : rest.slice(0, 2).join("-").replace(/[^\w-]/g, "_");
const dir = join(runDir(run), "cli");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${label}.txt`), `$ thixo ${rest.join(" ")}\n(cwd ${cwd})\nexit ${result.status}\n--- stdout\n${result.stdout}--- stderr\n${result.stderr}`);
console.error(`transcript in ${join(dir, `${label}.txt`)}`);
process.exit(result.status ?? 1);
