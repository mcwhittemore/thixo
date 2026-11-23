import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentEvent, AgentTurn } from "thixo/contract";
import { anthropic, claudeCode, NO_KEY_IN_PRODUCTION } from "../src/node.ts";

const turn: AgentTurn = { system: "s", tools: [], messages: [{ role: "user", text: "hi" }] };

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

const envelope = (result: string) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result });

test("no key in development uses the local claude login and logs it once", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const logs: string[] = [];
    const command = fakeClaude(`cat >/dev/null\nprintf '%s' '${envelope('{"type":"final","text":"from claude"}')}'`);
    const model = anthropic({ local: { command }, log: (line) => logs.push(line), production: false });
    assert.deepEqual(await collect(model.run(turn)), [{ type: "text", text: "from claude" }, { type: "done" }]);
    await collect(model.run(turn));
    assert.equal(logs.length, 1, "one line, however many turns");
    assert.match(logs[0], /no API key.*local `claude` login/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("with a key it calls the API, not the claude command, and logs it", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(String(req.headers.authorization));
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    const events: [string, unknown][] = [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "from api" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    res.end(events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join(""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const logs: string[] = [];
    const model = anthropic({
      apiKey: "sk-test",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      local: { command: "/nonexistent/claude" },
      log: (line) => logs.push(line),
    });
    const events = await collect(model.run(turn));
    assert.deepEqual(events, [{ type: "text", text: "from api" }, { type: "done" }]);
    assert.deepEqual(seen, ["Bearer sk-test"]);
    assert.match(logs.join("\n"), /using the Claude API/);
  } finally {
    server.close();
  }
});

test("no key in production fails with a clear error and never runs claude", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const marker = join(mkdtempSync(join(tmpdir(), "marker-")), "ran");
    const command = fakeClaude(`touch ${marker}`);
    const model = anthropic({ local: { command }, log: () => {}, production: true });
    await assert.rejects(collect(model.run(turn)), { message: NO_KEY_IN_PRODUCTION });
    assert.throws(() => readFileSync(marker), "claude was not run");
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("NODE_ENV=production is what the adapter reads", async () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedEnv = process.env.NODE_ENV;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(collect(anthropic({ log: () => {} }).run(turn)), /production/);
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
  }
});

test("the web-standard entry never imports the process-spawning code", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(index, /node:|claude-code|child_process/);
  assert.equal(typeof claudeCode, "function");
});
