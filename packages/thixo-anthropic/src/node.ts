import type { AgentEvent, AgentTurn, ModelAdapter } from "thixo/contract";
import { claudeCode, type ClaudeCodeOptions } from "./claude-code.js";
import { anthropic as anthropicApi, envKey, type AnthropicOptions } from "./index.js";

export { claudeCode, parseClaudeOutput, parseReply, renderPrompt } from "./claude-code.js";
export type { ClaudeCodeOptions } from "./claude-code.js";
export { DEFAULT_MAX_TOKENS, DEFAULT_MODEL, MISSING_KEY_MESSAGE, toMessages } from "./index.js";
export type { AnthropicOptions } from "./index.js";

export interface AnthropicNodeOptions extends AnthropicOptions {
  /** Options for the local `claude` command, used when there is no key in development. */
  local?: ClaudeCodeOptions;
  /** Where the one line saying which path is in use goes. Default `console.log`. */
  log?: (line: string) => void;
  /** Overrides the check for production. Default: `NODE_ENV` is `production`. */
  production?: boolean;
}

export const NO_KEY_IN_PRODUCTION =
  "The Claude API key is missing. In production the authoring chat needs one: set ANTHROPIC_API_KEY, or pass apiKey to anthropic(). The local claude login is used only in development.";

function isProduction(): boolean {
  try {
    return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  } catch {
    return false;
  }
}

/** The Claude adapter for Node. With a key (`apiKey`, else `ANTHROPIC_API_KEY`) it calls the Claude API. With no key
 * in development it runs the local `claude` command, so whoever is signed in to Claude Code needs nothing else.
 * With no key in production it fails with a clear error. It chooses on the first turn and logs which it chose. */
export function anthropic(options: AnthropicNodeOptions = {}): ModelAdapter {
  let chosen: ModelAdapter | undefined;
  const choose = (): ModelAdapter => {
    const log = options.log ?? ((line: string) => console.log(line));
    const apiKey = options.apiKey || envKey();
    if (apiKey) {
      log("thixo-anthropic: using the Claude API (an API key is set).");
      return anthropicApi({ ...options, apiKey });
    }
    if (options.production ?? isProduction()) throw new Error(NO_KEY_IN_PRODUCTION);
    log("thixo-anthropic: no API key, so using the local `claude` login (development only).");
    return claudeCode({ ...(options.model ? { model: options.model } : {}), ...options.local });
  };
  return {
    async *run(turn: AgentTurn): AsyncGenerator<AgentEvent> {
      chosen ??= choose();
      yield* chosen.run(turn);
    },
  };
}
