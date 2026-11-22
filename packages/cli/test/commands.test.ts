import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { run } from "../src/main.js";
import { startDev } from "../src/dev.js";
import { startServer } from "../src/start.js";
import { readBuildManifest } from "../src/build.js";
import { fakeDeps, testIo, workdir } from "./support/helpers.js";

async function token(url: string, headers: Record<string, string> = {}) {
  return fetch(`${url}/_thixo/app`, { headers });
}

test("thixo build writes the server bundle, the client with index.html, and manifest.json", async () => {
  const w = workdir();
  try {
    const io = testIo(w.root);
    const code = await run(["build", w.root], { io, deps: fakeDeps() });
    assert.equal(code, 0, io.stderr.join("\n"));
    const server = readFileSync(w.paths.serverBundle, "utf8");
    assert.match(server, /export \{[\s\S]*config[\s\S]*\}/);
    assert.match(server, /from "thixo\/api"/, "packages stay external");
    assert.doesNotMatch(server, /function endpoint\(/);
    const index = readFileSync(join(w.paths.clientDir, "index.html"), "utf8");
    assert.match(index, /<div id="root">/);
    assert.ok(statSync(join(w.paths.clientDir, "app.js")).size > 0);
    assert.ok(existsSync(join(w.paths.clientDir, "app.js.map")));
    const manifest = readBuildManifest(w.paths);
    assert.equal(manifest.ok, true);
    assert.equal(manifest.mode, "production");
    assert.deepEqual(manifest.endpoints, ["hello"]);
    assert.deepEqual(manifest.slots, ["main"]);
    assert.equal(manifest.plugins.hello.ok, true);
    assert.equal(manifest.plugins.hello.id, "plg_hello");
    assert.match(io.stdout.join("\n"), /ok {2}hello \(Fake\)/);
    assert.match(io.stdout.join("\n"), /Needs the endpoints hello\./);
  } finally {
    w.cleanup();
  }
});

test("thixo build exits 1 and prints file:line:col when a plugin fails", async () => {
  const w = workdir();
  try {
    writeFileSync(join(w.root, "plugins/hello/plugin.thx"), "const x = window;");
    const io = testIo(w.root);
    const code = await run(["build", w.root], { io, deps: fakeDeps() });
    assert.equal(code, 1);
    assert.match(io.stderr.join("\n"), /1 plugin failed to compile \(hello\)/);
    assert.match(io.stdout.join("\n"), /plugins\/hello\/plugin\.thx:3:7 thx\/no-global window does not exist\./);
    assert.match(io.stdout.join("\n"), /hint: Plugins cannot reach the page\./);
    assert.equal(readBuildManifest(w.paths).ok, false);
    const start = await run(["start", w.root], { io: testIo(w.root), deps: fakeDeps() });
    assert.equal(start, 1, "start refuses a failed build");
  } finally {
    w.cleanup();
  }
});

test("thixo build reports a syntax error in api/ with its location", async () => {
  const w = workdir();
  try {
    writeFileSync(join(w.root, "api/hello.ts"), "export const hello = {;\n");
    const io = testIo(w.root);
    assert.equal(await run(["build", w.root], { io, deps: fakeDeps() }), 1);
    assert.match(io.stderr.join("\n"), /server bundle did not build[\s\S]*api\/hello\.ts:1:\d+/);
  } finally {
    w.cleanup();
  }
});

test("start needs a build, then serves api, static files, and index.html with a CSP for client routes", async () => {
  const w = workdir();
  try {
    assert.equal(await run(["start", w.root], { io: testIo(w.root), deps: fakeDeps() }), 1);
    assert.equal(await run(["build", w.root], { io: testIo(w.root), deps: fakeDeps() }), 0);

    const deps = fakeDeps();
    const io = testIo(w.root);
    const started = await startServer(w.paths, { port: 0 }, io, deps);
    assert.ok(existsSync(w.paths.signingKeyFile));
    assert.equal(statSync(w.paths.signingKeyFile).mode & 0o777, 0o600);
    assert.equal(deps.deploys.length, 1);
    assert.deepEqual(deps.deploys[0].plugins, ["hello"]);
    assert.deepEqual(deps.deploys[0].layout, { main: "hello" });
    assert.match(deps.deploys[0].deployment, /^[0-9a-f]{12}$|^[0-9a-f]{40}$/, "a build hash, or the git sha when the work copy is in a repo");
    try {
      const app = await (await fetch(`${started.url}/_thixo/app`)).json();
      assert.equal(app.endpoints[0].name, "hello");
      const unauthorised = await fetch(`${started.url}/api/hello`);
      assert.equal(unauthorised.status, 401);

      const js = await fetch(`${started.url}/app.js`);
      assert.equal(js.status, 200);
      assert.match(js.headers.get("content-type")!, /javascript/);
      const route = await fetch(`${started.url}/some/client/route`);
      assert.equal(route.status, 200);
      assert.match(await route.text(), /<div id="root">/);
      const csp = route.headers.get("content-security-policy")!;
      assert.match(csp, /default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: https:\/\/cdn\.example\.com/);
      assert.equal((await fetch(`${started.url}/missing.png`)).status, 404);
      assert.equal((await fetch(`${started.url}/..%2f..%2fpackage.json`)).status === 200, false);
      assert.equal((await fetch(`${started.url}/_thixo/authoring/tool`, { method: "POST" })).status, 404, "no agent key, no route");
    } finally {
      await started.close();
    }
  } finally {
    w.cleanup();
  }
});

test("dev serves, writes the agent key and dev.json, swaps the server on api/ changes, and redeploys plugins", async () => {
  const w = workdir();
  const deps = fakeDeps();
  const io = testIo(w.root);
  const dev = await startDev(w.paths, { port: 0, watch: false }, io, deps);
  try {
    assert.equal(statSync(w.paths.agentKeyFile).mode & 0o777, 0o600);
    assert.match(readFileSync(w.paths.agentKeyFile, "utf8").trim(), /^[0-9a-f]{64}$/);
    assert.equal(JSON.parse(readFileSync(w.paths.devFile, "utf8")).url, dev.url);
    assert.equal(process.env.THIXO_PROJECT_DIR, w.root);
    assert.equal(deps.deploys.length, 1);
    assert.equal((await token(dev.url)).status, 200);
    assert.match(await (await fetch(`${dev.url}/`)).text(), /<div id="root">/);
    const indexHeaders = (await fetch(`${dev.url}/`)).headers;
    assert.match(indexHeaders.get("content-security-policy")!, /frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'/);

    writeFileSync(join(w.root, "plugins/hello/plugin.thx"), 'const x = window;');
    dev.changed(join(w.root, "plugins/hello/plugin.thx"));
    await dev.idle();
    assert.match(io.stderr.join("\n"), /plugins\/hello\/plugin\.thx:3:7 thx\/no-global/, "a compile error is printed, not thrown");
    assert.equal((await token(dev.url)).status, 200, "and the server keeps running");

    writeFileSync(join(w.root, "plugins/hello/plugin.thx"), readFileSync(join(w.root, "plugins/hello/plugin.thx"), "utf8").replace("window", "1"));
    writeFileSync(join(w.root, "plugins/hello/plugin.thx"), 'import { definePlugin } from "thixo/plugin";\nexport default definePlugin(main, { id: "plg_hello", name: "Hello 2", description: "x" }, function A() { return null; });');
    const before = deps.deploys.length;
    dev.changed(join(w.root, "plugins/hello/plugin.thx"));
    await dev.idle();
    assert.equal(deps.deploys.length, before + 1, "redeployed without a restart");

    writeFileSync(join(w.root, "api/hello.ts"), readFileSync(join(w.root, "api/hello.ts"), "utf8").replace("hello", "goodbye"));
    dev.changed(join(w.root, "api/hello.ts"));
    await dev.idle();
    const app = await (await fetch(`${dev.url}/_thixo/app`)).json();
    assert.equal(app.endpoints[0].name, "goodbye", "the new server bundle is answering");

    writeFileSync(join(w.root, "api/hello.ts"), "export const hello = {;");
    dev.changed(join(w.root, "api/hello.ts"));
    await dev.idle();
    assert.match(io.stderr.join("\n"), /Server did not build \(still running the last good one\)/);
    assert.equal((await token(dev.url)).status, 200);

    writeFileSync(join(w.root, "app/shell.tsx"), readFileSync(join(w.root, "app/shell.tsx"), "utf8").replace("<Slot is={main} />", "<p>rebuilt-marker</p>"));
    dev.changed(join(w.root, "app/shell.tsx"));
    await dev.idle();
    assert.match(readFileSync(join(w.paths.clientDir, "app.js"), "utf8"), /rebuilt-marker/);
  } finally {
    await dev.close();
    w.cleanup();
  }
  assert.equal(existsSync(w.paths.devFile), false);
});

test("dev passes the agent key to createThixo through config.agentKey, and start does not", async () => {
  const w = workdir();
  const seen: (string | undefined)[] = [];
  const base = fakeDeps();
  const deps = {
    ...base,
    server: async () => {
      const real = await base.server();
      return { ...real, createThixo: (app: never, config: { agentKey?: string }) => (seen.push(config.agentKey), real.createThixo(app, config as never)) };
    },
  };
  try {
    const dev = await startDev(w.paths, { port: 0, watch: false }, testIo(w.root), deps);
    await dev.close();
    assert.match(seen[0] ?? "", /^[0-9a-f]{64}$/);
    assert.equal(seen[0], readFileSync(w.paths.agentKeyFile, "utf8").trim());
    await run(["build", w.root], { io: testIo(w.root), deps });
    const started = await startServer(w.paths, { port: 0 }, testIo(w.root), deps);
    await started.close();
    assert.equal(seen.at(-1), undefined);
  } finally {
    w.cleanup();
  }
});

test("compile: inside a project it uses the real env and prints manifest, summary and size", async () => {
  const w = workdir();
  try {
    const io = testIo(w.root);
    assert.equal(await run(["compile", join(w.root, "plugins/hello")], { io, deps: fakeDeps() }), 0, io.stderr.join("\n"));
    const text = io.stdout.join("\n");
    assert.match(text, /Compiled hello \(Fake\)/);
    assert.match(text, /Summary\n {2}Fills the slot main\./);
    assert.match(text, /"slot": "main"/);
    assert.match(text, /Output {2}\d+ bytes/);

    const json = testIo(w.root);
    const out = join(w.root, "out");
    assert.equal(await run(["compile", "plugins/hello", "--json", "--out", out], { io: json, deps: fakeDeps() }), 0);
    const parsed = JSON.parse(json.stdout.join("\n"));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.manifest.slot, "main");
    assert.ok(parsed.size > 0);
    assert.ok(readFileSync(join(out, "plugin.js"), "utf8").startsWith("export default"));
    assert.equal(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).slot, "main");

    writeFileSync(join(w.root, "bad.thx"), "window");
    const bad = testIo(w.root);
    assert.equal(await run(["compile", "bad.thx"], { io: bad, deps: fakeDeps() }), 1);
    assert.match(bad.stderr.join("\n"), /^plugin\.thx:3:7 thx\/no-global window does not exist\.\n {2}hint: /);
    const badJson = testIo(w.root);
    assert.equal(await run(["compile", "bad.thx", "--json"], { io: badJson, deps: fakeDeps() }), 1);
    assert.equal(JSON.parse(badJson.stdout.join("\n")).errors[0].code, "thx/no-global");
  } finally {
    w.cleanup();
  }
});

