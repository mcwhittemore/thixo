import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CliError, messageOf } from "./errors.js";
import type { Io } from "./io.js";
import { readAgentKey } from "./keys.js";
import { readPluginFolder } from "./plugins.js";
import { findProjectRoot, projectPaths } from "./project.js";

export interface AgentOptions {
  /** The command's own name: `submit`, `check`, `search`, `read`, `fork`, `use`, `describe`, or any tool name. */
  command: string;
  as: string;
  /** `--json`: the tool's input as JSON text. */
  json?: string;
  /** `--file path=@local`, repeated. */
  files: string[];
  dir?: string;
  plugin?: string;
  slot?: string;
  positionals: string[];
  port?: number;
  project?: string;
  /** `--raw`: print the response body as JSON. */
  raw: boolean;
}

export interface AgentRequest {
  tool: string;
  as: string;
  input: Record<string, unknown>;
}

/** The tool each short command calls. Any other command is taken as a tool name. */
export const TOOL_NAMES: Record<string, string> = {
  search: "search_registry",
  read: "read_plugin",
  describe: "describe_app",
  check: "check",
  submit: "submit",
  fork: "fork",
  use: "use",
};

export function parseRef(text: string): { plugin: string; version?: number } {
  const at = text.lastIndexOf("@");
  if (at <= 0) return { plugin: text };
  const version = Number(text.slice(at + 1));
  if (!Number.isInteger(version) || version < 1) throw new CliError(`"${text}" is not <pluginId>@<version>. The version is a whole number such as plg_abc@2.`);
  return { plugin: text.slice(0, at), version };
}

function parseFileFlag(flag: string, cwd: string): [string, string] {
  const eq = flag.indexOf("=");
  if (eq <= 0 || flag[eq + 1] !== "@") throw new CliError(`--file takes path=@local-file, such as plugin.thx=@./my-plugin/plugin.thx. Got "${flag}".`);
  const local = resolve(cwd, flag.slice(eq + 2));
  try {
    return [flag.slice(0, eq), readFileSync(local, "utf8")];
  } catch (error) {
    throw new CliError(`Cannot read ${local}: ${messageOf(error)}`);
  }
}

/** A tool's own name typed as the command, such as `read_plugin`, takes the short command's arguments. */
const SHORT_FOR: Record<string, string> = Object.fromEntries(Object.entries(TOOL_NAMES).map(([short, tool]) => [tool, short]));

/** Turns the command line into the request body: `{ tool, as, input }`. */
export function buildAgentRequest(given: AgentOptions, cwd: string): AgentRequest {
  const options = { ...given, command: SHORT_FOR[given.command] ?? given.command };
  let input: Record<string, unknown> = {};
  if (options.json !== undefined) {
    try {
      const parsed: unknown = JSON.parse(options.json);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("it must be a JSON object");
      input = parsed as Record<string, unknown>;
    } catch (error) {
      throw new CliError(`--json is not a JSON object: ${messageOf(error)}`);
    }
  }

  const files: Record<string, string> = { ...((input.files as Record<string, string> | undefined) ?? {}) };
  if (options.dir) Object.assign(files, readPluginFolder(resolve(cwd, options.dir)));
  for (const flag of options.files) {
    const [path, text] = parseFileFlag(flag, cwd);
    files[path] = text;
  }
  const [first, ...rest] = options.positionals;

  switch (options.command) {
    case "submit":
    case "check": {
      if (!Object.keys(files).length) throw new CliError(`${options.command} needs the plugin's files: --dir <folder>, --file path=@local, or --json '{"files":{...}}'.`);
      input = { ...input, files, ...(options.plugin ? { plugin: options.plugin } : {}) };
      break;
    }
    case "search": {
      const query = [first, ...rest].filter(Boolean).join(" ");
      input = { ...(query ? { query } : {}), ...input, ...(options.slot ? { slot: options.slot } : {}) };
      break;
    }
    case "read": {
      const ref = first ? parseRef(first) : options.plugin ? parseRef(options.plugin) : null;
      if (!ref && input.plugin === undefined) throw new CliError("read needs a plugin: thixo agent read --as <user> <pluginId>[@<version>].");
      input = { ...(ref ? { plugin: ref.plugin, ...(ref.version ? { version: ref.version } : {}) } : {}), ...input };
      break;
    }
    case "fork": {
      const ref = first ? parseRef(first) : null;
      if (!ref && input.plugin === undefined) throw new CliError("fork needs a plugin version: thixo agent fork --as <user> <pluginId>@<version>.");
      if (ref && !ref.version) throw new CliError("fork needs a version: <pluginId>@<version>.");
      input = { ...(ref ? { plugin: ref.plugin, version: ref.version } : {}), ...input };
      break;
    }
    case "use": {
      const ref = first ? parseRef(first) : null;
      if (!ref && input.plugin === undefined) throw new CliError("use needs a plugin version and a slot: thixo agent use --as <user> <pluginId>@<version> --slot <slot>.");
      if (ref && !ref.version) throw new CliError("use needs a version: <pluginId>@<version>.");
      if (!options.slot && input.slot === undefined) throw new CliError("use needs --slot <slot>.");
      input = { ...(ref ? { plugin: ref.plugin, version: ref.version } : {}), ...(options.slot ? { slot: options.slot } : {}), ...input };
      break;
    }
    default: {
      if (Object.keys(files).length) input = { ...input, files };
    }
  }
  return { tool: TOOL_NAMES[options.command] ?? options.command, as: options.as, input };
}

