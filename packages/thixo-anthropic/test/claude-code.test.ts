import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentEvent, AgentTurn } from "thixo/contract";
import { claudeCode, parseClaudeOutput, parseReply, renderPrompt } from "../src/claude-code.js";

const turn: AgentTurn = {
  system: "You build plugins.",
  tools: [
    { name: "check", description: "Build without storing.", input: { type: "object", properties: { source: { type: "string" } } } },
    { name: "submit", description: "Store a version.", input: { type: "object" } },
  ],
  messages: [
    { role: "user", text: "Make a due date plugin" },
    { role: "assistant", text: "Checking.", toolCalls: [{ id: "c1", name: "check", input: { source: "x" } }] },
    { role: "tool", id: "c1", name: "check", output: "ok" },
  ],
};

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function fakeClaude(script: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "fake-claude-")), "claude");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

const envelope = (result: string, extra: object = {}) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...extra });

test("the prompt carries the system text, tools, conversation and the reply format", () => {
  const prompt = renderPrompt(turn);
  assert.match(prompt, /You build plugins\./);
  assert.match(prompt, /- check: Build without storing\./);
  assert.match(prompt, /"properties":\{"source"/);
  assert.match(prompt, /\[user\]\nMake a due date plugin/);
  assert.match(prompt, /\[you called check \(c1\) with \{"source":"x"\}\]/);
  assert.match(prompt, /\[tool result for check \(c1\)\]\nok/);
  assert.match(prompt, /"type":"final"/);
  assert.match(prompt, /"type":"tool"/);
});

test("a tool call is parsed, with an id", () => {
  const events = parseReply('{"type":"tool","name":"check","input":{"source":"abc"}}', turn);
  assert.equal(events.length, 2);
  const [tool, done] = events;
  assert.equal(tool.type, "tool");
  if (tool.type === "tool") {
    assert.equal(tool.name, "check");
    assert.deepEqual(tool.input, { source: "abc" });
    assert.match(tool.id, /^call_/);
  }
  assert.deepEqual(done, { type: "done" });
});

test("a final answer becomes a text event", () => {
  assert.deepEqual(parseReply('{"type":"final","text":"All done."}', turn), [{ type: "text", text: "All done." }, { type: "done" }]);
});

test("prose and code fences around the JSON are ignored", () => {
  const fenced = 'Sure! Here you go:\n```json\n{"type":"tool","name":"submit","input":{"a":"} not a brace {"}}\n```\nLet me know.';
  const [tool] = parseReply(fenced, turn);
  assert.equal(tool.type === "tool" && tool.name, "submit");
  assert.deepEqual(tool.type === "tool" && tool.input, { a: "} not a brace {" });
  const withNoise = 'I will use {curly} words first. {"type":"final","text":"Hi {there}"} trailing';
  assert.deepEqual(parseReply(withNoise, turn)[0], { type: "text", text: "Hi {there}" });
});

test("a reply with no JSON is shown as the answer", () => {
  assert.deepEqual(parseReply("  Just words.  ", turn), [{ type: "text", text: "Just words." }, { type: "done" }]);
  assert.deepEqual(parseReply('{"unrelated": true}', turn)[0], { type: "text", text: '{"unrelated": true}' });
  assert.match((parseReply("   ", turn)[0] as { text: string }).text, /empty/);
});

test("a tool the turn does not offer is reported, not called", () => {
  const [event] = parseReply('{"type":"tool","name":"rm_rf","input":{}}', turn);
  assert.equal(event.type, "text");
  assert.match((event as { text: string }).text, /rm_rf/);
});

test("claude's JSON envelope is read, and errors are told apart", () => {
  assert.deepEqual(parseClaudeOutput(envelope("hello")), { text: "hello" });
  assert.deepEqual(parseClaudeOutput(JSON.stringify([{ type: "system" }, { type: "result", is_error: false, result: "from array" }])), { text: "from array" });
  assert.deepEqual(parseClaudeOutput(envelope("Not logged in", { is_error: true })), { error: "Not logged in" });
  assert.deepEqual(parseClaudeOutput("plain text"), { text: "plain text" });
  assert.deepEqual(parseClaudeOutput(""), { error: "Claude Code printed nothing." });
});

test("the adapter runs the command per turn and yields its parsed reply", async () => {
  const args = join(mkdtempSync(join(tmpdir(), "args-")), "args");
  const stdin = `${args}.stdin`;
  const command = fakeClaude(
    `echo "$@" > ${args}\npwd >> ${args}\ncat > ${stdin}\nprintf '%s' '${envelope('Okay: {"type":"tool","name":"check","input":{"source":"s"}}')}'`,
  );
  const events = await collect(claudeCode({ command }).run(turn));
  assert.equal(events[0].type, "tool");
  assert.deepEqual(events[1], { type: "done" });
  const seen = readFileSync(args, "utf8");
  assert.match(seen, /-p /);
  assert.match(seen, /--output-format json/);
  assert.match(seen, /--model sonnet/);
  assert.match(seen, /--no-session-persistence/);
  assert.match(seen, /--strict-mcp-config/);
  assert.match(seen, /thixo-claude-/);
  assert.match(readFileSync(stdin, "utf8"), /Make a due date plugin/);
});

test("model option and extra args are passed", async () => {
  const args = join(mkdtempSync(join(tmpdir(), "args-")), "args");
  const command = fakeClaude(`echo "$@" > ${args}\ncat >/dev/null\nprintf '%s' '${envelope('{"type":"final","text":"x"}')}'`);
  await collect(claudeCode({ command, model: "opus", extraArgs: ["--effort", "low"] }).run(turn));
  assert.match(readFileSync(args, "utf8"), /--model opus.*--effort low/);
});

test("a missing command says so plainly in the first event", async () => {
  const events = await collect(claudeCode({ command: "definitely-not-a-real-claude-command" }).run(turn));
  assert.equal(events[0].type, "text");
  assert.match((events[0] as { text: string }).text, /`definitely-not-a-real-claude-command` command was not found/);
  assert.deepEqual(events[1], { type: "done" });
});

test("a failing command, an error envelope and a timeout become text events", async () => {
  const failed = await collect(claudeCode({ command: fakeClaude("cat >/dev/null\necho 'bad flag' >&2\nexit 2") }).run(turn));
  assert.match((failed[0] as { text: string }).text, /failed \(exit 2\).*bad flag/);
  const errored = await collect(claudeCode({ command: fakeClaude(`cat >/dev/null\nprintf '%s' '${envelope("Please log in", { is_error: true })}'`) }).run(turn));
  assert.match((errored[0] as { text: string }).text, /Please log in/);
  const slow = await collect(claudeCode({ command: fakeClaude("sleep 5"), timeoutMs: 200 }).run(turn));
  assert.match((slow[0] as { text: string }).text, /did not answer/);
});

test("one real call, when claude is installed and signed in", async (t) => {
  if (process.env.THIXO_SKIP_REAL_CLAUDE) return t.skip("THIXO_SKIP_REAL_CLAUDE is set");
  const probe = await collect(claudeCode({ timeoutMs: 120_000 }).run({
    system: "You are an assistant for a todo app.",
    tools: [{ name: "add_todo", description: "Add a todo item.", input: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } }],
    messages: [{ role: "user", text: "Add a todo called buy milk." }],
  }));
  const first = probe[0];
  if (first.type === "text" && /was not found|failed/.test(first.text)) return t.skip(first.text);
  assert.equal(first.type, "tool");
  if (first.type === "tool") {
    assert.equal(first.name, "add_todo");
    assert.match(JSON.stringify(first.input).toLowerCase(), /milk/);
  }
});
