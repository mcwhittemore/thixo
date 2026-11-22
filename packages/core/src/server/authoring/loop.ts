import { isHttpError } from "../../api/errors.js";
import type { AgentMessage, AgentTool } from "../../contract.js";
import type { ServerContext } from "../context.js";
import { conversationsOf, remember } from "./conversations.js";
import { defaultSystemPrompt } from "./prompt.js";
import { createAuthoringTools, type AuthoringTools } from "./tools.js";
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

/** What a tool call comes back as, for the model: JSON, or the refusal as `{ error }`. */
export async function runTool(ctx: ServerContext, name: string, input: unknown, user: AuthoringRequest["user"]): Promise<{ ok: boolean; output: string }> {
  try {
    if (!toolList(ctx).some((tool) => tool.name === name)) {
      const names = toolList(ctx).map((tool) => tool.name).join(", ");
      return { ok: false, output: JSON.stringify({ error: { code: "unknown_tool", message: `There is no tool named ${name}. The tools are ${names}.` } }) };
    }
    const result = await toolsOf(ctx).run(name, input, user);
    const failed = !!result && typeof result === "object" && (result as { ok?: unknown }).ok === false;
    return { ok: !failed, output: JSON.stringify(result) };
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

      const assistant: AgentMessage = { role: "assistant", text, ...(calls.length ? { toolCalls: calls } : {}) };
      conversation.messages.push(assistant);
      if (!calls.length) break turns;

      for (const call of calls) {
        const result = await runTool(ctx, call.name, call.input, request.user);
        conversation.messages.push({ role: "tool", id: call.id, name: call.name, output: result.output });
        yield { type: "tool_result", id: call.id, name: call.name, ok: result.ok, output: result.output };
      }
    }
  } finally {
    conversation.busy = false;
  }
  yield { type: "done", conversation: id };
}
