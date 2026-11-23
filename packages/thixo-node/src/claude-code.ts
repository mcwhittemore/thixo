// The one implementation lives in thixo-anthropic/node. This keeps `claudeCode` importable from thixo-node.
export { claudeCode, parseClaudeOutput, parseReply, renderPrompt } from "thixo-anthropic/node";
export type { ClaudeCodeOptions } from "thixo-anthropic/node";
