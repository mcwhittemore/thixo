import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import type { SlotDef } from "../src/contract.js";
import { createBroker } from "../src/plugin-host/broker.js";
import { createEmit } from "../src/plugin-host/emit.js";
import { buildHostModules } from "../src/plugin-host/host-modules.js";
import { ThixoRefused } from "../src/plugin-host/refused.js";
import { createServices, safeAppPath, safeFileName, safeMimeType, sourceLine, type ShellServiceHost } from "../src/plugin-host/services.js";
import { ScopedStyles, sanitizeStyle, scopeClassFor } from "../src/plugin-host/styles.js";
import { PLUGIN_API_MODULES } from "../src/plugin-api/index.js";
import { Session } from "../src/shell/session.js";
import { createFakeRuntime } from "./helpers/fake-runtime.js";
import { manifest, pluginLoad } from "./helpers/plugins.js";
import { appInfo, fakeServer } from "./helpers/todo-server.js";
import { reachable } from "./helpers/walk.js";

const rt = () => createFakeRuntime({ createElement: React.createElement, Fragment: React.Fragment, modules: {} });

function serviceHost() {
  const calls: { name: string; args: unknown[] }[] = [];
  const host: ShellServiceHost = {
    origin: "https://app.example.com",
    navigate: (...args) => void calls.push({ name: "navigate", args }),
    openModal: (...args) => {
      calls.push({ name: "openModal", args });
      return () => calls.push({ name: "closeModal", args: [] });
    },
    copyToClipboard: async (...args) => void calls.push({ name: "copyToClipboard", args }),
    download: (...args) => void calls.push({ name: "download", args }),
    toast: (...args) => void calls.push({ name: "toast", args }),
  };
  return { calls, host };
}

test("shell services are refused unless the manifest lists them (S8)", async () => {
  const { calls, host } = serviceHost();
  const services = createServices({ manifest: manifest({ slot: "main", shellServices: ["toast"] }), host, pluginName: "P", author: "ana", scopeClass: "s", signal: new AbortController().signal });
  services.toast("hi", { tone: "success" });
  assert.deepEqual(calls, [{ name: "toast", args: ["hi", "success", { pluginName: "P", author: "ana" }] }]);
  for (const call of [() => services.navigate("/todos"), () => services.openModal(null), () => services.download("a.txt", "x")]) {
    assert.throws(call, (error: unknown) => error instanceof ThixoRefused && /not in the plugin version's manifest/.test(error.reason));
  }
  await assert.rejects(services.copyToClipboard("x"), /copyToClipboard refused: it is not in the plugin version's manifest/);
  assert.equal(calls.length, 1);
});

test("navigate goes only to a path inside the app", () => {
  const origin = "https://app.example.com";
  assert.equal(safeAppPath("/todos/42?x=1#top", origin), "/todos/42?x=1#top");
  assert.equal(safeAppPath("/a/../b", origin), "/b");
  for (const outside of ["https://evil.test/", "//evil.test/x", "/\\evil.test", "javascript:alert(1)", "data:text/html,hi", " /x", "todos", "/\nx", "", "\\\\evil"]) {
    assert.throws(() => safeAppPath(outside, origin), ThixoRefused, `refuses ${JSON.stringify(outside)}`);
  }
  assert.throws(() => safeAppPath(42, origin), /must be a string/);

  const { calls, host } = serviceHost();
  const services = createServices({ manifest: manifest({ slot: "main", shellServices: ["navigate"] }), host, pluginName: "P", author: "ana", scopeClass: "s", signal: new AbortController().signal });
  assert.throws(() => services.navigate("https://evil.test/"), /navigate refused/);
  services.navigate("/todos/1");
  assert.deepEqual(calls, [{ name: "navigate", args: ["/todos/1"] }]);
});

test("download makes a safe name and type; modals close when the plugin stops", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("..\\..\\x.bat"), "x.bat");
  assert.equal(safeFileName(".hidden"), "hidden");
  assert.equal(safeFileName('a<b>:"c|?*.csv'), "abc.csv");
  assert.equal(safeFileName(""), "download.txt");
  assert.equal(safeFileName("x".repeat(300)).length, 100);
  assert.equal(safeMimeType("text/html"), "text/plain;charset=utf-8");
  assert.equal(safeMimeType("image/svg+xml"), "text/plain;charset=utf-8");
  assert.equal(safeMimeType("text/csv"), "text/csv;charset=utf-8");
  assert.equal(safeMimeType(undefined), "text/plain;charset=utf-8");

  const controller = new AbortController();
  const { calls, host } = serviceHost();
  const services = createServices({ manifest: manifest({ slot: "main", shellServices: ["download", "openModal"] }), host, pluginName: "P", author: "ana", scopeClass: "s", signal: controller.signal });
  services.download("../report.html", "<script>", "text/html");
  assert.deepEqual(calls[0], { name: "download", args: [{ name: "report.html", content: "<script>", mimeType: "text/plain;charset=utf-8" }] });
  services.openModal("content", { title: "T" });
  controller.abort();
  assert.equal(calls.at(-1)?.name, "closeModal");
  assert.throws(() => services.download("a", "b"), /the plugin has stopped/);
});

