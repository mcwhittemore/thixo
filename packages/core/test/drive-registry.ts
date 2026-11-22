// Prints a driven session of the registry, plugin route, layouts, deploy and plugin data over the fetch handler.
// Run from the repository root: node --import tsx packages/core/test/drive-registry.ts
import { call } from "./helpers/client.js";
import { manifest, pluginFiles, submitOk, world } from "./helpers/registry-doubles.js";

const w = world();
const say = (line: string) => console.log(line);
const show = (label: string, r: { status: number; body: any }) => say(`${label} -> ${r.status}${r.body?.error ? ` ${r.body.error.code}` : ""}`);

const due = manifest({
  requiredEndpoints: ["listTodos"],
  annotations: { todo: [{ name: "dueOn", type: "date" }] },
  stores: { prefs: [{ name: "warnDaysBefore", type: "number" }] },
});
const [ana, ben, cy, boss] = await Promise.all(["ana", "ben", "cy", "boss"].map((u) => w.token(u)));

const v1 = await submitOk(w, "ana", { name: "Due dates", description: "Give a todo a due date", manifest: due });
say(`ana submits: version ${v1.version} of ${v1.plugin.visibility} plugin by ${v1.plugin.author}`);
say(`summary: ${JSON.stringify(v1.summary)}`);
const retype = manifest({ requiredEndpoints: ["listTodos"], annotations: { todo: [{ name: "dueOn", type: "string" }] } });
const refused = await w.thixo.services.registry.submit({ user: w.users.ana, files: pluginFiles({ manifest: retype }), plugin: v1.plugin.id });
say(`ana retypes dueOn: ${refused.ok ? "stored" : refused.errors[0].code}`);

show("ben searches 'due'", await call(w.thixo, "GET", "/_thixo/registry/search?q=due", { token: ben }));
show("ana shares", await call(w.thixo, "POST", `/_thixo/registry/plugins/${v1.plugin.id}/share`, { token: ana }));
const search = await call(w.thixo, "GET", "/_thixo/registry/search?q=due", { token: ben });
say(`ben searches 'due' again: ${search.body.length} found`);
const cySearch = await call(w.thixo, "GET", "/_thixo/registry/search?q=due", { token: cy });
say(`cy searches 'due': ${cySearch.body.length} found (no todos.read)`);

const fork = await call(w.thixo, "POST", `/_thixo/registry/plugins/${v1.plugin.id}/fork`, { token: ben, body: { version: 1 } });
show("ben forks", fork);
const scope = { plugin: v1.plugin.id, version: 1 };
const data = (path: string, token: string, body: unknown) => call(w.thixo, "POST", `/_thixo/data/${path}`, { token, body });
show("ana patches dueOn", await data("patch", ana, { ...scope, record: "todo", id: "t1", fields: { dueOn: "2026-12-01" } }));
show("ana patches undeclared priority", await data("patch", ana, { ...scope, record: "todo", id: "t1", fields: { priority: 1 } }));
const forkScope = { plugin: fork.body.plugin.id, version: 1 };
show("ben reads t1 through his fork", await data("read", ben, { ...forkScope, record: "todo", id: "t1" }));
const js = await w.thixo.fetch(new Request(`http://x/_thixo/plugins/${v1.plugin.id}/1.js`, { headers: { authorization: `Bearer ${ana}` } }));
say(`plugin route: ${js.status} ${js.headers.get("content-type")} ${js.headers.get("cache-control")}`);

const promoted = await call(w.thixo, "POST", `/_thixo/registry/plugins/${v1.plugin.id}/promote`, { token: boss, body: {} });
show("boss promotes", promoted);
const folder = Object.fromEntries(Object.entries(w.adapters.code.changes[0].files).map(([p, t]) => [p.replace(/^plugins\/[^/]+\//, ""), t]));
const release = await w.thixo.services.deploy({ plugins: { [promoted.body.folder]: folder }, layout: { "main/todo-detail": promoted.body.folder }, deployment: "merge-1" });
say(`deploy after the change merges: ${JSON.stringify(release.layout)}`);
const again = await w.thixo.services.deploy({ plugins: { [promoted.body.folder]: folder }, layout: { "main/todo-detail": promoted.body.folder }, deployment: "merge-1" });
say(`deploy again: ${again.id === release.id ? "same release" : "new release"}, versions: ${(await w.adapters.data.listVersions(v1.plugin.id)).length}`);
const layout = await call(w.thixo, "GET", "/_thixo/layout", { token: ben });
say(`ben's layout: ${JSON.stringify(layout.body.resolved)}`);
