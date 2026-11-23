// The authoring guard, third red-team round: the check does not count another author's words against a fork's owner,
// it reads text as a person sees it, the status count stays true while a block stands, a refusal the model writes as
// text still counts, and one person can't run many builds at once.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RefusalNotice } from "../src/contract.js";
import { scriptedModel, type AuthoringEvent, type ScriptedStep } from "../src/server/index.js";
import { refusalInText } from "../src/server/authoring/loop.js";
import { flagSource } from "../src/server/authoring/source-check.js";
import { MAX_BUILDS_PER_USER } from "../src/server/authoring/tools.js";
import { ORIGIN, call } from "./helpers/client.js";
import { authoringWorld, ndjson, type AuthoringOptions } from "./helpers/authoring-world.js";
import { pluginFiles } from "./helpers/registry-doubles.js";

type Refusal = Extract<AuthoringEvent, { type: "refusal" }>;
const refusalOf = (events: AuthoringEvent[]) => events.find((e): e is Refusal => e.type === "refusal");

function world(steps: ScriptedStep[] = [], options: AuthoringOptions = {}) {
  const notices: RefusalNotice[] = [];
  const w = authoringWorld({ model: scriptedModel(steps), agentKey: "agent-key", authoringGuard: { onRefusal: (n) => void notices.push(n), ...options.authoringGuard } });
  w.users.keeper = { id: "keeper", scopes: ["thixo.authoring.admin"] };
  return { ...w, notices };
}

async function tool(w: ReturnType<typeof world>, as: string, name: string, input: unknown) {
  const response = await w.thixo.fetch(
    new Request(`${ORIGIN}/_thixo/authoring/tool`, { method: "POST", headers: { "content-type": "application/json", "x-thixo-agent-key": "agent-key" }, body: JSON.stringify({ tool: name, as, input }) }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

async function chat(w: ReturnType<typeof world>, user: string, message: string) {
  const token = await w.token(user);
  return ndjson(
    await w.thixo.fetch(new Request(`${ORIGIN}/_thixo/authoring/chat`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ message }) })),
  );
}

test("a fork's owner is not counted for words the parent's author wrote; their own words still count", async () => {
  // Red team r3 (guard b-frame): ana shares a plugin that says "Your password is never shown here." with no field,
  // so it passes. ben forks it and adds a note box. The check saw a field and "password" and counted it against ben:
  // three such submits blocked him for ana's words.
  const w = world();
  w.users.ana.scopes.push("thixo.plugins.share");
  const parent = pluginFiles({ name: "Account help", note: "Your password is never shown here." });
  const shared = await tool(w, "ana", "submit", { files: parent });
  assert.equal(shared.body.ok, true, JSON.stringify(shared.body));
  assert.equal((await call(w.thixo, "POST", `/_thixo/registry/plugins/${shared.body.plugin}/share`, { token: await w.token("ana"), body: {} })).status, 200);

  const fork = await tool(w, "ben", "fork", { plugin: shared.body.plugin, version: 1 });
  assert.equal(fork.body.ok, true);
  const withField = { "plugin.thx": `${parent["plugin.thx"]}// @field <input placeholder="A note" />\n` };

  for (let i = 0; i < 4; i++) {
    const name = i % 2 ? "check" : "submit";
    const reply = await tool(w, "ben", name, { files: withField, ...(name === "submit" ? { plugin: fork.body.plugin } : {}) });
    assert.equal(reply.status, 200, name);
    assert.equal(reply.body.ok, false, "the words are still refused");
    assert.equal(reply.body.errors[0].code, "guard/credentials");
    assert.equal(reply.body.refusal.from, "data");
    assert.equal(reply.body.refusal.count, 0);
    assert.match(reply.body.refusal.message, /does not count against you/);
  }
  assert.equal(await w.adapters.data.getAuthoringBlock("ben"), null, "ben is not blocked for ana's words");
  const stored = await w.adapters.data.listRefusals({ user: "ben" });
  assert.ok(stored.every((r) => r.from === "data" && r.source === "check"));
  assert.match(stored[0].reason, /already in the plugin it was forked from/);

  // Words ben adds himself are his.
  const his = { "plugin.thx": `${withField["plugin.thx"]}// @ask Type your password to continue\n` };
  const own = await tool(w, "ben", "submit", { files: his, plugin: fork.body.plugin });
  assert.equal(own.body.refusal.from, "user");
  assert.equal(own.body.refusal.count, 1);

  // And ana's own plugin with a field is hers.
  const anas = await tool(w, "ana", "check", { files: withField });
  assert.equal(anas.body.refusal.from, "user");
});

