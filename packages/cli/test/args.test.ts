import assert from "node:assert/strict";
import test from "node:test";
import { helpText, parseCommand } from "../src/args.js";
import { CliError } from "../src/errors.js";

const fail = (argv: string[], pattern: RegExp) => assert.throws(() => parseCommand(argv, {}), (e) => e instanceof CliError && pattern.test(e.message));

test("no arguments and --help show the help", () => {
  assert.deepEqual(parseCommand([], {}), { name: "help", topic: undefined });
  assert.deepEqual(parseCommand(["--help"], {}), { name: "help", topic: undefined });
  assert.deepEqual(parseCommand(["dev", "--help"], {}), { name: "help", topic: "dev" });
  assert.deepEqual(parseCommand(["new", "plugin", "--help"], {}), { name: "help", topic: "new-plugin" });
  assert.match(helpText("agent"), /--as <user>/);
});

test("dir defaults to the current folder and the port to 3000, $PORT or --port", () => {
  assert.deepEqual(parseCommand(["dev"], {}), { name: "dev", dir: ".", port: 3000 });
  assert.deepEqual(parseCommand(["dev", "app", "--port", "4000"], {}), { name: "dev", dir: "app", port: 4000 });
  assert.deepEqual(parseCommand(["start"], { PORT: "8080" }), { name: "start", dir: ".", port: 8080 });
  assert.deepEqual(parseCommand(["start", "--port", "0"], {}), { name: "start", dir: ".", port: 0 });
  fail(["dev", "--port", "abc"], /not a port/);
  fail(["dev", "--port", "70000"], /not a port/);
  fail(["dev", "a", "b"], /takes one folder/);
});

test("build takes --no-minify", () => {
  assert.deepEqual(parseCommand(["build"], {}), { name: "build", dir: ".", minify: true });
  assert.deepEqual(parseCommand(["build", "x", "--no-minify"], {}), { name: "build", dir: "x", minify: false });
});

test("unknown commands and options say what to do", () => {
  fail(["frobnicate"], /Unknown command "frobnicate"/);
  fail(["build", "--nope"], /Unknown option '--nope'[\s\S]*thixo build --help/);
});

test("compile", () => {
  assert.deepEqual(parseCommand(["compile", "plugins/a", "--out", "o", "--json", "--project", "p"], {}), { name: "compile", target: "plugins/a", out: "o", json: true, project: "p" });
  fail(["compile"], /one folder or \.thx file/);
});

test("new plugin needs a name and --slot", () => {
  assert.deepEqual(parseCommand(["new", "plugin", "due-dates", "--slot", "main"], {}), { name: "new-plugin", pluginName: "due-dates", slot: "main", dir: "." });
  assert.deepEqual(parseCommand(["new", "plugin", "x", "app", "--slot", "main"], {}), { name: "new-plugin", pluginName: "x", slot: "main", dir: "app" });
  fail(["new", "plugin", "--slot", "main"], /needs a name/);
  fail(["new", "plugin", "x"], /needs --slot/);
  fail(["new", "page"], /thixo new plugin/);
});

test("agent: tool, --as, repeated --file, --json is the input", () => {
  const command = parseCommand(["agent", "submit", "--as", "ana", "--dir", "./p", "--file", "a.thx=@x", "--file", "b.thx=@y", "--json", '{"plugin":"plg_1"}', "--port", "3100"], {});
  assert.equal(command.name, "agent");
  if (command.name !== "agent") return;
  assert.deepEqual(command.options, {
    command: "submit",
    as: "ana",
    json: '{"plugin":"plg_1"}',
    files: ["a.thx=@x", "b.thx=@y"],
    dir: "./p",
    plugin: undefined,
    slot: undefined,
    positionals: [],
    port: 3100,
    project: undefined,
    raw: false,
  });
  fail(["agent", "--as", "ana"], /needs a tool/);
  fail(["agent", "search"], /needs --as/);
});

test("registry and release", () => {
  assert.deepEqual(parseCommand(["registry", "list", "--json"], {}), { name: "registry-list", dir: ".", json: true });
  assert.deepEqual(parseCommand(["release", "x"], {}), { name: "release", dir: "x", json: false });
  fail(["registry", "show"], /registry list/);
});
