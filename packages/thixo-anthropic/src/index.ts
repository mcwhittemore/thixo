import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, AgentMessage, AgentTurn, ModelAdapter } from "thixo/contract";

export interface AnthropicOptions {
  /** Default: `ANTHROPIC_API_KEY`. */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
}

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_MAX_TOKENS = 16000;

export const MISSING_KEY_MESSAGE =
  "The Claude API key is missing. Set ANTHROPIC_API_KEY, or pass apiKey to anthropic(), and try again. To use the local claude login in development, import anthropic from thixo-anthropic/node instead.";

export function envKey(): string | undefined {
  try {
    return typeof process === "undefined" ? undefined : process.env?.ANTHROPIC_API_KEY || undefined;
  } catch {
    return undefined;
  }
}

/** The Claude API as the authoring agent's model. Its calls are streamed, so it runs anywhere `fetch` does. */
export function anthropic(options: AnthropicOptions = {}): ModelAdapter {
  const apiKey = options.apiKey || envKey();
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  let client: Anthropic | undefined;

  return {
    async *run(turn: AgentTurn): AsyncGenerator<AgentEvent> {
      if (!apiKey) {
        yield { type: "text", text: MISSING_KEY_MESSAGE };
        yield { type: "done" };
        return;
      }
      client ??= new Anthropic({ apiKey, ...(options.baseUrl ? { baseURL: options.baseUrl } : {}) });
      yield* stream(client, { model, maxTokens, turn });
    },
  };
}

export function toMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", block: Anthropic.ContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...block);
    else out.push({ role, content: block });
  };
  for (const m of messages) {
    if (m.role === "user") {
      if (m.text) push("user", [{ type: "text", text: m.text }]);
    } else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.text) blocks.push({ type: "text", text: m.text });
      for (const call of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} });
      }
      if (blocks.length) push("assistant", blocks);
    } else {
      push("user", [{ type: "tool_result", tool_use_id: m.id, content: m.output }]);
    }
  }
  return out;
}

async function* stream(
  client: Anthropic,
  { model, maxTokens, turn }: { model: string; maxTokens: number; turn: AgentTurn },
): AsyncGenerator<AgentEvent> {
  const events = await client.messages.create({
    model,
    max_tokens: maxTokens,
    stream: true,
    system: turn.system,
    messages: toMessages(turn.messages),
    ...(turn.tools.length
      ? {
          tools: turn.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: { type: "object" as const, ...t.input },
          })),
        }
      : {}),
  });

  const open = new Map<number, { id: string; name: string; json: string }>();
  let stopReason: string | null = null;

  for await (const event of events) {
    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        open.set(event.index, { id: event.content_block.id, name: event.content_block.name, json: "" });
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        if (event.delta.text) yield { type: "text", text: event.delta.text };
      } else if (event.delta.type === "input_json_delta") {
        const call = open.get(event.index);
        if (call) call.json += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      const call = open.get(event.index);
      if (call) {
        open.delete(event.index);
        yield { type: "tool", id: call.id, name: call.name, input: parseInput(call) };
      }
    } else if (event.type === "message_delta") {
      stopReason = event.delta.stop_reason ?? stopReason;
    }
  }

  if (stopReason === "refusal") {
    yield { type: "text", text: "The model declined to answer this request." };
  } else if (stopReason === "max_tokens") {
    yield { type: "text", text: "\n[The reply was cut off at the maximum length.]" };
  }
  yield { type: "done" };
}

function parseInput(call: { name: string; json: string }): unknown {
  if (!call.json.trim()) return {};
  try {
    return JSON.parse(call.json);
  } catch {
    throw new Error(`The model sent input for the tool "${call.name}" that is not valid JSON.`);
  }
}
