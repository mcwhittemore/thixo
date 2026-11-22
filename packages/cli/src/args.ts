import { parseArgs, type ParseArgsConfig } from "node:util";
import type { AgentOptions } from "./agent.js";
import { CliError } from "./errors.js";

export type Command =
  | { name: "help"; topic?: string }
  | { name: "version" }
  | { name: "build"; dir: string; minify: boolean }
  | { name: "start"; dir: string; port: number }
  | { name: "dev"; dir: string; port: number }
  | { name: "compile"; target: string; out?: string; json: boolean; project?: string }
  | { name: "new-plugin"; pluginName: string; slot: string; dir: string }
  | { name: "agent"; options: AgentOptions }
  | { name: "registry-list"; dir: string; json: boolean }
  | { name: "release"; dir: string; json: boolean };

const HELP: Record<string, string> = {
  main: `thixo: build and run a Thixo app from its folders.

Usage
  thixo <command> [options]

Commands
  dev [dir]        Build, deploy, serve and rebuild on change (default port 3000)
  build [dir]      Build into .thixo/build/ and fail on any plugin error
  start [dir]      Serve what \`thixo build\` made
  compile <path>   Compile a plugin folder or .thx file and print its manifest
  new plugin       Start a plugin in plugins/<name>
  agent <tool>     Call an authoring tool on the running dev server
  registry list    List the plugins in the local registry
  release          Show the current release and its layout

Every command that takes [dir] uses the current folder when it is left out.
Run \`thixo <command> --help\` for a command's options.`,
  dev: `thixo dev [dir] [--port 3000]

Builds the app, deploys plugins/ and serves it. Watches api/, app/, plugins/ and thixo.config.ts:
  plugins/                  recompile and redeploy, no restart
  api/ or thixo.config.ts   rebuild the server bundle and swap the handler
  app/                      rebuild the browser bundle (reload the page)
Compile errors are printed and the server keeps running. Writes .thixo/agent-key, which turns on the
/_thixo/authoring/tool route for \`thixo agent\`.

Options
  --port <n>   Port to listen on (default: $PORT or 3000; 0 picks a free one)`,
  build: `thixo build [dir] [--no-minify]

Writes .thixo/build/: server.mjs, client/ (with index.html), manifest.json. Compiles every folder in plugins/ and
exits 1 if any fails.

Options
  --no-minify   Leave the browser bundle readable`,
  start: `thixo start [dir] [--port 3000]

Serves the build in .thixo/build/: /_thixo/* and /api/* to Thixo, files from the client build, and index.html
for every other GET. Deploys plugins/ first. Run \`thixo build\` before it.

Options
  --port <n>   Port to listen on (default: $PORT or 3000)`,
  compile: `thixo compile <folder-or-file> [--out dir] [--json] [--project dir]

Compiles thx against the app's real compile environment. The project is the folder with thixo.config.ts at or
above the path, or --project. A single file is taken as plugin.thx.

Options
  --out <dir>        Write plugin.js and manifest.json there
  --json             Print one machine-readable result
  --project <dir>    The app to compile against`,
  "new-plugin": `thixo new plugin <name> --slot <slot> [dir]

Creates plugins/<name>/plugin.thx with a fresh id and a minimal component. <name> is kebab-case. The slot is its
name, such as todo-detail, or its export name in app/slots.ts, such as todoDetail.`,
  agent: `thixo agent <tool> --as <user> [options]

Calls one authoring tool on the running \`thixo dev\` as <user>. Sends POST /_thixo/authoring/tool with
{ tool, as, input } and the key in .thixo/agent-key.

Shortcuts
  submit --as ana --dir ./my-plugin [--plugin <id>]   build and store a version
  check  --as ana --dir ./my-plugin                   build without storing
  search --as ana "due" [--slot <slot>]               search the registry
  read   --as ana <pluginId>[@<n>]                    read a plugin's source
  fork   --as ana <pluginId>@<n>                      fork a version
  use    --as ana <pluginId>@<n> --slot main          put a version in the user's layout
  describe --as ana                                   the SDK, slots and language reference
Any other <tool> is sent by name with --json.

Options
  --as <user>          The acting user id (required)
  --json '<input>'     The tool's input, as a JSON object
  --file path=@local   Add a file to input.files (repeatable)
  --dir <folder>       Add every .thx file in a folder to input.files
  --plugin <id>        The plugin a submit is a new version of
  --slot <slot>        A slot, for use and search
  --port <n>           The dev server's port (default: the one in .thixo/dev.json, else 3000)
  --project <dir>      The app whose .thixo/agent-key to use (default: found from here)
  --raw                Print the response as JSON`,
  registry: `thixo registry list [dir] [--json]

Prints the plugins in the local registry with their versions, visibility and author.`,
  release: `thixo release [dir] [--json]

Prints the current release: its id, its deployment and which plugin version fills each slot.`,
};

export function helpText(topic?: string): string {
  return HELP[topic ?? "main"] ?? HELP.main;
}

