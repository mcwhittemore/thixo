#!/usr/bin/env node
// Starts `thixo dev` on a disposable copy of an example, on a free port, in the background.
//   node .claude/skills/verify-thixo/bin/launch.mjs [--run <id>] [--example todo] [--port 0]
// Prints the run's state as JSON once the server says it is ready. Stop it with cleanup.mjs --run <id>.

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { copyExample } from "../../../../tests/e2e/support.mjs";
import { alive, args, fail, readState, runDir, THIXO, writeState } from "./common.mjs";

const a = args();
const run = a.run ?? "default";
const example = a.example ?? "todo";
const previous = readState(run);
if (previous?.pid && alive(previous.pid)) fail(`run "${run}" is still up (pid ${previous.pid}, ${previous.url}). Run cleanup.mjs --run ${run} first, or pick another --run.`);

const dir = copyExample(example);
const log = join(runDir(run), "dev.log");
const fd = openSync(log, "w");
const child = spawn(process.execPath, [THIXO, "dev", dir, "--port", String(a.port ?? 0)], {
  cwd: dir,
  env: { ...process.env, NO_COLOR: "1" },
  stdio: ["ignore", fd, fd],
  detached: true,
});
child.unref();
closeSync(fd);

const started = Date.now();
let url;
while (!url) {
  const text = readFileSync(log, "utf8");
  url = /ready on (http:\/\/\S+)/.exec(text)?.[1];
  if (url) break;
  if (!alive(child.pid)) {
    writeState(run, { run, example, dir, log, pid: null, url: null, failed: true });
    fail(`thixo dev exited before it was ready. Its output:\n${text}`);
  }
  if (Date.now() - started > 90_000) {
    process.kill(child.pid, "SIGTERM");
    fail(`thixo dev was not ready after 90s. See ${log}`);
  }
  await new Promise((ok) => setTimeout(ok, 200));
}

const state = { run, example, dir, url, pid: child.pid, log, startedAt: new Date().toISOString() };
writeState(run, state);
console.log(JSON.stringify(state, null, 2));
