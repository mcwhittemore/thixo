import type { AgentMessage, AgentTurn, ModelAdapter, RefusalCategory, User } from "../../contract.js";

export type AuthoringEvent =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: string }
  | { type: "error"; message: string }
  /** The agent refused, or the submit path's check did. `message` is what the person sees. With `blocked`, the
   * session has ended and the person can no longer make plugins. */
  | { type: "refusal"; category: RefusalCategory; from: "user" | "data"; message: string; count: number; limit: number; blocked: boolean }
  /** Always the last event of a run. `conversation` is the id to send next time to continue the chat. */
  | { type: "done"; conversation: string };

export interface AuthoringRequest {
  user: User;
  /** Continue this conversation. Omitted, a new one starts. */
  conversation?: string;
  message: string;
  model: ModelAdapter;
  /** Model turns allowed for this message. Default 24. */
  maxTurns?: number;
}

export const DEFAULT_MAX_TURNS = 24;

export interface Conversation {
  owner: string;
  messages: AgentMessage[];
  busy: boolean;
  /** Set when the guard blocked the person: the conversation takes no more messages. */
  ended?: boolean;
}

export type { AgentTurn };
