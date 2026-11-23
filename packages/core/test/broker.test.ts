import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import type { AppInfo } from "../src/contract.js";
import { createBroker, type AuthorizedRequest } from "../src/plugin-host/broker.js";
import { ThixoCallError, ThixoRefused } from "../src/plugin-host/refused.js";
import { Session } from "../src/shell/session.js";
import { createFakeRuntime } from "./helpers/fake-runtime.js";
import { manifest, pluginLoad } from "./helpers/plugins.js";
import { appInfo, fakeServer } from "./helpers/todo-server.js";

const rt = () => createFakeRuntime({ createElement: React.createElement, Fragment: React.Fragment, modules: {} });

/** A request function that answers from a table and records every call. */
function recorder(answer: (path: string, init: RequestInit) => Response = () => new Response("null")) {
  const calls: { path: string; init: RequestInit }[] = [];
  const request: AuthorizedRequest = async (path, init) => {
    calls.push({ path, init });
    return answer(path, init);
  };
  return { calls, request };
}

const linkApp: AppInfo = {
  scopes: { "links.read": "Read links", "links.write": "Save links" },
  endpoints: [
    {
      name: "saveLink",
      method: "POST",
      path: "/links",
      scopes: ["links.write"],
      input: { kind: "object", fields: { href: { kind: "url" }, title: { kind: "string" } } },
      output: { kind: "record", name: "link" },
    },
    {
      name: "getLink",
      method: "GET",
      path: "/links/:id",
      scopes: ["links.read"],
      input: { kind: "object", fields: { id: { kind: "string" } } },
      output: { kind: "record", name: "link" },
    },
    { name: "payroll", method: "POST", path: "/payroll", scopes: ["links.write"] },
  ],
  records: [{ name: "link", exportName: "Link", read: ["links.read"], fields: { id: { kind: "string" }, href: { kind: "url" }, seenAt: { kind: "date" } } }],
  slots: [],
  libraries: [],
};

const linkManifest = manifest({
  slot: "main",
  requiredEndpoints: ["saveLink", "getLink"],
  data: { stores: { prefs: [{ name: "home", type: "url" }, { name: "since", type: "date" }, { name: "tags", type: "string[]" }] }, annotations: {} },
});

test("an endpoint outside the manifest is refused without touching the network (P1)", async () => {
  const { calls, request } = recorder();
  const broker = createBroker({ load: pluginLoad("p", "P", linkManifest), app: linkApp, rt: rt(), request, signal: new AbortController().signal });
  await assert.rejects(broker.call("payroll", {}), (error: unknown) => {
    assert.ok(error instanceof ThixoRefused);
    assert.equal(error.endpoint, "payroll");
    assert.match(error.reason, /not in the plugin version's manifest/);
    return true;
  });
  await assert.rejects(broker.call("nope", {}), ThixoRefused);
  assert.equal(calls.length, 0);
  assert.equal(broker.can("payroll"), false);
});

test("an endpoint the author can't call is refused without touching the network (P3)", async () => {
  const { calls, request } = recorder();
  const load = pluginLoad("p", "P", linkManifest, { authorCan: ["getLink"] });
  const broker = createBroker({ load, app: linkApp, rt: rt(), request, signal: new AbortController().signal });
  await assert.rejects(broker.call("saveLink", { title: "x" }), (error: unknown) => {
    assert.ok(error instanceof ThixoRefused);
    assert.equal(error.endpoint, "saveLink");
    assert.match(error.reason, /author does not hold/);
    return true;
  });
  assert.equal(calls.length, 0);
  assert.equal(broker.can("saveLink"), false);
  assert.equal(broker.can("getLink"), true);
});

test("an optional endpoint the user can't call is refused without a request (P2, P4)", async () => {
  const { calls, request } = recorder();
  const m = manifest({ slot: "main", requiredEndpoints: ["getLink"], optionalEndpoints: ["saveLink"] });
  const load = pluginLoad("p", "P", m, { userCan: ["getLink"] });
  const broker = createBroker({ load, app: linkApp, rt: rt(), request, signal: new AbortController().signal });
  await assert.rejects(broker.call("saveLink", {}), /the user can't call this optional endpoint/);
  assert.equal(calls.length, 0);
  assert.equal(broker.can("saveLink"), false);
});

test("url fields: a Url goes out as its address, a string is refused, and a reply's url fields come back as Urls", async () => {
  const r = rt();
  const { calls, request } = recorder(() => Response.json({ id: "l1", href: "https://example.com/a", seenAt: "2026-11-20T10:00:00.000Z", extra: "dropped" }));
  const broker = createBroker({ load: pluginLoad("p", "P", linkManifest), app: linkApp, rt: r, request, signal: new AbortController().signal });

  await assert.rejects(broker.call("saveLink", { href: "https://evil.test/?leak=1", title: "x" }), (error: unknown) => {
    assert.ok(error instanceof ThixoRefused);
    assert.match(error.reason, /href: expected a Url, got string/);
    return true;
  });
  assert.equal(calls.length, 0, "a bad input never reaches the network");

  const saved = (await broker.call("saveLink", { href: r.url("https://example.com/a"), title: "A" })) as Record<string, unknown>;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/links");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { href: "https://example.com/a", title: "A" });
  assert.ok(r.isUrl(saved.href), "href is a Url");
  assert.equal(r.unwrapUrl(saved.href as never), "https://example.com/a");
  assert.ok(saved.seenAt instanceof Date);
  assert.equal((saved.seenAt as Date).toISOString(), "2026-11-20T10:00:00.000Z");
  assert.equal("extra" in saved, false);
  assert.ok(Object.isFrozen(saved));

  await broker.call("getLink", { id: "a b" });
  assert.equal(calls[1].path, "/api/links/a%20b");
  assert.equal(calls[1].init.method, "GET");
});

test("plugin data: urls cross as { $url }, a plain string is never a url, and dates are ISO strings", async () => {
  const r = rt();
  const { calls, request } = recorder((path) => {
    if (path === "/_thixo/data/read") return Response.json({ fields: { home: { $url: "https://example.com/" }, since: "2026-01-02T00:00:00.000Z", tags: ["a"], unknown: 1 } });
    if (path === "/_thixo/data/list") return Response.json({ ids: ["a", 3, "b"] });
    return new Response(null, { status: 204 });
  });
  const broker = createBroker({ load: pluginLoad("p", "P", linkManifest), app: linkApp, rt: r, request, signal: new AbortController().signal });

  await broker.data.patch({ store: "prefs", id: "default" }, { home: r.url("https://example.com/"), since: new Date("2026-01-02T00:00:00.000Z"), tags: ["x"] });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    plugin: "p",
    version: 1,
    at: { store: "prefs", id: "default" },
    fields: { home: { $url: "https://example.com/" }, since: "2026-01-02T00:00:00.000Z", tags: ["x"] },
  });

  await assert.rejects(broker.data.patch({ store: "prefs", id: "default" }, { home: "https://evil.test/" }), /home: expected a Url, got string/);
  await assert.rejects(broker.data.patch({ store: "prefs", id: "default" }, { nope: 1 }), /nope: is not a field this plugin version declares/);
  await assert.rejects(broker.data.read({ store: "other", id: "default" }), /declares no store "other"/);
  await assert.rejects(broker.data.read({ record: "todo", id: "1" }), /declares no annotation on "todo"/);
  assert.equal(calls.length, 1, "refused data calls never reach the network");

  const read = await broker.data.read({ store: "prefs", id: "default" });
  assert.ok(r.isUrl(read.home));
  assert.equal(r.unwrapUrl(read.home as never), "https://example.com/");
  assert.ok(read.since instanceof Date);
  assert.deepEqual(read.tags, ["a"]);
  assert.equal("unknown" in read, false);

  const plainString = createBroker({
    load: pluginLoad("p", "P", linkManifest),
    app: linkApp,
    rt: r,
    request: async () => Response.json({ fields: { home: "https://evil.test/" } }),
    signal: new AbortController().signal,
  });
  assert.deepEqual(await plainString.data.read({ store: "prefs", id: "default" }), {}, "a string in a url field is dropped");
  assert.deepEqual(await broker.data.list("prefs"), ["a", "b"]);
});

