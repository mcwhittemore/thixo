import assert from "node:assert/strict";
import { test } from "node:test";
import { collectApp, defineScopes, endpoint, record, HttpError } from "../src/api/index.js";
import { defineConfig } from "../src/index.js";
import { createThixo } from "../src/server/index.js";
import { t } from "../src/schema/index.js";
import { call, loadSdk, ORIGIN, tokenFor } from "./helpers/client.js";
import { memoryAdapters } from "./helpers/adapters.js";

const scopes = defineScopes({ "notes.read": "Read notes", "notes.write": "Write notes" });
const Note = record("note", { read: ["notes.read"], fields: { id: t.string(), text: t.string(), at: t.date() } });
const store = new Map([["n1", { id: "n1", text: "hello", at: new Date("2026-11-22T10:00:00Z"), secret: "x" }]]);

const listNotes = endpoint({
  method: "GET",
  path: "/notes",
  scopes: ["notes.read"],
  input: t.object({ limit: t.optional(t.number()), tag: t.optional(t.array(t.string())), since: t.optional(t.date()) }),
  output: t.array(Note),
  handler: async ({ input }) => {
    seen.input = input;
    return [...store.values()].slice(0, input.limit);
  },
});
const getNote = endpoint({
  method: "GET",
  path: "/notes/:id",
  scopes: ["notes.read"],
  input: t.object({ id: t.string() }),
  output: Note,
  handler: ({ input }) => {
    const note = store.get(input.id);
    if (!note) throw new HttpError(404, `No note ${input.id}`);
    return note;
  },
});
const recentNote = endpoint({ method: "GET", path: "/notes/recent", scopes: ["notes.read"], output: Note, handler: () => store.get("n1")! });
const addNote = endpoint({
  method: "POST",
  path: "/notes",
  scopes: ["notes.read", "notes.write"],
  input: t.object({ text: t.string(), at: t.date() }),
  output: Note,
  handler: ({ input }) => {
    const note = { id: `n${store.size + 1}`, ...input };
    store.set(note.id, note as never);
    return note;
  },
});
const clearNotes = endpoint({ method: "DELETE", path: "/notes", scopes: ["notes.write"], handler: () => store.clear() });
const boom = endpoint({ method: "GET", path: "/boom", scopes: ["notes.read"], handler: () => { throw new Error("db password is hunter2"); } });
const seen: { input?: unknown } = {};

const app = collectApp([{ scopes, Note, listNotes, getNote, recentNote, addNote, clearNotes, boom }], {});
const adapters = memoryAdapters();
const people: Record<string, string[]> = { reader: ["notes.read"], writer: ["notes.write"], both: ["notes.read", "notes.write"] };
const thixo = createThixo(
  app,
  defineConfig({
    identity: (request) => {
      const who = /who=(\w+)/.exec(request.headers.get("cookie") ?? "")?.[1];
      return who && people[who] ? { id: who, scopes: people[who], groups: ["g1"] } : null;
    },
    adapters,
    layout: {},
    signingKey: "test-key",
  }),
);

test("the token route needs a session, issues a token and remembers the user", async () => {
  const none = await call(thixo, "POST", "/_thixo/token");
  assert.equal(none.status, 401);
  const response = await thixo.fetch(new Request(`${ORIGIN}/_thixo/token`, { method: "POST", headers: { cookie: "who=both" } }));
  assert.equal(response.status, 200);
  const reply = (await response.json()) as { token: string; expiresAt: string; user: { id: string; scopes: string[] } };
  assert.equal(reply.user.id, "both");
  assert.ok(Date.parse(reply.expiresAt) > Date.now());
  assert.deepEqual(adapters.users.get("both")?.scopes, ["notes.read", "notes.write"]);
});

test("GET /_thixo/app describes the app, with Thixo's scopes added", async () => {
  const { status, body } = await call(thixo, "GET", "/_thixo/app");
  assert.equal(status, 200);
  assert.ok("notes.read" in body.scopes && "thixo.data.admin" in body.scopes);
  const addNote = body.endpoints.find((e: { name: string }) => e.name === "addNote");
  assert.deepEqual(
    { name: addNote.name, method: addNote.method, path: addNote.path, scopes: addNote.scopes },
    { name: "addNote", method: "POST", path: "/notes", scopes: ["notes.read", "notes.write"] },
  );
  assert.equal(addNote.input.kind, "object", "the broker validates a plugin's input against it");
  assert.equal(body.records[0].exportName, "Note");
  assert.ok(body.records[0].fields, "the broker resolves record schemas with it");
  assert.deepEqual(body.addressHosts, [], "no outside load hosts unless the config lists them");
});

