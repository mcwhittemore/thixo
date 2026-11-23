import assert from "node:assert/strict";
import { test } from "node:test";
import * as anthropicNode from "thixo-anthropic/node";
import { claudeCode, parseClaudeOutput, parseReply, renderPrompt } from "../src/index.js";

test("thixo-node still exports claudeCode, and it is the thixo-anthropic one", () => {
  assert.equal(claudeCode, anthropicNode.claudeCode);
  assert.equal(parseClaudeOutput, anthropicNode.parseClaudeOutput);
  assert.equal(parseReply, anthropicNode.parseReply);
  assert.equal(renderPrompt, anthropicNode.renderPrompt);
});
