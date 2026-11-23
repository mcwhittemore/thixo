import { isHttpError } from "../../api/errors.js";
import type { AgentMessage, AgentTool } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { conversationsOf, remember } from "./conversations.js";
import { defaultSystemPrompt } from "./prompt.js";
import { blockedMessage, guardOf, isCategory } from "./guard.js";
import { createAuthoringTools, type AuthoringTools, type ToolContext } from "./tools.js";
import { DEFAULT_MAX_TURNS, type AuthoringEvent, type AuthoringRequest } from "./types.js";

const toolsets = new WeakMap<ServerContext, AuthoringTools>();

export function toolsOf(ctx: ServerContext): AuthoringTools {
  let tools = toolsets.get(ctx);
  if (!tools) {
    tools = createAuthoringTools(ctx);
    toolsets.set(ctx, tools);
  }
  return tools;
}

/** The tools this server offers: Thixo's, or what `config.authoring.tools` makes of them (W2). */
export function toolList(ctx: ServerContext): AgentTool[] {
  const defaults = toolsOf(ctx).definitions;
  return ctx.config.authoring?.tools ? ctx.config.authoring.tools(defaults) : defaults;
}

/** A refusal in a tool's reply (`refuse`, or a check or submit the guard flagged). */
export interface ToolRefusal {
  category: Extract<AuthoringEvent, { type: "refusal" }>["category"];
  from: "user" | "data";
  message: string;
  count: number;
  limit: number;
  blocked: boolean;
}

function refusalIn(result: unknown): ToolRefusal | undefined {
  if (!result || typeof result !== "object") return undefined;
  const refusal = (result as { refusal?: unknown }).refusal;
  if (!refusal || typeof refusal !== "object") return undefined;
  const r = refusal as ToolRefusal;
  return { category: r.category, from: r.from, message: r.message, count: r.count, limit: r.limit, blocked: r.blocked };
}

/** Every JSON object written in `text`, outermost first. */
function objectsIn(text: string): unknown[] {
  const found: unknown[] = [];
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === "\\") i++;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          found.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // Not JSON: keep looking.
        }
        break;
      }
    }
  }
  return found;
}

/** The input of a refuse call the model wrote as text, such as `{"type":"refuse","category":"credentials",...}` or
 * `{"name":"refuse","input":{...}}`, when it names a category and a reason. */
