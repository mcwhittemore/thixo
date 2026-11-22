// Starts `thixo dev` on a disposable copy of an example, on a free port, and stops it again. Used by the end-to-end
// test and by the verification skill's launcher (.claude/skills/verify-thixo/bin/launch.mjs).

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const THIXO = join(ROOT, "packages/cli/bin/thixo.js");

/** A copy of `examples/<name>` outside the repo, without its `.thixo/` state. Its node_modules is a link to the
 * repo's, so `thixo`, `thixo-node` and React resolve to the workspace packages. */
export function copyExample(name = "todo", base = process.env.THIXO_E2E_TMP ?? tmpdir()) {
  const dir = mkdtempSync(join(base, `thixo-${name}-`));
  cpSync(join(ROOT, "examples", name), dir, {
    recursive: true,
    filter: (src) => !/[/\\](\.thixo|node_modules)([/\\]|$)/.test(src.slice(join(ROOT, "examples", name).length)),
  });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/** Runs the `thixo` command in `cwd` and returns its output. */
export function thixo(args, { cwd = ROOT, input } = {}) {
  const result = spawnSync(process.execPath, [THIXO, ...args], { cwd, input, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** `thixo dev <dir> --port 0`. Resolves when it prints its address. `stop()` ends it and waits. */
export async function startDev(dir, { port = 0, log } = {}) {
  const child = spawn(process.execPath, [THIXO, "dev", dir, "--port", String(port)], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const onData = (chunk) => {
    output += chunk;
    log?.(String(chunk));
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const exited = new Promise((ok) => child.once("exit", (code) => ok(code)));

  const url = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`thixo dev did not start in 60s:\n${output}`)), 60_000);
    const check = () => {
      const match = /ready on (http:\/\/\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        ok(match[1]);
      }
    };
    child.stdout.on("data", check);
    exited.then((code) => {
      clearTimeout(timer);
      fail(new Error(`thixo dev exited with ${code}:\n${output}`));
    });
  });

  return {
    url,
    dir,
    pid: child.pid,
    output: () => output,
    async stop() {
      if (child.exitCode === null) child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

/** Writes what a launcher started, so a later `cleanup` can stop it. */
export function writeState(file, state) {
  writeFileSync(file, JSON.stringify(state, null, 2));
}

export function readState(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function removeCopy(dir) {
  if (dir && dir.includes("thixo-")) rmSync(dir, { recursive: true, force: true });
}
