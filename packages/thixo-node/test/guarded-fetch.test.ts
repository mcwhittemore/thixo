// The fetch behind copy at build must not reach inside the network. Every test here injects the resolver and the
// transport, so nothing touches the network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { guardedFetch, isPublicAddress, type RawResponse } from "../src/guarded-fetch.js";
import { localBuild } from "../src/local-build.js";

const LIMITS = { maxBytes: 1024, types: ["image/png", "image/gif", "image/svg+xml", "font/woff2"] };
const GIF = Uint8Array.from(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));

function reply(status: number, headers: Record<string, string>, body: Uint8Array[] = []): RawResponse {
  return {
    status,
    headers,
    body: (async function* () {
      for (const chunk of body) yield chunk;
    })(),
    destroy() {},
  };
}

interface Seen {
  url: string;
  address: string;
}

/** A fake internet: host name to addresses, and URL to what it answers. */
function net(dns: Record<string, string[]>, pages: Record<string, RawResponse | (() => RawResponse)>, seen: Seen[] = [], extra: { timeoutMs?: number; hang?: boolean } = {}) {
  return guardedFetch({
    timeoutMs: extra.timeoutMs,
    resolve: async (host) => {
      if (!dns[host]) throw new Error("ENOTFOUND");
      return dns[host];
    },
    get: async (url, address, signal) => {
      seen.push({ url: url.href, address });
      if (extra.hang) await new Promise((_, fail) => signal.addEventListener("abort", () => fail(new Error("aborted"))));
      const page = pages[url.href];
      if (!page) return reply(404, {});
      return typeof page === "function" ? page() : page;
    },
  });
}

