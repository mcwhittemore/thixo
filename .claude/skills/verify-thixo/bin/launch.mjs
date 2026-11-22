#!/usr/bin/env node
// Starts `thixo dev` on a disposable copy of an app, on a free port, in the background.
//   node .claude/skills/verify-thixo/bin/launch.mjs [--run <id>] [--example todo|crm | --dir <app folder>] [--as <user>] [--port 0]
// --example copies examples/<name>. --dir copies any app folder, such as one create-thixo-app made. --as is the user
// the doctor signs in as (default: ana for todo and for a created app, rita for crm).
// Prints the run's state as JSON once the server says it is ready. Stop it with cleanup.mjs --run <id>.

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { copyApp, copyExample } from "../../../../tests/e2e/support.mjs";
import { alive, args, fail, readState, runDir, THIXO, writeState } from "./common.mjs";

const a = args();
const run = a.run ?? "default";
if (a.dir && a.example) fail("give --example or --dir, not both.");
if (a.dir === true) fail("--dir needs the app's folder, such as --dir examples-tmp/my-app.");
const source = a.dir ? resolve(a.dir) : null;
const example = source ? basename(source) : (a.example ?? "todo");
// Who the doctor signs in as: each example's own login, and the template's ana for an app create-thixo-app made.
const SIGN_IN_AS = { todo: "ana", crm: "rita" };
const signInAs = a.as && a.as !== true ? a.as : (source ? "ana" : SIGN_IN_AS[example]);
const previous = readState(run);
if (previous?.pid && alive(previous.pid)) fail(`run "${run}" is still up (pid ${previous.pid}, ${previous.url}). Run cleanup.mjs --run ${run} first, or pick another --run.`);

let dir;
try {
  dir = source ? copyApp(source, example) : copyExample(example);
} catch (error) {
  fail(error.message);
}
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
    writeState(run, { run, example, source, signInAs, dir, log, pid: null, url: null, failed: true });
    fail(`thixo dev exited before it was ready. Its output:\n${text}`);
  }
  if (Date.now() - started > 90_000) {
    process.kill(child.pid, "SIGTERM");
    fail(`thixo dev was not ready after 90s. See ${log}`);
  }
  await new Promise((ok) => setTimeout(ok, 200));
}

const state = { run, example, source, signInAs, dir, url, pid: child.pid, log, startedAt: new Date().toISOString() };
writeState(run, state);
console.log(JSON.stringify(state, null, 2));
