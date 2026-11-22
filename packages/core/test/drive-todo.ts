// Drives the todo example's server the way the shell would, and prints what came back. Used by the verification
// skill: `node --import tsx packages/core/test/drive-todo.ts`. No network: it calls the fetch handler directly.
import * as scopes from "../../../examples/todo/api/scopes.js";
import * as session from "../../../examples/todo/api/session.js";
import * as todos from "../../../examples/todo/api/todos.js";
import * as slots from "../../../examples/todo/app/slots.js";
import { collectApp, createThixo } from "../src/server/index.js";
import { memoryAdapters } from "./helpers/adapters.js";
import { loadSdk } from "./helpers/client.js";

const thixo = createThixo(collectApp([scopes, session, todos, slots] as Record<string, unknown>[], {}), {
  identity: {
    identify: async (request) => {
      const s = await session.readSession(request);
      return s && { id: s.userId, scopes: s.scopes, groups: s.groups };
    },
    scopesOf: session.scopesOf,
  },
  adapters: memoryAdapters(),
  layout: {},
});

const origin = "http://localhost";
async function send(label: string, method: string, path: string, init: { cookie?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body) headers["content-type"] = "application/json";
  const response = await thixo.fetch(new Request(origin + path, { method, headers, body: init.body ? JSON.stringify(init.body) : undefined }));
  const text = await response.text();
  console.log(`${label}: ${method} ${path} -> ${response.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : undefined;
}

const token = async (who: string) => (await send(`token for ${who}`, "POST", "/_thixo/token", { cookie: `thixo-user=${who}` })).token as string;

await send("no cookie", "POST", "/_thixo/token");
const cy = await token("cy");
await send("cy lists", "GET", "/api/todos", { token: cy });
await send("cy creates", "POST", "/api/todos", { token: cy, body: { title: "x" } });
await send("cy assignees", "GET", "/api/assignees", { token: cy });
const ana = await token("ana");
const made = await send("ana creates", "POST", "/api/todos", { token: ana, body: { title: "Water the plants" } });
await send("ana deletes", "DELETE", `/api/todos/${made.id}`, { token: ana });
const ben = await token("ben");
await send("ben deletes", "DELETE", `/api/todos/${made.id}`, { token: ben });
await send("ben reads it again", "GET", `/api/todos/${made.id}`, { token: ben });
await send("app", "GET", "/_thixo/app");

const sdk = await loadSdk(await (await thixo.fetch(new Request(`${origin}/_thixo/sdk.js`))).text());
console.log("sdk functions:", Object.keys(sdk).join(", "));
const options = { token: ana, baseUrl: origin, fetch: (url: string, init: RequestInit) => thixo.fetch(new Request(url, init)) };
console.log("sdk listTodos:", JSON.stringify(await sdk.listTodos(undefined, options)).slice(0, 120));
try {
  await sdk.deleteTodo({ id: "todo-1" }, options);
} catch (error) {
  console.log("sdk deleteTodo as ana threw:", (error as Error & { status: number }).status, (error as Error).message);
}