test("emit checks the payload against the slot's emits before the shell sees it (S11)", () => {
  const r = rt();
  const delivered: unknown[] = [];
  const emit = createEmit(
    { select: { kind: "object", fields: { todoId: { kind: "string" } } }, open: { kind: "object", fields: { link: { kind: "url" } } } },
    (event, payload) => delivered.push([event, payload]),
    r,
    new AbortController().signal,
  );
  emit.select({ todoId: "1", extra: "dropped" });
  assert.deepEqual(delivered, [["select", { todoId: "1" }]]);
  assert.throws(() => emit.select({ todoId: 1 }), (e: unknown) => e instanceof ThixoRefused && e.endpoint === "emit.select" && /todoId: expected a string, got number/.test(e.reason));
  assert.throws(() => emit.select({}), /todoId: is required/);
  assert.throws(() => emit.select("1"), /expected an object/);
  assert.throws(() => emit.open({ link: "https://evil.test" }), /expected a Url, got string/);
  emit.open({ link: r.url("/todos/1") });
  assert.deepEqual(delivered[1], ["open", { link: "/todos/1" }]);
  assert.equal(delivered.length, 2);
  assert.equal("other" in emit, false, "only declared events exist");
});

test("css() scopes every rule under the plugin's class and drops what could load or break out (P8, L7)", () => {
  const r = rt();
  const styles = new ScopedStyles(scopeClassFor("plg/x y", 3), { rt: r, allowed: new Set(["https://cdn.example.com/a.png"]) });
  assert.equal(styles.scopeClass, "thx-p-plg_x_y-3");
  const name = styles.className({
    paddingTop: 8,
    opacity: 0.5,
    color: "red; } body { display: none",
    background: "url(https://evil.test/leak)",
    backgroundImage: r.url("https://cdn.example.com/a.png"),
    borderImage: r.url("https://evil.test/b.png"),
    "--x": "1",
    "font-family": "x",
    content: "'\\41'",
  });
  assert.match(name, /^thx-c-/);
  const text = styles.text();
  assert.ok(text.startsWith(`.thx-p-plg_x_y-3 .${name} {`), text);
  assert.match(text, /padding-top: 8px;/);
  assert.match(text, /opacity: 0.5;/);
  assert.match(text, /background-image: url\("https\\3a  \/\/cdn.example.com\/a.png"\)|background-image: url\("https:\/\/cdn.example.com\/a.png"\)/);
  for (const banned of ["evil.test", "body", "--x", "font-family", "\\41"]) assert.ok(!text.includes(banned), `${banned} in ${text}`);
  assert.equal(text.split("{").length, 2, "one rule, no injected block");
  assert.deepEqual(sanitizeStyle({ position: "fixed", zIndex: 99999, margin: -100 }), { position: "fixed", zIndex: "99999", margin: "-100px" });
});

