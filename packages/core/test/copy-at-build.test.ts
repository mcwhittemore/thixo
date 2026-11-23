// Copy at build: a written-out outside load is fetched once when the plugin is built, stored with the version by its
// content hash, and served from the app under the same rule as the plugin's code. The fetcher here is a fake, so no
// test touches the network.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { compile, verifyOutput } from "thixo-thx";
import type { AssetLimits, BuildAdapter, FetchedAsset } from "../src/contract.js";
import { createThixo, type Thixo } from "../src/server/index.js";
import { buildWithCopies, ASSET_LIMITS } from "../src/server/registry/assets.js";
import { createContext } from "../src/server/context.js";
import { ORIGIN, tokenFor } from "./helpers/client.js";
import { app, memoryCode, memoryData, USERS } from "./helpers/registry-doubles.js";

const GIF = Uint8Array.from(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
const SVG = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>`);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

interface Served {
  [address: string]: FetchedAsset;
}

function realBuild(served: Served, fetched: string[] = []): BuildAdapter {
  return {
    async build(files, env) {
      return compile(files, env);
    },
    verify: (code) => verifyOutput(code),
    async fetchAsset(address: string, _limits: AssetLimits) {
      // It ignores the limits, as a careless adapter might: the copy step checks them again.
      fetched.push(address);
      const got = served[address];
      if (!got) return { ok: false, message: "the host answered 404." };
      return got;
    },
  };
}

function server(build: BuildAdapter): { thixo: Thixo; code: ReturnType<typeof memoryCode> } {
  const code = memoryCode();
  const users = structuredClone(USERS);
  const thixo = createThixo(app, {
    identity: { identify: (request) => users[request.headers.get("cookie") ?? ""] ?? null, scopesOf: (id) => users[id]?.scopes ?? null },
    adapters: { code, data: memoryData(), build },
    layout: {},
    signingKey: "test-key",
  });
  return { thixo, code };
}

const plugin = (jsx: string, name = "Logo") => ({
  "plugin.thx": `import { definePlugin } from "thixo/plugin";
import { todoDetail } from "@app/slots";

export default definePlugin(todoDetail, { name: ${JSON.stringify(name)}, description: "Shows a picture." }, function Logo() {
  return ${jsx};
});
`,
});

const LOGO = "https://cdn.example.com/logo.gif";

async function get(thixo: Thixo, path: string, init: { token?: string } = {}) {
  return thixo.fetch(new Request(`${ORIGIN}${path}`, { headers: init.token ? { authorization: `Bearer ${init.token}` } : {} }));
}

test("a submitted plugin's outside image is copied at build, stored by hash, and the code loads the app's copy", async () => {
  const fetched: string[] = [];
  const { thixo, code } = server(realBuild({ [LOGO]: { ok: true, bytes: GIF, contentType: "image/gif" } }, fetched));
  const result = await thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<img src="${LOGO}" alt="logo" />`) });
  assert.ok(result.ok, JSON.stringify(!result.ok && result.errors));
  if (!result.ok) return;
  const file = `${sha(GIF)}.gif`;
  assert.deepEqual(fetched, [LOGO], "fetched once, at build");
  assert.deepEqual(result.manifest.loads, [LOGO], "the manifest still records the original address (L8)");
  assert.deepEqual(result.manifest.assets, { [LOGO]: file });
  assert.deepEqual(code.objects.get(`assets/${sha(GIF)}`), GIF, "the bytes are stored through the code adapter");
  assert.ok(result.summary.includes("Copied 1 file from cdn.example.com when it was built: it loads from this app, never from cdn.example.com"));

  const version = (await thixo.services.registry.listVersions({ user: USERS.ana, plugin: result.plugin.id }))[0];
  const compiled = new TextDecoder().decode(code.objects.get(version.compiled));
  assert.doesNotMatch(compiled, /cdn\.example\.com/, "the compiled plugin names no outside host");
  assert.match(compiled, new RegExp(`rt\\.asset\\("${file}"\\)`));
});

