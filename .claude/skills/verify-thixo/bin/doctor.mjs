#!/usr/bin/env node
// Is this run's instance worth driving? Read-only.
//   node .claude/skills/verify-thixo/bin/doctor.mjs [--run <id>]
// Exits 0 and prints "healthy" with the checks, or exits 1 naming the first check that failed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { alive, args, fail, readState, ROOT } from "./common.mjs";

const run = args().run ?? "default";
const state = readState(run);
if (!state?.pid) fail(`no instance for run "${run}". Start one with launch.mjs --run ${run}.`);

// The user each example's own login accepts (examples/todo: ana; examples/crm: rita, a sales rep).
const SIGN_IN_AS = { todo: "ana", crm: "rita" };
const user = SIGN_IN_AS[state.example];
if (!user) fail(`no sign-in user known for example "${state.example}" (run ${run}). Add it to SIGN_IN_AS in doctor.mjs.`);

const checks = [];
const check = (name, ok, detail) => {
  checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) {
    console.log(checks.join("\n"));
    fail(`${name} failed`);
  }
};

check("process", alive(state.pid), `pid ${state.pid}`);
const devFile = join(state.dir, ".thixo/dev.json");
const dev = existsSync(devFile) ? JSON.parse(readFileSync(devFile, "utf8")) : null;
check("port is ours", dev?.pid === state.pid && dev?.url === state.url, dev ? `${dev.url} pid ${dev.pid}` : "no .thixo/dev.json");
check("copy is disposable", !state.dir.startsWith(ROOT), state.dir);

const appInfo = await fetch(`${state.url}/_thixo/app`).then((r) => (r.ok ? r.json() : null), () => null);
check("app info", Boolean(appInfo?.slots?.length), appInfo ? `slots ${appInfo.slots.map((s) => s.name).join(", ")}` : "no answer");

const token = await fetch(`${state.url}/_thixo/token`, { method: "POST", headers: { cookie: `thixo-user=${user}` } }).then((r) => (r.ok ? r.json() : null), () => null);
check(`sign-in as ${user}`, token?.user?.id === user, token ? `scopes ${token.user.scopes.length}` : "token refused");

const layout = await fetch(`${state.url}/_thixo/layout`, { headers: { authorization: `Bearer ${token.token}` } }).then((r) => (r.ok ? r.json() : null), () => null);
const defaults = layout ? Object.entries(layout.defaults).map(([slot, ref]) => `${slot}=${ref.plugin}@${ref.number}`) : [];
check("default plugins deployed", defaults.length > 0, defaults.join(", "));

const page = await fetch(state.url).then((r) => (r.ok ? r.text() : ""), () => "");
check("shell page", page.includes('<div id="root">') && page.includes("/app.js"));
const csp = await fetch(state.url).then((r) => r.headers.get("content-security-policy") ?? "", () => "");
check("csp", csp.includes("script-src 'self'"), csp.split(";")[1]?.trim());

checks.push(`url  ${state.url}`, `copy ${state.dir}`, `log  ${state.log}`);
console.log(checks.join("\n"));
console.log("healthy");