function parse<const T extends ParseArgsConfig["options"]>(command: string, args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    const message = (error as Error).message.replace(/\. To specify a positional argument starting with a '-'.*$/, ".");
    throw new CliError(`${message}\nRun \`thixo ${command} --help\` for the options.`);
  }
}

function parsePort(text: string | undefined, env: NodeJS.ProcessEnv): number {
  const value = text ?? env.PORT ?? "3000";
  const port = Number(value);
  if (!/^\d+$/.test(value) || port > 65535) throw new CliError(`"${value}" is not a port. Use a number from 0 to 65535.`);
  return port;
}

function oneDir(command: string, positionals: string[]): string {
  if (positionals.length > 1) throw new CliError(`thixo ${command} takes one folder, got ${positionals.length}.`);
  return positionals[0] ?? ".";
}

export function parseCommand(argv: string[], env: NodeJS.ProcessEnv = process.env): Command {
  const [first, ...rest] = argv;
  if (first === undefined || first === "help" || first === "--help" || first === "-h") return { name: "help", topic: first === "help" ? rest[0] : undefined };
  if (first === "--version" || first === "-v" || first === "version") return { name: "version" };
  const wantsHelp = rest.includes("--help") || rest.includes("-h");

  switch (first) {
    case "build": {
      if (wantsHelp) return { name: "help", topic: "build" };
      const { values, positionals } = parse("build", rest, { "no-minify": { type: "boolean" } });
      return { name: "build", dir: oneDir("build", positionals), minify: !values["no-minify"] };
    }
    case "start":
    case "dev": {
      if (wantsHelp) return { name: "help", topic: first };
      const { values, positionals } = parse(first, rest, { port: { type: "string" } });
      return { name: first, dir: oneDir(first, positionals), port: parsePort(values.port, env) };
    }
    case "compile": {
      if (wantsHelp) return { name: "help", topic: "compile" };
      const { values, positionals } = parse("compile", rest, { out: { type: "string" }, json: { type: "boolean" }, project: { type: "string" } });
      if (positionals.length !== 1) throw new CliError("thixo compile takes one folder or .thx file.\nRun `thixo compile --help` for the options.");
      return { name: "compile", target: positionals[0], out: values.out, json: !!values.json, project: values.project };
    }
    case "new": {
      const [what, ...more] = rest;
      if (what !== "plugin") {
        if (wantsHelp) return { name: "help", topic: "new-plugin" };
        throw new CliError(`thixo new makes a plugin: \`thixo new plugin <name> --slot <slot>\`.`);
      }
      if (wantsHelp) return { name: "help", topic: "new-plugin" };
      const { values, positionals } = parse("new plugin", more, { slot: { type: "string" } });
      if (!positionals[0]) throw new CliError("thixo new plugin needs a name: `thixo new plugin <name> --slot <slot>`.");
      if (!values.slot) throw new CliError("thixo new plugin needs --slot <slot>, the slot the plugin fills.");
      if (positionals.length > 2) throw new CliError("thixo new plugin takes a name and, optionally, the app folder.");
      return { name: "new-plugin", pluginName: positionals[0], slot: values.slot, dir: positionals[1] ?? "." };
    }
    case "agent": {
      if (wantsHelp) return { name: "help", topic: "agent" };
      const { values, positionals } = parse("agent", rest, {
        as: { type: "string" },
        json: { type: "string" },
        file: { type: "string", multiple: true },
        dir: { type: "string" },
        plugin: { type: "string" },
        slot: { type: "string" },
        port: { type: "string" },
        project: { type: "string" },
        raw: { type: "boolean" },
      });
      const [tool, ...others] = positionals;
      if (!tool) throw new CliError("thixo agent needs a tool: submit, check, search, read, fork, use, describe, or a tool name.\nRun `thixo agent --help`.");
      if (!values.as) throw new CliError("thixo agent needs --as <user>, the user the tool acts as.");
      return {
        name: "agent",
        options: {
          command: tool,
          as: values.as,
          json: values.json,
          files: values.file ?? [],
          dir: values.dir,
          plugin: values.plugin,
          slot: values.slot,
          positionals: others,
          port: values.port === undefined ? undefined : parsePort(values.port, env),
          project: values.project,
          raw: !!values.raw,
        },
      };
    }
    case "registry": {
      const [what, ...more] = rest;
      if (wantsHelp) return { name: "help", topic: "registry" };
      if (what !== "list") throw new CliError("thixo registry has one command: `thixo registry list [dir]`.");
      const { values, positionals } = parse("registry list", more, { json: { type: "boolean" } });
      return { name: "registry-list", dir: oneDir("registry list", positionals), json: !!values.json };
    }
    case "release": {
      if (wantsHelp) return { name: "help", topic: "release" };
      const { values, positionals } = parse("release", rest, { json: { type: "boolean" } });
      return { name: "release", dir: oneDir("release", positionals), json: !!values.json };
    }
    default:
      throw new CliError(`Unknown command "${first}".\n\n${HELP.main}`);
  }
}
