import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, AgentMessage, AgentTurn, ModelAdapter } from "thixo/contract";

export interface ClaudeCodeOptions {
  /** A model alias or full name. Default `sonnet`. */
  model?: string;
  /** The command to run. Default `claude`. */
  command?: string;
  /** Milliseconds to wait for one reply. Default 300000. */
  timeoutMs?: number;
  /** More flags for `claude`, after the ones this adapter sets. */
  extraArgs?: string[];
}

const SYSTEM = "You are the model behind a tool-calling agent. Reply with one JSON object and nothing else, as the prompt says.";

const PROTOCOL = `Reply with exactly one JSON object and nothing else: no prose, no code fence.
To call a tool: {"type":"tool","name":"<tool name>","input":{ ... }}
To answer the user: {"type":"final","text":"<your answer>"}
Call at most one tool per reply. Use only the tools listed above. After a tool's result comes back you will be asked again.`;

function renderMessage(message: AgentMessage): string {
  if (message.role === "user") return `[user]\n${message.text}`;
  if (message.role === "tool") return `[tool result for ${message.name} (${message.id})]\n${message.output}`;
  const calls = (message.toolCalls ?? [])
    .map((call) => `\n[you called ${call.name} (${call.id}) with ${JSON.stringify(call.input)}]`)
    .join("");
  return `[you]\n${message.text}${calls}`;
}

/** The whole turn as one prompt: the system text, the tools, the conversation, and how to reply. */
export function renderPrompt(turn: AgentTurn): string {
  const tools = turn.tools.length
    ? turn.tools.map((tool) => `- ${tool.name}: ${tool.description}\n  input schema: ${JSON.stringify(tool.input)}`).join("\n")
    : "(none)";
  const conversation = turn.messages.length ? turn.messages.map(renderMessage).join("\n\n") : "(empty)";
  return `${turn.system}\n\n# Tools\n${tools}\n\n# Conversation\n${conversation}\n\n# How to reply\n${PROTOCOL}\n`;
}

/** Every JSON object in `text`, in order, however much prose or fence surrounds them. */
function jsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          found.push(JSON.parse(text.slice(start, i + 1)));
          start = i;
        } catch {}
        break;
      }
    }
  }
  return found;
}

/** Turns the model's reply into events. A tool call or a final answer is found wherever it sits in the text. A
 * reply with neither is shown as the answer. */
export function parseReply(reply: string, turn?: Pick<AgentTurn, "tools">): AgentEvent[] {
  const text = reply.trim();
  if (!text) return [{ type: "text", text: "The model returned an empty reply." }, { type: "done" }];
  for (const candidate of jsonObjects(text)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const object = candidate as Record<string, unknown>;
    const kind = typeof object.type === "string" ? object.type.toLowerCase() : undefined;
    if ((kind === "tool" || kind === "tool_call" || kind === "tool_use" || (kind === undefined && "name" in object && "input" in object)) && typeof object.name === "string") {
      const known = !turn || turn.tools.some((tool) => tool.name === object.name);
      if (!known) return [{ type: "text", text: `The model asked for a tool that does not exist: ${object.name}.` }, { type: "done" }];
      return [{ type: "tool", id: `call_${randomUUID().slice(0, 8)}`, name: object.name, input: object.input ?? {} }, { type: "done" }];
    }
    if ((kind === "final" || kind === "text" || kind === "answer") && "text" in object) {
      const answer = typeof object.text === "string" ? object.text : JSON.stringify(object.text);
      return [{ type: "text", text: answer }, { type: "done" }];
    }
  }
  return [{ type: "text", text }, { type: "done" }];
}

/** What `claude -p --output-format json` printed: the reply, or what went wrong. */
export function parseClaudeOutput(stdout: string): { text: string } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const trimmed = stdout.trim();
    return trimmed ? { text: trimmed } : { error: "Claude Code printed nothing." };
  }
  const result = Array.isArray(parsed) ? parsed.find((item) => item && (item as { type?: string }).type === "result") : parsed;
  if (!result || typeof result !== "object") return { error: "Claude Code printed something unexpected." };
  const object = result as { is_error?: boolean; result?: unknown; subtype?: string; api_error_status?: unknown };
  const text = typeof object.result === "string" ? object.result : "";
  if (object.is_error) return { error: text || `Claude Code reported an error (${object.subtype ?? "unknown"}).` };
  return { text };
}

const MISSING = (command: string) =>
  `The \`${command}\` command was not found, so the authoring chat can't run. Install Claude Code and sign in, or give Thixo a model adapter that uses an API key.`;

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
  timedOut?: boolean;
}

/** A model adapter that runs the local `claude` command in print mode, once per turn: no API key, no tools, no
 * project context, and a temporary working directory. */
export function claudeCode(options: ClaudeCodeOptions = {}): ModelAdapter {
  const command = options.command ?? "claude";
  const model = options.model ?? "sonnet";
  const timeoutMs = options.timeoutMs ?? 300_000;

  return {
    async *run(turn) {
      const cwd = await mkdtemp(join(tmpdir(), "thixo-claude-"));
      const args = [
        "-p",
        "--output-format", "json",
        "--model", model,
        "--tools", "",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--system-prompt", SYSTEM,
        ...(options.extraArgs ?? []),
      ];
      const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
      try {
        const outcome = await new Promise<Outcome>((resolve) => {
          let stdout = "";
          let stderr = "";
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, timeoutMs);
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
          child.on("error", (spawnError: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            resolve({ code: null, stdout, stderr, spawnError });
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, timedOut });
          });
          child.stdin.on("error", () => {});
          child.stdin.end(renderPrompt(turn));
        });

        if (outcome.spawnError) {
          const missing = outcome.spawnError.code === "ENOENT";
          yield { type: "text", text: missing ? MISSING(command) : `Could not run \`${command}\`: ${outcome.spawnError.message}` };
          yield { type: "done" };
          return;
        }
        if (outcome.timedOut) {
          yield { type: "text", text: `Claude Code did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
          yield { type: "done" };
          return;
        }
        const output = parseClaudeOutput(outcome.stdout);
        if ("error" in output || outcome.code !== 0) {
          const detail = "error" in output ? output.error : output.text;
          const extra = outcome.stderr.trim().split("\n").slice(-3).join(" ");
          yield { type: "text", text: `Claude Code failed${outcome.code ? ` (exit ${outcome.code})` : ""}: ${[detail, extra].filter(Boolean).join(" ")}` };
          yield { type: "done" };
          return;
        }
        yield* parseReply(output.text, turn);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