test("the asset route serves a copy under the plugin code's rule, with headers that keep it inert", async () => {
  const { thixo } = server(realBuild({ [LOGO]: { ok: true, bytes: GIF, contentType: "image/gif" } }));
  const result = await thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<img src="${LOGO}" alt="logo" />`) });
  assert.ok(result.ok);
  if (!result.ok) return;
  const id = result.plugin.id;
  const file = `${sha(GIF)}.gif`;
  const ana = await tokenFor(thixo, "ana");
  const ben = await tokenFor(thixo, "ben");

  const load = await (await get(thixo, `/_thixo/plugins/${id}/1/load`, { token: ana })).json();
  assert.equal(load.assets.path, `/_thixo/plugins/${id}/1/assets/`);
  assert.match(load.assets.query, /^u=ana&e=\d+&k=/);

  const byTicket = await get(thixo, `${load.assets.path}${file}?${load.assets.query}`);
  assert.equal(byTicket.status, 200);
  assert.deepEqual(new Uint8Array(await byTicket.arrayBuffer()), GIF);
  assert.equal(byTicket.headers.get("content-type"), "image/gif");
  assert.equal(byTicket.headers.get("x-content-type-options"), "nosniff");
  assert.match(byTicket.headers.get("content-security-policy")!, /default-src 'none'.*sandbox/);
  assert.equal(byTicket.headers.get("cross-origin-resource-policy"), "same-origin");

  assert.equal((await get(thixo, `${load.assets.path}${file}`, { token: ana })).status, 200, "the author's token works too");
  assert.equal((await get(thixo, `${load.assets.path}${file}`)).status, 401, "nothing without a token or ticket");
  assert.equal((await get(thixo, `${load.assets.path}${file}`, { token: ben })).status, 404, "a personal plugin's files are its author's, as its code is");
  const codeTicket = new URL(`${ORIGIN}${load.code}`).search.slice(1);
  assert.equal((await get(thixo, `${load.assets.path}${file}?${codeTicket}`)).status, 401, "a code ticket is not an asset ticket");
  const otherVersion = await get(thixo, `/_thixo/plugins/${id}/2/assets/${file}?${load.assets.query}`);
  assert.equal(otherVersion.status, 401, "a ticket is bound to its version");
  assert.equal((await get(thixo, `${load.assets.path}${"0".repeat(64)}.gif`, { token: ana })).status, 404, "only a file this version copied");
  assert.equal((await get(thixo, `${load.assets.path}..%2Fsource.json`, { token: ana })).status, 404);

  await thixo.services.registry.share({ user: USERS.ana, plugin: id });
  assert.equal((await get(thixo, `${load.assets.path}${file}`, { token: ben })).status, 200, "a shared plugin's files are anyone's who may load it");
});

test("an SVG is copied only without script, and is served so that opened on its own it runs nothing", async () => {
  const clean = "https://cdn.example.com/dot.svg";
  const scripted = "https://cdn.example.com/evil.svg";
  const handler = "https://cdn.example.com/onload.svg";
  const served: Served = {
    [clean]: { ok: true, bytes: SVG, contentType: "image/svg+xml" },
    [scripted]: { ok: true, bytes: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`), contentType: "image/svg+xml" },
    [handler]: { ok: true, bytes: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`), contentType: "image/svg+xml; charset=utf-8" },
  };
  const { thixo } = server(realBuild(served));
  for (const address of [scripted, handler]) {
    const refused = await thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<img src="${address}" alt="x" />`) });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.errors[0].message, /Could not copy .* the SVG has/);
  }
  const ok = await thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<img src="${clean}" alt="x" />`) });
  assert.ok(ok.ok);
  if (!ok.ok) return;
  const ana = await tokenFor(thixo, "ana");
  const response = await get(thixo, `/_thixo/plugins/${ok.plugin.id}/1/assets/${sha(SVG)}.svg`, { token: ana });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/svg+xml");
  assert.match(response.headers.get("content-security-policy")!, /sandbox/);
  assert.equal(response.headers.get("content-disposition"), "attachment");
});

test("a copy that fails is a build error the agent can act on, pointing at the line", async () => {
  const { thixo } = server(
    realBuild({
      "https://cdn.example.com/page.html": { ok: true, bytes: new TextEncoder().encode("<html>"), contentType: "text/html" },
      "https://cdn.example.com/empty.png": { ok: true, bytes: new Uint8Array(), contentType: "image/png" },
    }),
  );
  const cases: [string, RegExp][] = [
    ["https://cdn.example.com/missing.png", /Could not copy https:\/\/cdn\.example\.com\/missing\.png into the app: the host answered 404\./],
    ["https://cdn.example.com/page.html", /served as text\/html, and only images and fonts are copied/],
    ["https://cdn.example.com/empty.png", /it is empty/],
  ];
  for (const [address, message] of cases) {
    const result = await thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<img src="${address}" alt="x" />`) });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.errors[0].code, "build/copy-failed");
    assert.match(result.errors[0].message, message);
    assert.deepEqual([result.errors[0].file, result.errors[0].line], ["plugin.thx", 5]);
    assert.match(result.errors[0].hint!, /copied into the app when it is built/);
  }
});