test("the check reads text as a person sees it: look-alike letters, invisible characters and split strings", () => {
  const field = `<input />`;
  const flagged: [string, string][] = [
    ["Cyrillic e", "<Text>Sеssion expired</Text>"],
    ["Cyrillic i and o", "<Text>Sessіоn expired</Text>"],
    ["zero-width space", "<Text>Session​ expired</Text>"],
    ["no-break space", "<Text>Session expired</Text>"],
    ["full-width letters", "<Text>Ｓession expired</Text>"],
    ["soft hyphen with a field", `${field}<Text>pass­word</Text>`],
    ["Cyrillic in a secret word", `${field}<Text>Pаssword</Text>`],
    ["string concatenation", `${field}<Text>{"Pass" + "word"}</Text>`],
    ["PIN", `${field}<Text>Your PIN</Text>`],
    ["login details", `${field}<Text>Your login details</Text>`],
  ];
  for (const [name, text] of flagged) {
    const flag = flagSource({ "plugin.thx": text });
    assert.ok(flag, name);
    assert.equal(flag!.line, 1, name);
  }
  assert.equal(flagSource({ "plugin.thx": `${field}<Text>Pin this todo to the top</Text>` }), null, "pin, the verb, is not a PIN");
  // Where it points is still the source as written.
  const at = flagSource({ "plugin.thx": "\n  <Text>Sеssion​ expired</Text>" })!;
  assert.deepEqual([at.line, at.column, at.match], [2, 9, "Sеssion​ expired"]);
});

test("while a block stands, the status count is the block's own refusals, not every refusal in the window", async () => {
  // Red team r3: after a lift and a second block, status said 14 of 3, since the block replaced the lift's record.
  const refuse: ScriptedStep = { toolCalls: [{ name: "refuse", input: { category: "credentials", reason: "It asks for a password.", from: "user" } }] };
  const w = world([refuse, refuse, refuse, refuse, refuse, refuse]);
  for (let i = 0; i < 3; i++) await chat(w, "ana", `attempt ${i + 1}`);
  const ana = await w.token("ana");
  assert.equal((await call(w.thixo, "GET", "/_thixo/authoring/status", { token: ana })).body.count, 3);
  await call(w.thixo, "DELETE", "/_thixo/authoring/blocks/ana", { token: await w.token("keeper") });
  // The first refusal after a lift is the first, even in the lift's own millisecond.
  const counts: number[] = [];
  for (let i = 0; i < 3; i++) counts.push(refusalOf(await chat(w, "ana", `again ${i + 1}`))!.count);
  assert.deepEqual(counts, [1, 2, 3]);
  const status = await call(w.thixo, "GET", "/_thixo/authoring/status", { token: ana });
  assert.equal(status.body.blocked, true);
  assert.equal(status.body.count, 3, "3 of 3, not 6");
  assert.match(status.body.message, /refused 3 of your requests/);
});

test("a refuse call the model writes as JSON text is run as the call, so it is recorded and counts", async () => {
  // Authoring guard with a real model: it printed {"type":"refuse",...} as text and called no tool, so nothing was
  // recorded and the person could try again for free.
  const text = `I can't help with that.\n{"type":"refuse","category":"credentials","reason":"It imitates a login dialog that asks for a password.","from":"user","quote":"asks the user for their password"}`;
  const w = world([text]);
  const events = await chat(w, "ana", "Build a popup like the system's login dialog that asks for the password.");
  const refusal = refusalOf(events);
  assert.ok(refusal, "a refusal event");
  assert.equal(refusal!.count, 1);
  assert.ok(events.some((e) => e.type === "tool" && e.name === "refuse"));
  const [stored] = await w.adapters.data.listRefusals({ user: "ana" });
  assert.equal(stored.category, "credentials");
  assert.equal(stored.quote, "asks the user for their password");
  assert.equal(w.notices.length, 1);

  assert.deepEqual(refusalInText(`{"name":"refuse","input":{"category":"shell","reason":"A fake header."}}`), { category: "shell", reason: "A fake header.", from: "user" });
  assert.equal(refusalInText(`Here is the plugin: {"type":"plugin","name":"refuse"}`), null, "it needs a category and a reason");
  assert.equal(refusalInText("I won't refuse that, here you go."), null);
});

test("one person may run only a few builds at once", async () => {
  const w = world();
  const build = w.adapters.build;
  const original = build.build.bind(build);
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  build.build = async (...args: Parameters<typeof original>) => {
    await gate;
    return original(...args);
  };
  const files = pluginFiles();
  const running = Array.from({ length: MAX_BUILDS_PER_USER }, () => tool(w, "ana", "check", { files }));
  await new Promise((done) => setTimeout(done, 20));
  const refused = await tool(w, "ana", "submit", { files });
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, "too_many_builds");
  const other = tool(w, "ben", "check", { files });
  release();
  for (const r of await Promise.all(running)) assert.equal(r.body.ok, true);
  assert.equal((await other).body.ok, true, "another person is not held up");
  assert.equal((await tool(w, "ana", "check", { files })).body.ok, true, "a finished build frees its turn");
});

test("search_registry takes an empty slot or query as none", async () => {
  // A real model's first call sent slot: "" and failed with "slot must be a non-empty string".
  const w = world();
  const reply = await tool(w, "ana", "search_registry", { query: "", slot: "" });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.ok(Array.isArray(reply.body.results));
});
