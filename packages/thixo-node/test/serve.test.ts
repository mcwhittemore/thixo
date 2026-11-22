import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/serve.js";

const enc = new TextEncoder();

test("a request round-trips: method, path, query, headers and body", async () => {
  const server = await serve(async (request) => {
    const url = new URL(request.url);
    return Response.json(
      { method: request.method, path: url.pathname, query: url.search, header: request.headers.get("x-test"), body: await request.text() },
      { status: 201, headers: { "x-reply": "yes" } },
    );
  }, { port: 0 });
  try {
    const response = await fetch(`${server.url}/a/b?x=1`, { method: "POST", headers: { "x-test": "hi", "content-type": "text/plain" }, body: "payload" });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-reply"), "yes");
    assert.deepEqual(await response.json(), { method: "POST", path: "/a/b", query: "?x=1", header: "hi", body: "payload" });
  } finally {
    await server.close();
  }
});

test("a streamed response reaches the client in pieces, before the handler finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const server = await serve(async () => {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode('{"n":1}\n'));
        await gate;
        controller.enqueue(enc.encode('{"n":2}\n{"n"'));
        controller.enqueue(enc.encode(':3}\n'));
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
  }, { port: 0 });
  try {
    const response = await fetch(`${server.url}/stream`);
    assert.equal(response.headers.get("content-type"), "application/x-ndjson");
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.equal(new TextDecoder().decode(first.value), '{"n":1}\n');
    release();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    assert.deepEqual(rest.trim().split("\n").map((line) => JSON.parse(line)), [{ n: 2 }, { n: 3 }]);
  } finally {
    release();
    await server.close();
  }
});

test("a streamed request body reaches the handler as it is sent", async () => {
  const server = await serve(async (request) => {
    const lines: string[] = [];
    const decoder = new TextDecoder();
    for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) lines.push(decoder.decode(chunk));
    return Response.json({ chunks: lines.length, text: lines.join("") });
  }, { port: 0 });
  try {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(enc.encode("one,"));
        await new Promise((r) => setTimeout(r, 30));
        controller.enqueue(enc.encode("two"));
        controller.close();
      },
    });
    const response = await fetch(`${server.url}/up`, { method: "POST", body, duplex: "half" } as RequestInit);
    const result = (await response.json()) as { chunks: number; text: string };
    assert.equal(result.text, "one,two");
    assert.ok(result.chunks >= 1);
  } finally {
    await server.close();
  }
});

test("multiple set-cookie headers survive, and a handler that throws gives 500", async () => {
  const server = await serve(async (request) => {
    if (new URL(request.url).pathname === "/boom") throw new Error("kaboom");
    const headers = new Headers();
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    return new Response(null, { status: 204, headers });
  }, { port: 0 });
  const quiet = console.error;
  console.error = () => {};
  try {
    const ok = await fetch(`${server.url}/`);
    assert.deepEqual(ok.headers.getSetCookie(), ["a=1", "b=2"]);
    const boom = await fetch(`${server.url}/boom`);
    assert.equal(boom.status, 500);
    assert.equal(await boom.text(), "Internal Server Error");
  } finally {
    console.error = quiet;
    await server.close();
  }
});

test("the handler's request is aborted when the client goes away", async () => {
  let aborted!: () => void;
  const seen = new Promise<void>((resolve) => (aborted = resolve));
  const server = await serve(async (request) => {
    request.signal.addEventListener("abort", () => aborted());
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(enc.encode("hi\n")); } }));
  }, { port: 0 });
  try {
    const controller = new AbortController();
    const response = await fetch(`${server.url}/`, { signal: controller.signal });
    await response.body!.getReader().read();
    controller.abort();
    await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("never aborted")), 3000))]);
  } finally {
    await server.close();
  }
});

test("static files come first, with types, index.html and no way out of the folder", async () => {
  const root = mkdtempSync(join(tmpdir(), "thixo-static-"));
  const dir = join(root, "public");
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), "<h1>home</h1>");
  writeFileSync(join(dir, "assets", "app.js"), "export {}");
  writeFileSync(join(root, "secret.txt"), "secret");
  const server = await serve(async () => new Response("handler"), { port: 0, staticDir: dir, staticPrefix: "/static" });
  try {
    const home = await fetch(`${server.url}/static/`);
    assert.equal(await home.text(), "<h1>home</h1>");
    assert.match(home.headers.get("content-type")!, /text\/html/);
    const js = await fetch(`${server.url}/static/assets/app.js`);
    assert.match(js.headers.get("content-type")!, /javascript/);
    assert.equal(await js.text(), "export {}");
    assert.equal(await (await fetch(`${server.url}/static/missing.js`)).text(), "handler");
    assert.equal(await (await fetch(`${server.url}/`)).text(), "handler");
    assert.equal(await (await fetch(`${server.url}/staticfoo`)).text(), "handler");
    assert.equal(await (await fetch(`${server.url}/static`, { method: "POST" })).text(), "handler");
    for (const path of ["/static/../secret.txt", "/static/%2e%2e/secret.txt", "/static/..%2fsecret.txt"]) {
      const body = await (await fetch(`${server.url}${path}`)).text();
      assert.notEqual(body, "secret", path);
    }
    const raw = await new Promise<string>((resolve, reject) => {
      import("node:net").then(({ connect }) => {
        const socket = connect(Number(new URL(server.url).port), "127.0.0.1", () => socket.write("GET /static/../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
        let data = "";
        socket.on("data", (d) => (data += d));
        socket.on("close", () => resolve(data));
        socket.on("error", reject);
      });
    });
    assert.ok(!raw.includes("secret\r") && !raw.endsWith("secret"));
  } finally {
    await server.close();
  }
});

test("a static root of / serves files and still reaches the handler for other paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thixo-static-"));
  writeFileSync(join(dir, "a.txt"), "A");
  const server = await serve(async () => new Response("handler"), { port: 0, staticDir: dir });
  try {
    assert.equal(await (await fetch(`${server.url}/a.txt`)).text(), "A");
    assert.equal(await (await fetch(`${server.url}/api/x`)).text(), "handler");
  } finally {
    await server.close();
  }
});

test("close stops the server even with a stream open", async () => {
  const server = await serve(async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("x")); } })), { port: 0 });
  const response = await fetch(`${server.url}/`);
  await response.body!.getReader().read();
  await server.close();
  await assert.rejects(fetch(`${server.url}/`));
});
