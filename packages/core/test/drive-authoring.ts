// Prints a driven authoring session over the fetch handler: a scripted model builds a plugin through the chat route,
// then an outside agent calls the tool route with and without the key.
// Run from the repository root: node --import tsx packages/core/test/drive-authoring.ts
import { scriptedModel } from "../src/server/index.js";
import { ORIGIN } from "./helpers/client.js";
import { authoringWorld, ndjson } from "./helpers/authoring-world.js";
import { manifest, pluginFiles } from "./helpers/registry-doubles.js";

const due = manifest({ requiredEndpoints: ["listTodos"], annotations: { todo: [{ name: "dueOn", type: "date" }] } });
const broken = pluginFiles({ manifest: due, note: "@error" });
const fixed = pluginFiles({ manifest: due, name: "Due dates", description: "Give a todo a due date." });
const say = (line: string) => console.log(line);

const model = scriptedModel([
  { text: "Looking first.", toolCalls: [{ name: "search_registry", input: { query: "due" } }] },
  { toolCalls: [{ name: "check", input: { files: broken } }] },
  { toolCalls: [{ name: "check", input: { files: fixed } }] },
  { toolCalls: [{ name: "submit", input: { files: fixed } }] },
  (turn) => {
    const { plugin, version } = JSON.parse((turn.messages.at(-1) as { output: string }).output);
    return { toolCalls: [{ name: "use", input: { plugin, version, slot: "todo-detail" } }] };
  },
  "Due dates puts a due date on each todo. It reads todos and keeps its own data.",
]);
const w = authoringWorld({ model, agentKey: "drive-key" });

const token = await w.token("ana");
const chat = await w.thixo.fetch(new Request(`${ORIGIN}/_thixo/authoring/chat`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ message: "put a due date on todos" }) }));
say(`chat -> ${chat.status} ${chat.headers.get("content-type")}`);
for (const e of await ndjson(chat)) {
  if (e.type === "text") say(`text: ${e.text}`);
  else if (e.type === "tool") say(`tool: ${e.name}`);
  else if (e.type === "tool_result") say(`result: ${e.name} ok=${e.ok} ${e.output.slice(0, 70)}`);
  else if (e.type === "error") say(`error: ${e.message}`);
  else say("done");
}

const tool = async (headers: Record<string, string>, body: unknown) => {
  const r = await w.thixo.fetch(new Request(`${ORIGIN}/_thixo/authoring/tool`, { method: "POST", headers, body: JSON.stringify(body) }));
  return `${r.status} ${((await r.clone().json()) as any).error?.code ?? "ok"}`;
};
say(`tool without key -> ${await tool({}, { tool: "describe_app", as: "ana" })}`);
say(`tool with wrong key -> ${await tool({ "x-thixo-agent-key": "nope" }, { tool: "describe_app", as: "ana" })}`);
say(`tool with key -> ${await tool({ "x-thixo-agent-key": "drive-key" }, { tool: "describe_app", as: "ana" })}`);
say(`chat as cy (no author scope) -> ${(await w.thixo.fetch(new Request(`${ORIGIN}/_thixo/authoring/chat`, { method: "POST", headers: { authorization: `Bearer ${await w.token("cy")}` }, body: JSON.stringify({ message: "x" }) }))).status}`);
