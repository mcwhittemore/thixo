import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentEvent, AgentTurn } from "thixo/contract";
import { anthropic, toMessages, MISSING_KEY_MESSAGE } from "../src/index.ts";

type Reply = { status: number; body: string };
let server: Server;
let baseUrl: string;
let requests: { headers: Record<string, unknown>; body: any }[] = [];
let reply: Reply = { status: 200, body: "" };

const sse = (events: [string, unknown][]) =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");

const start = (): [string, unknown][] => [
  ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
];

const end = (stopReason: string): [string, unknown][] => [
  ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
  ["message_stop", { type: "message_stop" }],
];

const textBlock = (index: number, parts: string[]): [string, unknown][] => [
  ["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }],
  ...parts.map((text): [string, unknown] => ["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text } }]),
  ["content_block_stop", { type: "content_block_stop", index }],
];

const toolBlock = (index: number, id: string, name: string, json: string[]): [string, unknown][] => [
  ["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } }],
  ...json.map((partial_json): [string, unknown] => ["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json } }]),
  ["content_block_stop", { type: "content_block_stop", index }],
];

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.writeHead(reply.status, { "content-type": reply.status === 200 ? "text/event-stream" : "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

const turn: AgentTurn = {
  system: "You write plugins.",
  messages: [{ role: "user", text: "Make a clock" }],
  tools: [{ name: "write_file", description: "Write a file", input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
};

async function collect(it: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function model() {
  requests = [];
  return anthropic({ apiKey: "test-key", baseUrl });
}

test("text deltas stream as text events, then done", async () => {
  reply = { status: 200, body: sse([...start(), ...textBlock(0, ["Hel", "lo ", "there"]), ...end("end_turn")]) };
  const events = await collect(model().run(turn));
  assert.deepEqual(events, [
    { type: "text", text: "Hel" },
    { type: "text", text: "lo " },
    { type: "text", text: "there" },
    { type: "done" },
  ]);
});

test("the request carries the system prompt, messages, tools, key and a streaming flag", async () => {
  reply = { status: 200, body: sse([...start(), ...end("end_turn")]) };
  await collect(model().run(turn));
  const [{ headers, body }] = requests;
  assert.equal(headers.authorization, "Bearer test-key");
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 16000);
  assert.equal(body.system, "You write plugins.");
  assert.deepEqual(body.messages, [{ role: "user", content: [{ type: "text", text: "Make a clock" }] }]);
  assert.equal(body.tools[0].name, "write_file");
  assert.equal(body.tools[0].input_schema.type, "object");
  assert.deepEqual(body.tools[0].input_schema.required, ["path"]);
  assert.equal(body.tool_choice, undefined);
});

test("model and maxTokens options reach the request", async () => {
  reply = { status: 200, body: sse([...start(), ...end("end_turn")]) };
  requests = [];
  await collect(anthropic({ apiKey: "k", baseUrl, model: "claude-sonnet-5-5", maxTokens: 123 }).run(turn));
  assert.equal(requests[0].body.model, "claude-sonnet-5-5");
  assert.equal(requests[0].body.max_tokens, 123);
});

test("one tool call arrives complete with parsed input", async () => {
  reply = {
    status: 200,
    body: sse([...start(), ...textBlock(0, ["On it."]), ...toolBlock(1, "toolu_1", "write_file", ['{"pa', 'th": "plugin.thx"}']), ...end("tool_use")]),
  };
  const events = await collect(model().run(turn));
  assert.deepEqual(events, [
    { type: "text", text: "On it." },
    { type: "tool", id: "toolu_1", name: "write_file", input: { path: "plugin.thx" } },
    { type: "done" },
  ]);
});

test("two tool calls in one turn each arrive complete, in order", async () => {
  reply = {
    status: 200,
    body: sse([
      ...start(),
      ...toolBlock(0, "toolu_a", "write_file", ['{"path":"a.thx"}']),
      ...toolBlock(1, "toolu_b", "write_file", ['{"path"', ':"b.thx"}']),
      ...end("tool_use"),
    ]),
  };
  const events = await collect(model().run(turn));
  assert.deepEqual(events, [
    { type: "tool", id: "toolu_a", name: "write_file", input: { path: "a.thx" } },
    { type: "tool", id: "toolu_b", name: "write_file", input: { path: "b.thx" } },
    { type: "done" },
  ]);
});

test("a tool call with no arguments has an empty object as input", async () => {
  reply = { status: 200, body: sse([...start(), ...toolBlock(0, "toolu_1", "list_files", []), ...end("tool_use")]) };
  const events = await collect(model().run(turn));
  assert.deepEqual(events[0], { type: "tool", id: "toolu_1", name: "list_files", input: {} });
});

test("tool calls and results go back as tool_use and one tool_result user message", async () => {
  reply = { status: 200, body: sse([...start(), ...textBlock(0, ["ok"]), ...end("end_turn")]) };
  const next: AgentTurn = {
    ...turn,
    messages: [
      { role: "user", text: "Make a clock" },
      { role: "assistant", text: "On it.", toolCalls: [{ id: "toolu_a", name: "write_file", input: { path: "a" } }, { id: "toolu_b", name: "write_file", input: { path: "b" } }] },
      { role: "tool", id: "toolu_a", name: "write_file", output: "wrote a" },
      { role: "tool", id: "toolu_b", name: "write_file", output: "wrote b" },
    ],
  };
  await collect(model().run(next));
  assert.deepEqual(requests[0].body.messages, [
    { role: "user", content: [{ type: "text", text: "Make a clock" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "On it." },
        { type: "tool_use", id: "toolu_a", name: "write_file", input: { path: "a" } },
        { type: "tool_use", id: "toolu_b", name: "write_file", input: { path: "b" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_a", content: "wrote a" },
        { type: "tool_result", tool_use_id: "toolu_b", content: "wrote b" },
      ],
    },
  ]);
});

test("an assistant message with no text and no calls is dropped", () => {
  assert.deepEqual(toMessages([{ role: "user", text: "hi" }, { role: "assistant", text: "" }]), [
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ]);
});

test("an API error rejects with the status and message", async () => {
  reply = { status: 401, body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) };
  await assert.rejects(collect(model().run(turn)), (e: any) => {
    assert.equal(e.status, 401);
    assert.match(e.message, /invalid x-api-key/);
    return true;
  });
});

test("an error event inside the stream rejects", async () => {
  reply = {
    status: 200,
    body: sse([...start(), ...textBlock(0, ["Hi"]), ["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]]),
  };
  await assert.rejects(collect(model().run(turn)), /Overloaded/);
});

test("a refusal and a cut-off reply are said in text", async () => {
  reply = { status: 200, body: sse([...start(), ...end("refusal")]) };
  assert.deepEqual(await collect(model().run(turn)), [
    { type: "text", text: "The model declined to answer this request." },
    { type: "done" },
  ]);
  reply = { status: 200, body: sse([...start(), ...textBlock(0, ["Half"]), ...end("max_tokens")]) };
  const events = await collect(model().run(turn));
  assert.equal(events.length, 3);
  assert.match((events[1] as { text: string }).text, /cut off/);
});

test("with no key it says so in one text event and then done", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    requests = [];
    const events = await collect(anthropic({ baseUrl }).run(turn));
    assert.deepEqual(events, [{ type: "text", text: MISSING_KEY_MESSAGE }, { type: "done" }]);
    assert.equal(requests.length, 0);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("the key comes from ANTHROPIC_API_KEY when no option is given", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "env-key";
  try {
    reply = { status: 200, body: sse([...start(), ...end("end_turn")]) };
    requests = [];
    await collect(anthropic({ baseUrl }).run(turn));
    assert.equal(requests[0].headers.authorization, "Bearer env-key");
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});