/** Where the dev server is: `--port`, else `.thixo/dev.json` in the project, else port 3000. */
export function resolveAgentTarget(options: Pick<AgentOptions, "port" | "project">, cwd: string): { url: string; key: string } {
  const root = options.project ? resolve(cwd, options.project) : findProjectRoot(cwd);
  if (!root) throw new CliError("No project found. Run the command inside the app (a folder with thixo.config.ts) or pass --project <dir>.");
  const paths = projectPaths(root);
  const key = readAgentKey(paths.agentKeyFile);
  if (!key) throw new CliError(`No agent key at ${paths.agentKeyFile}. Start the app with \`thixo dev\`: it writes one.`);
  let url = "http://127.0.0.1:3000";
  if (options.port !== undefined) url = `http://127.0.0.1:${options.port}`;
  else {
    try {
      const dev = JSON.parse(readFileSync(paths.devFile, "utf8")) as { url?: string };
      if (dev.url) url = dev.url;
    } catch {}
  }
  return { url, key };
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** The result as lines a person reads. A string is printed as it is; `errors` with a file and line print as
 * `file:line:col code message`; anything else is indented JSON. */
export function formatAgentResult(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const lines: string[] = [];
    const errors = record.errors;
    if (Array.isArray(errors) && errors.every((e) => e && typeof e === "object" && "file" in e && "line" in e)) {
      for (const e of errors as { file: string; line: number; column?: number; code?: string; message: string; hint?: string }[]) {
        lines.push(`${e.file}:${e.line}:${e.column ?? 1} ${e.code ?? ""} ${e.message}`.replace(/ {2,}/g, " "));
        if (e.hint) lines.push(`  hint: ${e.hint}`);
      }
      const { errors: _omit, ...rest } = record;
      if (Object.keys(rest).length) lines.push(JSON.stringify(rest, null, 2));
      return lines.join("\n");
    }
    for (const key of ["text", "reference", "description"]) {
      if (typeof record[key] === "string" && Object.keys(record).length === 1) return record[key] as string;
    }
    if (Array.isArray(record.summary) && record.summary.every((s) => typeof s === "string")) {
      const { summary, ...rest } = record;
      lines.push(...(summary as string[]).map((s) => `- ${s}`));
      if (Object.keys(rest).length) lines.push(JSON.stringify(rest, null, 2));
      return lines.join("\n");
    }
  }
  return JSON.stringify(body, null, 2);
}

/** `thixo agent`: one tool call against the running dev server. */
export async function runAgent(options: AgentOptions, io: Io, fetchImpl: Fetch = fetch): Promise<number> {
  const request = buildAgentRequest(options, io.cwd);
  const { url, key } = resolveAgentTarget(options, io.cwd);
  let response: Response;
  try {
    response = await fetchImpl(`${url}/_thixo/authoring/tool`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-thixo-agent-key": key },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new CliError(`Could not reach the dev server at ${url} (${messageOf((error as { cause?: unknown }).cause ?? error)}). Start it with \`thixo dev\`, or pass --port.`);
  }
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {}

  if (!response.ok) {
    const error = (body as ErrorBody | null)?.error;
    const hint = response.status === 404 ? " The tool route is off: it needs `thixo dev`, which turns it on." : response.status === 401 || response.status === 403 ? " The agent key may be stale: restart `thixo dev` so it writes a new one." : "";
    const detail = error?.message ?? raw;
    io.err(options.raw ? raw : `${request.tool} failed (${response.status}${error?.code ? ` ${error.code}` : ""}): ${detail}${hint && !/[.!?]$/.test(detail) ? "." : ""}${hint}`);
    return 1;
  }
  io.out(options.raw ? (typeof body === "string" ? body : JSON.stringify(body, null, 2)) : formatAgentResult(body));
  // A build that fails is a normal reply from the tool (ok: false), but a script reads the exit code: 1, as for a refusal.
  if (body && typeof body === "object" && (body as { ok?: unknown }).ok === false) return 1;
  return 0;
}
