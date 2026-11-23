import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { buildAgentRequest, formatAgentResult, parseRef, resolveAgentTarget, type AgentOptions } from "../src/agent.js";
import { classifyChange } from "../src/changes.js";
import { clientEntry, indexHtml, serverEntry } from "../src/entries.js";
import { CliError, formatThxError } from "../src/errors.js";
import { contentSecurityPolicy } from "../src/handler.js";
import { layoutHint, newPlugin, pluginId, pluginTemplate } from "../src/new-plugin.js";
import { compileFolder, readPluginFolder, readPlugins, reportOutcome, summarizeManifest } from "../src/plugins.js";
import { findProjectRoot, openProject, projectPaths } from "../src/project.js";
import { logRefusals } from "../src/runtime.js";
import { FAKE_ERROR, fakeThx, testIo } from "./support/helpers.js";

// Every folder a test makes goes here, and is removed when the file's tests end.
const made: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "thixo-cli-"));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
const put = (root: string, path: string, text = "") => {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
};

test("in dev a refusal is a log line, and the implementor's own hook still runs", async () => {
  const lines: string[] = [];
  const heard: number[] = [];
  const guard = logRefusals({ limit: 3, onRefusal: (n) => void heard.push(n.count) }, (line) => lines.push(line));
  assert.equal(guard.limit, 3);
  const refusal = { id: "ref_1", user: "ana", conversation: null, category: "credentials" as const, reason: "It asks for\na password.", trigger: "x", from: "user" as const, source: "agent" as const, at: "2026-11-22T10:00:00.000Z" };
  await guard.onRefusal!({ refusal, count: 2, limit: 3, windowHours: 24, blocked: false });
  await guard.onRefusal!({ refusal, count: 3, limit: 3, windowHours: 24, blocked: true, block: { user: "ana", at: refusal.at, reason: "three", refusals: [] } });
  assert.deepEqual(lines, [
    "  authoring refused ana (credentials, agent, 2 of 3 in 24h): It asks for a password.",
    "  authoring refused ana (credentials, agent, 3 of 3 in 24h): It asks for a password.",
    "  authoring blocked ana from making plugins. Lift it with `thixo authoring unblock ana`.",
  ]);
  assert.deepEqual(heard, [2, 3]);
});

test("findProjectRoot walks up to thixo.config.ts", () => {
  const root = tmp();
  put(root, "thixo.config.ts", "export default {}");
  put(root, "plugins/a/plugin.thx", "x");
  assert.equal(findProjectRoot(join(root, "plugins/a")), root);
  assert.equal(findProjectRoot(join(root, "plugins/a/plugin.thx")), root);
  assert.equal(findProjectRoot(tmp()), null);
});

test("openProject names the project above when run in a subfolder, and fails outside one", () => {
  const root = tmp();
  put(root, "thixo.config.ts");
  put(root, "api/x.ts");
  assert.equal(openProject(root).configFile, join(root, "thixo.config.ts"));
  assert.throws(() => openProject(join(root, "api")), (e) => e instanceof CliError && e.message.includes(`The project is ${root}`));
  assert.throws(() => openProject(tmp()), /No thixo\.config\.ts/);
  assert.equal(projectPaths(root).serverBundle, join(root, ".thixo/build/server.mjs"));
});

test("plugin folders are read recursively, keyed by relative path, and nothing else is read", () => {
  const root = tmp();
  put(root, "plugins/a/plugin.thx", "A");
  put(root, "plugins/a/lib/dates.thx", "D");
  put(root, "plugins/a/readme.md", "no");
  put(root, "plugins/a/node_modules/x.thx", "no");
  put(root, "plugins/b/data.thx", "B");
  put(root, "plugins/.hidden/plugin.thx", "no");
  put(root, "plugins/notes.txt", "no");
  assert.deepEqual(readPluginFolder(join(root, "plugins/a")), { "lib/dates.thx": "D", "plugin.thx": "A" });
  assert.deepEqual(Object.keys(readPlugins(join(root, "plugins"))), ["a", "b"]);
  assert.deepEqual(readPlugins(join(root, "missing")), {});
});