export function refusalInText(text: string): Record<string, unknown> | null {
  if (!text.includes("refuse")) return null;
  for (const value of objectsIn(text)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const o = value as Record<string, unknown>;
    const named = o.type === "refuse" || o.name === "refuse" || o.tool === "refuse";
    if (!named) continue;
    const inner = [o.input, o.arguments, o.parameters].find((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown> | undefined;
    const fields = inner ?? o;
    if (!isCategory(fields.category) || typeof fields.reason !== "string" || !fields.reason) continue;
    return {
      category: fields.category,
      reason: fields.reason,
      from: fields.from === "data" ? "data" : "user",
      ...(typeof fields.quote === "string" && fields.quote ? { quote: fields.quote } : {}),
    };
  }
  return null;
}

/** What a tool call comes back as, for the model: JSON, or the refusal as `{ error }`. */
export async function runTool(
  ctx: ServerContext,
  name: string,
  input: unknown,
  user: AuthoringRequest["user"],
  context?: ToolContext,
): Promise<{ ok: boolean; output: string; refusal?: ToolRefusal }> {
  try {
    if (!toolList(ctx).some((tool) => tool.name === name)) {
      const names = toolList(ctx).map((tool) => tool.name).join(", ");
      return { ok: false, output: JSON.stringify({ error: { code: "unknown_tool", message: `There is no tool named ${name}. The tools are ${names}.` } }) };
    }
    const result = await toolsOf(ctx).run(name, input, user, context);
    const failed = !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
    const refusal = refusalIn(result);
    return { ok: !failed, output: JSON.stringify(result), ...(refusal ? { refusal } : {}) };
  } catch (error) {
    if (isHttpError(error)) {
      return { ok: false, output: JSON.stringify({ error: { code: error.code, message: error.message, ...(error.details ?? {}) } }) };
    }
    console.error(`authoring tool ${name} failed`, error);
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: JSON.stringify({ error: { code: "tool_failed", message: `The tool failed: ${message}` } }) };
  }
}

/** U1, U4, U5: one message in, the agent's events out. It calls the model, runs the tools it asks for, gives the
 * results back, and stops on a turn with no tool calls or at the cap. `done` is always the last event. */
export async function* runAuthoring(ctx: ServerContext, request: AuthoringRequest): AsyncGenerator<AuthoringEvent> {
  const store = conversationsOf(ctx);
  const id = request.conversation ?? crypto.randomUUID();
  let conversation = store.get(id);

  if (request.conversation && !conversation) {
    yield { type: "error", message: `There is no conversation ${id}. Start a new one by leaving conversation out.` };
    yield { type: "done", conversation: id };
    return;
  }
  if (conversation && conversation.owner !== request.user.id) {
    yield { type: "error", message: `There is no conversation ${id}.` };
    yield { type: "done", conversation: id };
    return;
  }
  const block = await guardOf(ctx).activeBlock(request.user.id);
  if (block) {
    yield { type: "error", message: blockedMessage(block) };
    yield { type: "done", conversation: id };
    return;
  }
  if (conversation?.ended) {
    yield { type: "error", message: "This conversation has ended. Start a new one by leaving conversation out." };
    yield { type: "done", conversation: id };
    return;
  }
  if (conversation?.busy) {
    yield { type: "error", message: "That conversation is still answering the last message. Wait for it to finish." };
    yield { type: "done", conversation: id };
    return;
  }
  conversation ??= { owner: request.user.id, messages: [], busy: false };
  remember(store, id, conversation);

  const flow = ctx.config.authoring;
  const defaults = defaultSystemPrompt();
  const system = flow?.system ? flow.system(defaults) : defaults;
  const tools = toolList(ctx);
  const maxTurns = request.maxTurns ?? DEFAULT_MAX_TURNS;

  conversation.busy = true;
  conversation.messages.push({ role: "user", text: request.message });
  try {
    turns: for (let turn = 1; ; turn++) {
      if (turn > maxTurns) {
        yield { type: "error", message: `Stopped after ${maxTurns} model turns without finishing. Send another message to continue.` };
        break turns;
      }

      let text = "";
      const calls: { id: string; name: string; input: unknown }[] = [];
      try {
        for await (const event of request.model.run({ system, messages: [...conversation.messages], tools })) {
          if (event.type === "text") {
            text += event.text;
            yield { type: "text", text: event.text };
          } else if (event.type === "tool") {
            calls.push({ id: event.id, name: event.name, input: event.input });
            yield { type: "tool", id: event.id, name: event.name, input: event.input };
          } else break;
        }
      } catch (error) {
        if (conversation.messages.at(-1)?.role === "user") conversation.messages.pop();
        yield { type: "error", message: `The model failed: ${error instanceof Error ? error.message : String(error)}` };
        break turns;
      }

      // A model sometimes writes the refuse call out as JSON text instead of calling the tool. Run it as the call it
      // meant, so the refusal is recorded and counted like any other.
      if (!calls.length && tools.some((tool) => tool.name === "refuse")) {
        const input = refusalInText(text);
        if (input) {
          const call = { id: `refuse-in-text-${turn}`, name: "refuse", input };
          calls.push(call);
          yield { type: "tool", ...call };
        }
      }

      const assistant: AgentMessage = { role: "assistant", text, ...(calls.length ? { toolCalls: calls } : {}) };
      conversation.messages.push(assistant);
      if (!calls.length) break turns;

      let refused: ToolRefusal | undefined;
      for (const call of calls) {
        if (refused) {
          // A refusal ends the turn: the calls after it in the same turn do not run.
          const output = JSON.stringify({ error: { code: "not_run", message: "Not run: an earlier call in this turn was a refusal." } });
          conversation.messages.push({ role: "tool", id: call.id, name: call.name, output });
          yield { type: "tool_result", id: call.id, name: call.name, ok: false, output };
          continue;
        }
        const result = await runTool(ctx, call.name, call.input, request.user, { conversation: id, message: request.message });
        conversation.messages.push({ role: "tool", id: call.id, name: call.name, output: result.output });
        yield { type: "tool_result", id: call.id, name: call.name, ok: result.ok, output: result.output };
        if (result.refusal) refused = result.refusal;
      }
      if (refused) {
        yield { type: "refusal", ...refused };
        if (refused.blocked) conversation.ended = true;
        break turns;
      }
    }
  } finally {
    conversation.busy = false;
  }
  yield { type: "done", conversation: id };
}