test("GET /_thixo/app carries the config's addressHosts, for the runtime to check handed-in loads against", async () => {
  // redteam-language round 2: a Url from data rendered as <img src> could load from any host.
  const listed = createThixo(app, defineConfig({ identity: () => null, adapters: memoryAdapters(), layout: {}, signingKey: "k", addressHosts: ["cdn.example.com"] }));
  const { status, body } = await call(listed, "GET", "/_thixo/app");
  assert.equal(status, 200);
  assert.deepEqual(body.addressHosts, ["cdn.example.com"]);
});

test("/api: 401 without a token or with a bad one", async () => {
  const none = await call(thixo, "GET", "/api/notes");
  assert.equal(none.status, 401);
  assert.equal(none.body.error.code, "unauthorized");
  const bad = await call(thixo, "GET", "/api/notes", { token: "abc.def.ghi" });
  assert.equal(bad.status, 401);
});

test("/api: 403 names the missing scopes (A3)", async () => {
  const reader = await tokenFor(thixo, "who=reader");
  const one = await call(thixo, "POST", "/api/notes", { token: reader, body: { text: "x", at: "2026-01-01" } });
  assert.equal(one.status, 403);
  assert.deepEqual(one.body.error.missingScopes, ["notes.write"]);
  assert.match(one.body.error.message, /notes\.write/);

  const writer = await tokenFor(thixo, "who=writer");
  const two = await call(thixo, "POST", "/api/notes", { token: writer, body: { text: "x", at: "2026-01-01" } });
  assert.equal(two.status, 403);
  assert.deepEqual(two.body.error.missingScopes, ["notes.read"]);

  const none = await call(thixo, "GET", "/api/notes", { token: writer });
  assert.deepEqual(none.body.error.missingScopes, ["notes.read"]);
});

test("/api: input comes from the path, the query and the body; dates go out as ISO strings; extra fields are dropped", async () => {
  const both = await tokenFor(thixo, "who=both");
  const one = await call(thixo, "GET", "/api/notes/n1", { token: both });
  assert.equal(one.status, 200);
  assert.deepEqual(one.body, { id: "n1", text: "hello", at: "2026-11-22T10:00:00.000Z" });

  const listed = await call(thixo, "GET", "/api/notes?limit=1&tag=a&tag=b&since=2026-01-01", { token: both });
  assert.equal(listed.status, 200);
  const input = seen.input as { limit: number; tag: string[]; since: Date };
  assert.equal(input.limit, 1);
  assert.deepEqual(input.tag, ["a", "b"]);
  assert.ok(input.since instanceof Date);
  assert.equal(listed.body[0].at, "2026-11-22T10:00:00.000Z");

  const added = await call(thixo, "POST", "/api/notes", { token: both, body: { text: "new", at: "2026-12-01T00:00:00Z" } });
  assert.equal(added.status, 200);
  assert.equal(added.body.at, "2026-12-01T00:00:00.000Z");
});

test("/api: a static path beats a parameter", async () => {
  const both = await tokenFor(thixo, "who=both");
  assert.equal((await call(thixo, "GET", "/api/notes/recent", { token: both })).body.id, "n1");
});