test("errors print as file:line:col code message, with the hint under", () => {
  assert.equal(formatThxError(FAKE_ERROR, { cwd: "/app/plugins/a", dir: "/app/plugins/a" }), "plugin.thx:3:7 thx/no-global window does not exist.\n  hint: Plugins cannot reach the page.");
  assert.equal(formatThxError({ ...FAKE_ERROR, hint: undefined }, { cwd: "/app", dir: "/app/plugins/a" }), "plugins/a/plugin.thx:3:7 thx/no-global window does not exist.");
  assert.equal(formatThxError({ ...FAKE_ERROR, file: "lib/x.thx", hint: undefined }, { cwd: "/app/plugins", dir: "/app/plugins/a" }), "a/lib/x.thx:3:7 thx/no-global window does not exist.");
  // A folder outside where the command ran prints its full path, not ../../../var/...
  assert.equal(
    formatThxError({ ...FAKE_ERROR, hint: undefined }, { cwd: "/home/ana/repo", dir: "/var/folders/xy/app/plugins/notes" }),
    "/var/folders/xy/app/plugins/notes/plugin.thx:3:7 thx/no-global window does not exist.",
  );
});

test("a folder with no plugin.thx and a compiler that throws both become errors", () => {
  const env = {} as never;
  const missing = compileFolder({ "data.thx": "" }, env, fakeThx, "b");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors[0].code, "cli/missing-plugin-thx");
  const crash = compileFolder({ "plugin.thx": "" }, env, { compile: () => { throw new Error("boom"); } }, "c");
  assert.equal(crash.ok, false);
  if (!crash.ok) assert.match(crash.errors[0].message, /boom/);
});

test("reportOutcome prints a summary for a good plugin and located errors for a bad one", () => {
  const env = {} as never;
  const good = reportOutcome({ name: "a", dir: "/app/plugins/a", result: compileFolder({ "plugin.thx": 'import { hello } from "@app/sdk";\ndefinePlugin(main, { id: "plg_a" })' }, env, fakeThx) }, "/app");
  assert.match(good.join("\n"), /ok {2}a \(Fake\)/);
  assert.match(good.join("\n"), /Fills the slot main\./);
  assert.match(good.join("\n"), /Needs the endpoints hello\./);
  const bad = reportOutcome({ name: "a", dir: "/app/plugins/a", result: compileFolder({ "plugin.thx": "window" }, env, fakeThx) }, "/app");
  assert.match(bad.join("\n"), /FAILED {2}a/);
  assert.match(bad.join("\n"), /plugins\/a\/plugin\.thx:3:7 thx\/no-global/);
});

test("summarizeManifest says what data a plugin keeps", () => {
  const lines = summarizeManifest({
    slot: "todoDetail", requiredEndpoints: [], optionalEndpoints: ["listAssignees"], annotates: ["Todo"],
    data: { stores: { prefs: [{ name: "warn", type: "number" }] }, annotations: { Todo: [{ name: "dueOn", type: "date" }] } },
    schemaHash: "", shellServices: ["toast"], addresses: [], loads: [], links: [], assets: {}, libraries: [],
  });
  assert.deepEqual(lines, [
    "Fills the slot todoDetail.",
    "Can use listAssignees when the user is allowed.",
    "Adds its own fields to Todo.",
    "Keeps a private prefs store with warn (number).",
    "Annotates Todo with dueOn (date).",
    "Uses the shell services toast.",
  ]);
});

test("the server entry exports the config, the api modules and the slots module", () => {
  const entry = serverEntry({ configFile: "/p/thixo.config.ts", apiFiles: ["/p/api/a.ts", "/p/api/b.ts"], slotsFile: "/p/app/slots.ts" });
  assert.match(entry, /import config from "\/p\/thixo\.config\.ts";/);
  assert.match(entry, /import \* as api1 from "\/p\/api\/b\.ts";/);
  assert.match(entry, /export \{ config \};/);
  assert.match(entry, /export const api = \[api0, api1\];/);
  assert.match(entry, /export const modules = \[\.\.\.api, slotsModule\];/);
  assert.match(serverEntry({ configFile: "/c.ts", apiFiles: [], slotsFile: null }), /export const modules = api;/);
});