test("compile outside a project says a project is needed for @app/sdk", async () => {
  const dir = join(process.env.TMPDIR ?? "/tmp", `thixo-cli-noproject-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "p.thx"), "x");
  const io = testIo(dir);
  assert.equal(await run(["compile", "p.thx"], { io, deps: fakeDeps() }), 1);
  assert.match(io.stderr.join("\n"), /No project found[\s\S]*@app\/sdk and @app\/slots/);
});

test("new plugin, then compile it", async () => {
  const w = workdir();
  try {
    const io = testIo(w.root);
    assert.equal(await run(["new", "plugin", "greeter", "--slot", "main", w.root], { io, deps: fakeDeps() }), 0);
    assert.ok(existsSync(join(w.root, "plugins/greeter/plugin.thx")));
    assert.equal(await run(["compile", "plugins/greeter"], { io: testIo(w.root), deps: fakeDeps() }), 0);
  } finally {
    w.cleanup();
  }
});

test("agent: posts { tool, as, input } with the key and prints the result", async () => {
  const w = workdir();
  try {
    mkdirSync(join(w.root, ".thixo"), { recursive: true });
    writeFileSync(join(w.root, ".thixo/agent-key"), "k3y\n");
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ summary: ["Reads hello."], version: 1 }), { headers: { "content-type": "application/json" } });
    };
    const io = testIo(w.root);
    assert.equal(await run(["agent", "check", "--as", "ana", "--dir", "plugins/hello", "--port", "3999"], { io, deps: fakeDeps(), fetch: fetchImpl }), 0);
    assert.equal(calls[0].url, "http://127.0.0.1:3999/_thixo/authoring/tool");
    assert.equal((calls[0].init.headers as Record<string, string>)["x-thixo-agent-key"], "k3y");
    const body = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(Object.keys(body), ["tool", "as", "input"]);
    assert.equal(body.tool, "check");
    assert.equal(body.as, "ana");
    assert.match(body.input.files["plugin.thx"], /definePlugin/);
    assert.match(io.stdout.join("\n"), /- Reads hello\./);

    const raw = testIo(w.root);
    await run(["agent", "describe", "--as", "ana", "--raw", "--port", "3999"], { io: raw, deps: fakeDeps(), fetch: fetchImpl });
    assert.equal(JSON.parse(raw.stdout.join("\n")).version, 1);
    assert.equal(JSON.parse(calls[1].init.body as string).tool, "describe_app");

    const denied = testIo(w.root);
    const code = await run(["agent", "search", "--as", "ana", "due"], {
      io: denied,
      deps: fakeDeps(),
      fetch: async () => new Response(JSON.stringify({ error: { code: "invalid_agent_key", message: "Wrong key" } }), { status: 401 }),
    });
    assert.equal(code, 1);
    assert.match(denied.stderr.join("\n"), /search_registry failed \(401 invalid_agent_key\): Wrong key\. The agent key may be stale/);

    const down = testIo(w.root);
    assert.equal(await run(["agent", "describe", "--as", "ana"], { io: down, deps: fakeDeps(), fetch: async () => { throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }); } }), 1);
    assert.match(down.stderr.join("\n"), /Could not reach the dev server[\s\S]*thixo dev/);
  } finally {
    w.cleanup();
  }
});

test("registry list and release read the local registry through the adapters", async () => {
  const w = workdir();
  try {
    const list = testIo(w.root);
    assert.equal(await run(["registry", "list", w.root], { io: list, deps: fakeDeps() }), 0, list.stderr.join("\n"));
    assert.match(list.stdout.join("\n"), /registry is empty/);
    const release = testIo(w.root);
    assert.equal(await run(["release", w.root, "--json"], { io: release, deps: fakeDeps() }), 0);
    assert.equal(release.stdout.join("\n"), "null");
  } finally {
    w.cleanup();
  }
});

test("help, version and unknown commands", async () => {
  const io = testIo(process.cwd());
  assert.equal(await run(["--help"], { io }), 0);
  assert.match(io.stdout.join("\n"), /dev \[dir\]/);
  assert.equal(await run(["--version"], { io }), 0);
  assert.equal(await run(["nope"], { io }), 1);
  assert.match(io.stderr.join("\n"), /thixo: Unknown command "nope"/);
  const missing = testIo(process.cwd());
  assert.equal(await run(["build", "/definitely/not/here"], { io: missing }), 1);
  assert.match(missing.stderr.join("\n"), /is not a folder/);
});