test("which addresses count as the public internet", () => {
  for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of [
    "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1",
    "169.254.169.254", "169.254.0.1", "192.0.0.170", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "64:ff9b::a9fe:a9fe", "fc00::1", "fd00:ec2::254", "fe80::1",
    "ff02::1", "2001:db8::1", "2002:7f00:1::", "not an ip", "",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
});

test("a public https image is fetched, pinned to the address that was checked", async () => {
  const seen: Seen[] = [];
  const fetchAsset = net({ "cdn.example.com": ["93.184.216.34"] }, { "https://cdn.example.com/logo.gif": reply(200, { "content-type": "image/gif; charset=binary" }, [GIF]) }, seen);
  const got = await fetchAsset("https://cdn.example.com/logo.gif", LIMITS);
  assert.deepEqual(got, { ok: true, bytes: GIF, contentType: "image/gif" });
  assert.deepEqual(seen, [{ url: "https://cdn.example.com/logo.gif", address: "93.184.216.34" }]);
});

test("loopback, private, link-local and metadata hosts are refused before anything connects", async () => {
  const seen: Seen[] = [];
  const fetchAsset = net(
    { "inside.example.com": ["10.0.0.7"], "mixed.example.com": ["93.184.216.34", "127.0.0.1"], "meta.example.com": ["169.254.169.254"], "v6.example.com": ["::1"] },
    {},
    seen,
  );
  const cases: [string, RegExp][] = [
    ["https://inside.example.com/x.png", /resolves to 10\.0\.0\.7, which is not an address on the public internet/],
    ["https://mixed.example.com/x.png", /resolves to 127\.0\.0\.1/],
    ["https://meta.example.com/latest/meta-data", /169\.254\.169\.254/],
    ["https://v6.example.com/x.png", /::1/],
    ["https://127.0.0.1/x.png", /127\.0\.0\.1 is not an address on the public internet/],
    ["https://[::1]/x.png", /::1 is not an address on the public internet/],
    ["https://169.254.169.254/latest/meta-data/", /not an address on the public internet/],
    ["https://localhost/x.png", /localhost is not a public host/],
    ["https://nowhere.example.com/x.png", /could not be found/],
    ["http://cdn.example.com/x.png", /only https/],
    ["https://cdn.example.com:8443/x.png", /port 8443/],
    ["https://user:pw@cdn.example.com/x.png", /user name or password/],
    ["file:///etc/passwd", /only https/],
  ];
  for (const [address, message] of cases) {
    const got = await fetchAsset(address, LIMITS);
    assert.equal(got.ok, false, address);
    if (!got.ok) assert.match(got.message, message, address);
  }
  assert.deepEqual(seen, [], "nothing connected");
});

test("every redirect is checked again, and there are few", async () => {
  const seen: Seen[] = [];
  const dns = { "cdn.example.com": ["93.184.216.34"], "inside.example.com": ["192.168.0.10"] };
  const fetchAsset = net(
    dns,
    {
      "https://cdn.example.com/to-inside.png": reply(302, { location: "https://inside.example.com/admin.png" }),
      "https://cdn.example.com/to-ip.png": reply(301, { location: "https://169.254.169.254/latest/" }),
      "https://cdn.example.com/to-http.png": reply(302, { location: "http://cdn.example.com/x.png" }),
      "https://cdn.example.com/hop.png": reply(302, { location: "/hop.png" }),
      "https://cdn.example.com/a.png": reply(302, { location: "/b.png" }),
      "https://cdn.example.com/b.png": reply(200, { "content-type": "image/png" }, [GIF]),
    },
    seen,
  );
  const inside = await fetchAsset("https://cdn.example.com/to-inside.png", LIMITS);
  assert.equal(inside.ok, false);
  if (!inside.ok) assert.match(inside.message, /192\.168\.0\.10/);
  const ip = await fetchAsset("https://cdn.example.com/to-ip.png", LIMITS);
  assert.equal(ip.ok, false);
  const http = await fetchAsset("https://cdn.example.com/to-http.png", LIMITS);
  assert.equal(http.ok, false);
  if (!http.ok) assert.match(http.message, /only https/);
  const loop = await fetchAsset("https://cdn.example.com/hop.png", LIMITS);
  assert.equal(loop.ok, false);
  if (!loop.ok) assert.match(loop.message, /redirected more than 3 times/);
  const followed = await fetchAsset("https://cdn.example.com/a.png", LIMITS);
  assert.equal(followed.ok, true, "a redirect on a public host is followed");
  assert.ok(!seen.some((s) => s.address !== "93.184.216.34"), "no connection went anywhere but the public address");
});

test("content type, size and time are capped", async () => {
  const big = new Uint8Array(600);
  const fetchAsset = net(
    { "cdn.example.com": ["93.184.216.34"] },
    {
      "https://cdn.example.com/page": reply(200, { "content-type": "text/html" }, [new TextEncoder().encode("<script>")]),
      "https://cdn.example.com/none": reply(200, {}, [GIF]),
      "https://cdn.example.com/declared.png": reply(200, { "content-type": "image/png", "content-length": "5000" }, [GIF]),
      "https://cdn.example.com/streamed.png": reply(200, { "content-type": "image/png" }, [big, big]),
      "https://cdn.example.com/gone.png": reply(500, {}),
    },
  );
  const expect = async (address: string, message: RegExp) => {
    const got = await fetchAsset(address, LIMITS);
    assert.equal(got.ok, false, address);
    if (!got.ok) assert.match(got.message, message, address);
  };
  await expect("https://cdn.example.com/page", /served as text\/html/);
  await expect("https://cdn.example.com/none", /served as no type/);
  await expect("https://cdn.example.com/declared.png", /5000 bytes, more than the 1024/);
  await expect("https://cdn.example.com/streamed.png", /larger than the 1024 bytes/);
  await expect("https://cdn.example.com/gone.png", /answered 500/);
  const slow = net({ "cdn.example.com": ["93.184.216.34"] }, {}, [], { timeoutMs: 20, hang: true });
  const got = await slow("https://cdn.example.com/slow.png", LIMITS);
  assert.equal(got.ok, false);
  if (!got.ok) assert.match(got.message, /took longer than/);
});

test("localBuild fetches through the fetcher it is given, and the guarded one by default", async () => {
  const asked: string[] = [];
  const build = localBuild(undefined, { fetchAsset: async (address) => (asked.push(address), { ok: true, bytes: GIF, contentType: "image/gif" }) });
  assert.deepEqual(await build.fetchAsset!("https://cdn.example.com/x.gif", LIMITS), { ok: true, bytes: GIF, contentType: "image/gif" });
  assert.deepEqual(asked, ["https://cdn.example.com/x.gif"]);
  const guarded = localBuild();
  const refused = await guarded.fetchAsset!("https://127.0.0.1/x.gif", LIMITS);
  assert.equal(refused.ok, false, "the default refuses loopback without connecting");
});

test("the timeout covers the host lookup: a resolver that never answers can't hold the fetch", async () => {
  // Red team r3: guardedFetch({ timeoutMs: 1000, resolve: () => new Promise(() => {}) }) never settled.
  let connected = false;
  const fetchAsset = guardedFetch({
    timeoutMs: 100,
    resolve: () => new Promise<string[]>(() => {}),
    get: async () => ((connected = true), reply(200, { "content-type": "image/gif" }, [GIF])),
  });
  const started = Date.now();
  const got = await fetchAsset("https://stuck.example.com/x.gif", LIMITS);
  assert.equal(got.ok, false);
  if (!got.ok) assert.equal(got.message, "it took longer than 0.1 seconds.", "the real time, not rounded to 0 seconds");
  assert.ok(Date.now() - started < 1000, "it gave up at its own time");
  assert.equal(connected, false);
});

test("a get or a body that ignores the signal can't hold the fetch either", async () => {
  const hanging = guardedFetch({ timeoutMs: 30, resolve: async () => ["93.184.216.34"], get: () => new Promise<RawResponse>(() => {}) });
  const a = await hanging("https://cdn.example.com/x.gif", LIMITS);
  assert.equal(a.ok, false);
  if (!a.ok) assert.match(a.message, /took longer than/);
  const trickle = guardedFetch({
    timeoutMs: 30,
    resolve: async () => ["93.184.216.34"],
    get: async () => ({
      status: 200,
      headers: { "content-type": "image/gif" },
      body: (async function* () {
        yield GIF;
        await new Promise(() => {});
      })(),
      destroy() {},
    }),
  });
  const b = await trickle("https://cdn.example.com/x.gif", LIMITS);
  assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.message, /took longer than/);
});

test("lookups are capped across fetches, and the build's signal stops a fetch", async () => {
  let running = 0;
  let most = 0;
  const fetchAsset = guardedFetch({
    maxLookups: 2,
    resolve: async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 10));
      running--;
      return ["93.184.216.34"];
    },
    get: async () => reply(200, { "content-type": "image/gif" }, [GIF]),
  });
  const all = await Promise.all(Array.from({ length: 6 }, (_, i) => fetchAsset(`https://h${i}.example.com/x.gif`, LIMITS)));
  assert.ok(all.every((r) => r.ok));
  assert.equal(most, 2);

  const controller = new AbortController();
  const slow = guardedFetch({ resolve: () => new Promise<string[]>(() => {}) });
  const pending = slow("https://cdn.example.com/x.gif", { ...LIMITS, signal: controller.signal });
  controller.abort();
  const stopped = await pending;
  assert.equal(stopped.ok, false);
  if (!stopped.ok) assert.match(stopped.message, /build stopped copying/);
});