test("/api: 400 for bad input, 404 for nothing, handler errors as they are", async () => {
  const both = await tokenFor(thixo, "who=both");
  const bad = await call(thixo, "POST", "/api/notes", { token: both, body: { text: 5 } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.issues.map((i: { path: string }) => i.path).sort(), ["at", "text"]);
  const badQuery = await call(thixo, "GET", "/api/notes?limit=lots", { token: both });
  assert.equal(badQuery.status, 400);
  const notJson = await thixo.fetch(new Request(`${ORIGIN}/api/notes`, { method: "POST", headers: { authorization: `Bearer ${both}` }, body: "{nope" }));
  assert.equal(notJson.status, 400);

  assert.equal((await call(thixo, "GET", "/api/nothing", { token: both })).status, 404);
  assert.equal((await call(thixo, "GET", "/api/notes/zzz", { token: both })).status, 404);
  assert.equal((await call(thixo, "GET", "/nowhere")).status, 404);

  const boomed = await call(thixo, "GET", "/api/boom", { token: both });
  assert.equal(boomed.status, 500);
  assert.ok(!JSON.stringify(boomed.body).includes("hunter2"));
});

test("a handler that returns nothing answers 204", async () => {
  const writer = await tokenFor(thixo, "who=writer");
  const cleared = await call(thixo, "DELETE", "/api/notes", { token: writer });
  assert.equal(cleared.status, 204);
  store.set("n1", { id: "n1", text: "hello", at: new Date("2026-11-22T10:00:00Z"), secret: "x" });
});

test("the SDK, imported and called against the fetch handler", async () => {
  const response = await thixo.fetch(new Request(`${ORIGIN}/_thixo/sdk.js`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /javascript/);
  const text = await response.text();
  const sdk = await loadSdk(text);
  assert.deepEqual(Object.keys(sdk).sort(), ["addNote", "boom", "clearNotes", "getNote", "listNotes", "recentNote"]);

  const token = await tokenFor(thixo, "who=both");
  const options = { token, baseUrl: ORIGIN, fetch: (url: string, init: RequestInit) => thixo.fetch(new Request(url, init)) };

  const note = await sdk.getNote({ id: "n1" }, options);
  assert.equal(note.text, "hello");
  assert.ok(note.at instanceof Date, "dates come back as Dates");

  const list = await sdk.listNotes({ limit: 5, tag: ["a", "b"], since: new Date("2026-01-01T00:00:00Z") }, options);
  assert.equal(list.length, 1);
  assert.deepEqual((seen.input as { tag: string[] }).tag, ["a", "b"]);
  assert.equal((seen.input as { since: Date }).since.toISOString(), "2026-01-01T00:00:00.000Z");

  const added = await sdk.addNote({ text: "from sdk", at: new Date("2027-01-01T00:00:00Z") }, options);
  assert.equal(added.text, "from sdk");
  assert.ok(added.at instanceof Date);

  await assert.rejects(sdk.getNote({ id: "missing" }, options), (error: Error & { status: number; code: string }) => {
    assert.equal(error.status, 404);
    assert.equal(error.message, "No note missing");
    return true;
  });
  await assert.rejects(sdk.getNote({}, options), /missing path parameter "id"/);

  const readerToken = await tokenFor(thixo, "who=reader");
  await assert.rejects(
    sdk.addNote({ text: "x", at: new Date() }, { ...options, token: readerToken }),
    (error: Error & { status: number; body: { error: { missingScopes: string[] } } }) => {
      assert.equal(error.status, 403);
      assert.deepEqual(error.body.error.missingScopes, ["notes.write"]);
      return true;
    },
  );
  await assert.rejects(sdk.listNotes({}, { ...options, token: undefined }), (error: Error & { status: number }) => error.status === 401);
});

test("scopesOf: the identity adapter, else what was remembered, and the implementor holds all", async () => {
  // Reach the context through a route module the way the registry agent will.
  const { createContext } = await import("../src/server/index.js");
  const ctx = createContext(app, { identity: () => null, adapters, layout: {} });
  assert.deepEqual(await ctx.scopesOf("both"), ["notes.read", "notes.write"]);
  assert.deepEqual(await ctx.scopesOf("nobody"), []);
  assert.ok((await ctx.scopesOf("implementor")).includes("thixo.plugins.promote"));
  assert.ok(ctx.holds({ id: "implementor", scopes: [] }, ["anything"]));
  assert.ok(!ctx.holds({ id: "x", scopes: ["a"] }, ["a", "b"]));
  assert.deepEqual(ctx.missing({ id: "x", scopes: ["a"] }, ["a", "b"]), ["b"]);

  const withScopesOf = createContext(app, { identity: { identify: () => null, scopesOf: (id) => (id === "z" ? ["z.scope"] : null) }, adapters, layout: {} });
  assert.deepEqual(await withScopesOf.scopesOf("z"), ["z.scope"]);
  assert.deepEqual(await withScopesOf.scopesOf("both"), ["notes.read", "notes.write"]);
});

test("route modules can add routes through ctx", async () => {
  const { createRouter } = await import("../src/server/router.js");
  const router = createRouter([
    { method: "GET", path: "/_thixo/plugins/:id/:n.js", handler: () => new Response("") },
    { method: "POST", path: "/_thixo/registry/plugins/:id/fork", handler: () => new Response("") },
  ]);
  assert.deepEqual(router.match("GET", "/_thixo/plugins/a%20b/3.js")?.params, { id: "a b", n: "3" });
  assert.equal(router.match("GET", "/_thixo/plugins/a/3.css"), null);
  assert.equal(router.match("GET", "/_thixo/registry/plugins/x/fork"), null);
  assert.equal(router.match("POST", "/_thixo/registry/plugins/x/fork")?.params.id, "x");
});