test("size caps hold per file and per plugin", async () => {
  const big = new Uint8Array(ASSET_LIMITS.fileBytes + 1).fill(1);
  const { thixo } = server(realBuild({ "https://cdn.example.com/big.png": { ok: true, bytes: big, contentType: "image/png" } }));
  const tooBig = await thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<img src="https://cdn.example.com/big.png" alt="x" />`) });
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.match(tooBig.errors[0].message, /larger than/);

  // Five files of 1.9 MiB each is more than one plugin may copy, though each is under the per-file cap.
  const served: Served = {};
  const imgs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const address = `https://cdn.example.com/${i}.png`;
    served[address] = { ok: true, bytes: new Uint8Array(Math.floor(1.9 * 1024 * 1024)).fill(i + 1), contentType: "image/png" };
    imgs.push(`<img src="${address}" alt="x" />`);
  }
  const many = server(realBuild(served));
  const result = await many.thixo.services.registry.submit({ user: USERS.ana, files: plugin(`<div>${imgs.join("")}</div>`) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.map((e) => e.message).join("\n"), /larger than the \d+ bytes a plugin may still copy/);
});

test("the agent's check copies too, and says what it copied; a build adapter that can't fetch refuses outside loads", async () => {
  const build = realBuild({ [LOGO]: { ok: true, bytes: GIF, contentType: "image/gif" } });
  const ctx = createContext(app, { identity: () => null, adapters: { code: memoryCode(), data: memoryData(), build }, layout: {}, signingKey: "k" });
  const built = await buildWithCopies(build, ctx.compileEnv, plugin(`<img src="${LOGO}" alt="logo" />`));
  assert.ok(built.ok);
  if (built.ok) assert.deepEqual(Object.keys(built.assets), [`${sha(GIF)}.gif`]);

  const { fetchAsset: _, ...noFetch } = build;
  const refused = await buildWithCopies(noFetch, ctx.compileEnv, plugin(`<img src="${LOGO}" alt="logo" />`));
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.errors[0].message, /can't fetch files/);

  const linkOnly = await buildWithCopies(noFetch, ctx.compileEnv, plugin(`<a href="https://docs.example.com/help">Help</a>`));
  assert.ok(linkOnly.ok, "a link is not copied, so it needs no fetcher");
  if (linkOnly.ok) assert.deepEqual(linkOnly.manifest.links, ["https://docs.example.com/help"]);
});

test("a deploy copies a default plugin's outside images", async () => {
  const fetched: string[] = [];
  const { thixo, code } = server(realBuild({ [LOGO]: { ok: true, bytes: GIF, contentType: "image/gif" } }, fetched));
  const files = plugin(`<img src="${LOGO}" alt="logo" />`, "Logo");
  files["plugin.thx"] = files["plugin.thx"].replace(`{ name: "Logo"`, `{ id: "logo", name: "Logo"`);
  const release = await thixo.services.deploy({ plugins: { logo: files }, layout: { "todo-detail": "logo" }, deployment: "one" });
  assert.deepEqual(release.layout["todo-detail"], { plugin: "logo", number: 1 });
  assert.ok(code.objects.has(`assets/${sha(GIF)}`));
  assert.deepEqual(fetched, [LOGO], "the build fetched it once: the second build of the same folder used the copy");
});