test("plugin data needs the author's data scopes (P3, D11)", async () => {
  const { calls, request } = recorder();
  const load = pluginLoad("p", "P", linkManifest, { authorData: { read: true, write: false } });
  const broker = createBroker({ load, app: linkApp, rt: rt(), request, signal: new AbortController().signal });
  await assert.rejects(broker.data.patch({ store: "prefs", id: "default" }, {}), /does not hold thixo.data.write/);
  await assert.rejects(broker.data.remove("prefs", "default"), /does not hold thixo.data.write/);
  assert.equal(calls.length, 0);
});

test("a stopped plugin's pending call is cancelled and later calls are refused (P7)", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const request: AuthorizedRequest = (_path, init) =>
    new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      release = () => resolve(Response.json({ id: "l1", href: "/x", seenAt: "2026-01-01" }));
    });
  const broker = createBroker({ load: pluginLoad("p", "P", linkManifest), app: linkApp, rt: rt(), request, signal: controller.signal });
  const pending = broker.call("getLink", { id: "1" });
  controller.abort();
  release();
  await assert.rejects(pending, /the plugin has stopped/);
  await assert.rejects(broker.call("getLink", { id: "1" }), /the plugin has stopped/);
  await assert.rejects(broker.data.read({ store: "prefs", id: "default" }), /the plugin has stopped/);
  assert.equal(broker.can("getLink"), false);
});

test("against the real todo server: the broker calls with the session's token, and the API's errors come back", async () => {
  const server = fakeServer({ user: "ana", versions: [], layout: {} });
  const session = await Session.start({ fetch: server.fetch });
  const app = await appInfo();
  const r = rt();
  const m = manifest({ slot: "main", requiredEndpoints: ["listTodos", "createTodo"], optionalEndpoints: ["deleteTodo"] });
  const broker = createBroker({ load: pluginLoad("plg_todo_list", "Todo list", m, { userCan: ["listTodos", "createTodo"] }), app, rt: r, request: session.request, signal: new AbortController().signal });
  const todos = (await broker.call("listTodos", undefined)) as { id: string; title: string; done: boolean }[];
  assert.ok(todos.length >= 3);
  assert.ok(Object.isFrozen(todos) && Object.isFrozen(todos[0]));
  const last = server.requests[server.requests.length - 1];
  assert.equal(last.path, "/api/todos");
  assert.match(String(last.authorization), /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  await assert.rejects(broker.call("createTodo", { title: 5 }), /title: expected a string, got number/);
  await assert.rejects(broker.call("deleteTodo", { id: todos[0].id }), /optional endpoint/);

  const cyServer = fakeServer({ user: "cy", versions: [], layout: {} });
  const cy = await Session.start({ fetch: cyServer.fetch });
  const asCy = createBroker({ load: pluginLoad("plg_todo_list", "Todo list", m), app, rt: r, request: cy.request, signal: new AbortController().signal });
  await assert.rejects(asCy.call("createTodo", { title: "x" }), (error: unknown) => {
    assert.ok(error instanceof ThixoCallError);
    assert.equal(error.status, 403);
    assert.match(error.message, /todos.write/);
    return true;
  });
  session.end();
  cy.end();
});