test("the client entry mounts the shell, and hands exposed libraries to mount", () => {
  assert.equal(clientEntry({ shellFile: "/p/app/shell.tsx", libraries: [] }), 'import App from "/p/app/shell.tsx";\nimport { mount } from "thixo/shell";\nmount(App);\n');
  const withLib = clientEntry({ shellFile: "/p/app/shell.tsx", libraries: [{ specifier: "@app/charts", module: "/p/lib/charts.ts" }] });
  assert.match(withLib, /import \* as lib0 from "\/p\/lib\/charts\.ts";/);
  assert.match(withLib, /mount\(App, \{ libraries: \{ "@app\/charts": lib0 \} \}\);/);
});

test("index.html has the root and the bundle, and no inline script", () => {
  const html = indexHtml({ title: "A <b>", script: "/app.js", css: "/app.css" });
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(html, /href="\/app\.css"/);
  assert.match(html, /<title>A &lt;b&gt;<\/title>/);
  assert.doesNotMatch(html.replace(/<script type="module" src="\/app\.js"><\/script>/, ""), /<script/);
});

test("the CSP carries the required directives; images from any https host, since a handed-in Url may load anywhere", () => {
  const csp = contentSecurityPolicy();
  for (const part of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "img-src 'self' data: https:", "font-src 'self' data:", "style-src 'self' 'unsafe-inline'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"]) {
    assert.ok(csp.split("; ").includes(part), part);
  }
});

test("changes in plugins/ redeploy, api/ and the config rebuild the server, app/ the client", () => {
  const paths = projectPaths("/p");
  assert.deepEqual(classifyChange(paths, "/p/plugins/a/plugin.thx"), { server: false, client: false, plugins: true });
  assert.deepEqual(classifyChange(paths, "/p/api/todos.ts"), { server: true, client: false, plugins: true });
  assert.deepEqual(classifyChange(paths, "/p/thixo.config.ts"), { server: true, client: false, plugins: true });
  assert.deepEqual(classifyChange(paths, "/p/app/shell.tsx"), { server: false, client: true, plugins: false });
  assert.deepEqual(classifyChange(paths, "/p/app/slots.ts"), { server: true, client: true, plugins: true });
  for (const ignored of ["/p/.thixo/build/server.mjs", "/p/node_modules/x/y.js", "/p/plugins/a/.plugin.thx.swp", "/p/package.json", "/elsewhere/api/x.ts", "/p/api/x.ts~"]) {
    assert.deepEqual(classifyChange(paths, ignored), { server: false, client: false, plugins: false }, ignored);
  }
});