test("the host modules are exactly the modules a plugin may import, and every value is a language value", async () => {
  const app = await appInfo();
  const r = rt();
  const load = pluginLoad("p", "P", manifest({ slot: "main" }));
  const main = app.slots.find((s) => s.name === "main") as SlotDef;
  const { host } = serviceHost();
  const broker = createBroker({ load, app, rt: r, request: async () => new Response(null), signal: new AbortController().signal });
  const built = buildHostModules({ rt: r, broker, app, load, slot: main, path: "main", styles: new ScopedStyles("s"), services: host, signal: new AbortController().signal, ChildSlotView: () => null });
  const expected = [...Object.keys(PLUGIN_API_MODULES), "@app/sdk", "@app/sdk/optional", "@app/slots"].sort();
  assert.deepEqual(Object.keys(built.modules).sort(), expected);
  for (const name of ["definePlugin", "useState", "useMemo", "useEffect", "useQuery", "useCan", "useAnnotation", "useAnnotations", "useStore", "useStoreList", "ChildSlot", "css"]) {
    assert.ok(name in built.modules["thixo/plugin"], name);
  }
  for (const name of ["Stack", "Text", "Button", "TextInput", "NumberInput", "DateInput", "Checkbox", "Select", "Badge", "Card", "tokens"]) assert.ok(name in built.modules["thixo/ui"], name);
  for (const name of ["navigate", "openModal", "copyToClipboard", "download", "toast"]) assert.ok(name in built.modules["thixo/services"], name);
  assert.deepEqual(Object.keys(built.modules["@app/sdk"]).sort(), ["Todo", "createTodo", "deleteTodo", "getTodo", "listAssignees", "listTodos", "updateTodo"]);
  assert.deepEqual(Object.keys(built.modules["@app/slots"]).sort(), ["main", "todoDetail", "todoRow"]);
  for (const m of Object.values(built.modules)) r.toThx(m);
  const { t } = built.modules["thixo/schema"] as { t: Record<string, () => unknown> };
  assert.deepEqual(t.date(), { kind: "date" });
  const { annotate, store } = built.modules["thixo/data"] as Record<string, (...a: unknown[]) => unknown>;
  assert.deepEqual(annotate(built.modules["@app/sdk"].Todo, { dueOn: t.date() }), { $annotation: "todo" });
  assert.deepEqual(store("prefs", { fields: {} }), { $store: "prefs" });
  assert.throws(() => annotate({}, {}), /expected a record exported from @app\/sdk/);
});

test("the token is unreachable from every value handed to a plugin (P5)", async () => {
  const server = fakeServer({ user: "ben", versions: [], layout: {} });
  const session = await Session.start({ fetch: server.fetch });
  const app = await appInfo();
  const r = rt();
  const m = manifest({ slot: "main", requiredEndpoints: ["listTodos", "getTodo"], shellServices: ["toast"], data: { stores: { prefs: [{ name: "n", type: "number" }] }, annotations: {} } });
  const load = pluginLoad("p", "P", m);
  const controller = new AbortController();
  const broker = createBroker({ load, app, rt: r, request: session.request, signal: controller.signal });
  const { host } = serviceHost();
  const built = buildHostModules({ rt: r, broker, app, load, slot: app.slots.find((s) => s.name === "main")!, path: "main", styles: new ScopedStyles("s"), services: host, signal: controller.signal, ChildSlotView: () => null });
  const sdk = built.modules["@app/sdk"] as Record<string, (input?: unknown) => Promise<unknown>>;
  const results = [await sdk.listTodos(), await sdk.getTodo({ id: "1" }).catch((e: unknown) => e), await broker.data.read({ store: "prefs", id: "default" }).catch((e: unknown) => e)];
  await sdk.createTodo({ title: "x" }).catch((e: unknown) => results.push(e));

  const token = server.requests.map((q) => q.authorization).find((a) => a?.startsWith("Bearer "))!.slice("Bearer ".length);
  assert.ok(token.length > 20);
  const { strings, objects } = reachable([built.modules, results, r.handedIn]);
  assert.ok(objects.size > 50, `walked ${objects.size} objects`);
  assert.equal(strings.filter((s) => s.includes(token)).length, 0, "the token string is reachable");
  assert.equal(objects.has(session), false, "the session is reachable");
  assert.equal(objects.has(session.request), false, "the authorized request is reachable");
  assert.ok(results.some((x) => x instanceof ThixoRefused), "a refusal was among the values walked");
  session.end();
});

test("a plugin's dialog and notices carry which plugin sent them, apart from what the plugin chose (redteam-social round 2)", () => {
  const { calls, host } = serviceHost();
  const services = createServices({ manifest: manifest({ slot: "main", shellServices: ["openModal", "toast"] }), host, pluginName: "Reminder", author: "ana", scopeClass: "s", signal: new AbortController().signal });
  services.openModal("form", { title: "Session expired" });
  const [, options] = calls[0].args as [unknown, { title: string; source: { pluginName: string; author: string } }];
  assert.equal(options.title, "Session expired");
  assert.deepEqual(options.source, { pluginName: "Reminder", author: "ana" });
  assert.equal(sourceLine(options.source), "From the plugin “Reminder”, by ana");
  assert.equal(sourceLine({ pluginName: "Due dates", author: "implementor" }), "From the plugin “Due dates”, one of this app's own");
  services.toast("Sign in again", {});
  assert.deepEqual(calls[1].args[2], { pluginName: "Reminder", author: "ana" });
});