test("new plugin writes plugins/<name>/plugin.thx with a fresh id and refuses a taken name", () => {
  const root = tmp();
  put(root, "thixo.config.ts");
  put(root, "app/slots.ts", 'export const main = 1;\nexport const todoDetail = slot.panel({ name: "todo-detail" });');
  const io = testIo(root);
  newPlugin({ name: "due-dates", slot: "main", dir: root }, io);
  const text = readPluginFolder(join(root, "plugins/due-dates"))["plugin.thx"];
  assert.match(text, /id: "plg_[0-9a-f]{18}"/, "the same form create-thixo-app gives");
  assert.match(io.stdout.join("\n"), /"<the slot's path>": "due-dates"/, "without the app loaded, it says what goes there");
  assert.match(text, /import \{ main \} from "@app\/slots";/);
  assert.match(text, /function DueDates\(\)/);
  assert.deepEqual(io.stderr, []);
  assert.throws(() => newPlugin({ name: "due-dates", slot: "main", dir: root }, io), /already exists/);
  assert.throws(() => newPlugin({ name: "Due Dates", slot: "main", dir: root }, io), /kebab-case/);
  assert.throws(() => newPlugin({ name: "x", slot: "not a slot", dir: root }, io), /There is no slot "not a slot" in app\/slots.ts/);
  // An unknown slot is refused, with the slots there are, and nothing is written.
  assert.throws(() => newPlugin({ name: "y", slot: "ghost", dir: root }, io), /There is no slot "ghost" in app\/slots\.ts\. .* The slots are: todo-detail \(todoDetail\)\./);
  assert.equal(existsSync(join(root, "plugins/y")), false);
  newPlugin({ name: "z", slot: "todo-detail", dir: root }, io);
  assert.match(readPluginFolder(join(root, "plugins/z"))["plugin.thx"], /import \{ todoDetail \} from "@app\/slots";/);
  assert.notEqual(pluginId(), pluginId());
  assert.match(pluginTemplate({ name: "a", slot: "s", id: "plg_1" }), /definePlugin\(\n {2}s,/);
});

test("new plugin refuses a slot the loaded app lacks, and --personal writes outside plugins/ with no id", () => {
  const root = tmp();
  put(root, "thixo.config.ts");
  const app = {
    slots: [
      { name: "main", exportName: "main", children: ["todo-row"] },
      { name: "todo-row", exportName: "todoRow", children: [] },
    ],
    paths: ["main", "main/todo-row"],
  };
  const io = testIo(root);
  assert.throws(() => newPlugin({ name: "x", slot: "nope", dir: root }, io, app), /There is no slot "nope".* The slots are: main \(main\), todo-row \(todoRow\)\./);

  newPlugin({ name: "stars", slot: "todo-row", dir: root }, io, app);
  assert.match(io.stdout.join("\n"), /"main\/todo-row": "stars"/);
  assert.match(io.stdout.join("\n"), /The id in its definePlugin is for a default plugin's folder in plugins\//);

  const mine = testIo(root);
  newPlugin({ name: "stars", slot: "todoRow", dir: root, personal: join(root, "mine/stars") }, mine, app);
  const text = readPluginFolder(join(root, "mine/stars"))["plugin.thx"];
  assert.doesNotMatch(text, /id:/, "a personal plugin has no id");
  assert.match(text, /import \{ todoRow \} from "@app\/slots";/);
  const said = mine.stdout.join("\n");
  assert.match(said, /^Created mine\/stars\/plugin\.thx/);
  assert.match(said, /thixo agent submit --as <user> --dir mine\/stars/);
  assert.match(said, /--slot main\/todo-row/);
  assert.doesNotMatch(said, /Add it to the layout/);
  assert.throws(() => newPlugin({ name: "a", slot: "main", dir: root, personal: join(root, "plugins/a") }, mine, app), /outside plugins\//);
  assert.throws(() => newPlugin({ name: "a", slot: "main", dir: root, personal: join(root, "mine/stars") }, mine, app), /is not empty/);
});

test("new plugin prints the layout line with the slot's real path when the app loads", () => {
  const app = {
    slots: [
      { name: "main", exportName: "main", children: ["todo-row"] },
      { name: "todo-row", exportName: "todoRow", children: [] },
      { name: "loose", exportName: "loose", children: [] },
    ],
    paths: ["main", "main/todo-row", "loose"],
  };
  assert.equal(layoutHint("stars", "todoRow", app), 'Add it to the layout in thixo.config.ts to make it a default: "main/todo-row": "stars"');
  assert.equal(layoutHint("home", "main", app), 'Add it to the layout in thixo.config.ts to make it a default: "main": "home"');
  assert.match(layoutHint("x", "ghost", app), /"<the slot's path>": "x"/);
  assert.match(layoutHint("x", "loose", { ...app, paths: ["main", "main/todo-row"] }), /not placed in any other slot/);
});

const agent = (over: Partial<AgentOptions>): AgentOptions => ({ command: "describe", as: "ana", files: [], positionals: [], raw: false, ...over });

test("agent requests: body is { tool, as, input }, with the shortcut mapped to its tool", () => {
  const dir = tmp();
  put(dir, "p/plugin.thx", "P");
  put(dir, "p/lib/a.thx", "A");
  put(dir, "extra.thx", "E");
  assert.deepEqual(buildAgentRequest(agent({}), dir), { tool: "describe_app", as: "ana", input: {} });
  assert.deepEqual(buildAgentRequest(agent({ command: "search", positionals: ["due", "dates"] }), dir), { tool: "search_registry", as: "ana", input: { query: "due dates" } });
  assert.deepEqual(buildAgentRequest(agent({ command: "read", positionals: ["plg_a"] }), dir).input, { plugin: "plg_a" });
  assert.deepEqual(buildAgentRequest(agent({ command: "read", positionals: ["plg_a@3"] }), dir).input, { plugin: "plg_a", version: 3 });
  assert.deepEqual(buildAgentRequest(agent({ command: "fork", positionals: ["plg_a@2"] }), dir).input, { plugin: "plg_a", version: 2 });
  assert.deepEqual(buildAgentRequest(agent({ command: "use", positionals: ["plg_a@2"], slot: "main" }), dir).input, { plugin: "plg_a", version: 2, slot: "main" });
  const submit = buildAgentRequest(agent({ command: "submit", dir: "p", files: ["more.thx=@extra.thx"], plugin: "plg_a" }), dir);
  assert.equal(submit.tool, "submit");
  assert.deepEqual(submit.input, { files: { "lib/a.thx": "A", "plugin.thx": "P", "more.thx": "E" }, plugin: "plg_a" });
  assert.deepEqual(buildAgentRequest(agent({ command: "custom_tool", json: '{"x":1}' }), dir), { tool: "custom_tool", as: "ana", input: { x: 1 } });
  // A tool's own name takes the shortcut's arguments, so `agent read_plugin plg_a@3` works as `agent read` does.
  assert.deepEqual(buildAgentRequest(agent({ command: "read_plugin", positionals: ["plg_a@3"] }), dir), { tool: "read_plugin", as: "ana", input: { plugin: "plg_a", version: 3 } });
  assert.deepEqual(buildAgentRequest(agent({ command: "search_registry", positionals: ["due"] }), dir).input, { query: "due" });
});

test("agent requests: bad input says what is wrong", () => {
  const dir = tmp();
  assert.throws(() => buildAgentRequest(agent({ command: "submit" }), dir), /needs the plugin's files/);
  assert.throws(() => buildAgentRequest(agent({ command: "fork", positionals: ["plg_a"] }), dir), /needs a version/);
  assert.throws(() => buildAgentRequest(agent({ command: "use", positionals: ["plg_a@1"] }), dir), /needs --slot/);
  assert.throws(() => buildAgentRequest(agent({ command: "x", json: "[1]" }), dir), /--json is not a JSON object/);
  assert.throws(() => buildAgentRequest(agent({ command: "x", files: ["a=b"] }), dir), /path=@local-file/);
  assert.throws(() => buildAgentRequest(agent({ command: "x", files: ["a=@nope"] }), dir), /Cannot read/);
  assert.throws(() => parseRef("plg@x"), /not <pluginId>@<version>/);
});

test("the agent target is the dev server in .thixo/dev.json, or --port, and needs a key", () => {
  const root = tmp();
  put(root, "thixo.config.ts");
  assert.throws(() => resolveAgentTarget({}, root), /No agent key/);
  put(root, ".thixo/agent-key", "secret\n");
  assert.deepEqual(resolveAgentTarget({}, root), { url: "http://127.0.0.1:3000", key: "secret" });
  put(root, ".thixo/dev.json", '{"url":"http://127.0.0.1:4555"}');
  assert.equal(resolveAgentTarget({}, root).url, "http://127.0.0.1:4555");
  assert.equal(resolveAgentTarget({ port: 9 }, root).url, "http://127.0.0.1:9");
  assert.throws(() => resolveAgentTarget({}, tmp()), /No project found/);
});

test("agent results: errors as file:line:col, summaries as bullets, the rest as JSON", () => {
  assert.equal(formatAgentResult("plain"), "plain");
  assert.equal(formatAgentResult({ errors: [{ file: "plugin.thx", line: 2, column: 5, code: "thx/x", message: "bad", hint: "do y" }] }), "plugin.thx:2:5 thx/x bad\n  hint: do y");
  assert.equal(formatAgentResult({ summary: ["Reads todos."], version: 2 }), '- Reads todos.\n{\n  "version": 2\n}');
  assert.equal(formatAgentResult({ a: 1 }), '{\n  "a": 1\n}');
});
