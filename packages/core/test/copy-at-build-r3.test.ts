// Copy at build, third red-team round: the SVG check reads the file as XML instead of looking for words, one build
// has one deadline and stops at its first failure, and what people's submits store is capped.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile, verifyOutput } from "thixo-thx";
import type { AssetLimits, BuildAdapter, FetchedAsset, ThixoConfig } from "../src/contract.js";
import { createThixo, type Thixo } from "../src/server/index.js";
import { ASSET_LIMITS, buildWithCopies, inSeconds } from "../src/server/registry/assets.js";
import { svgProblem } from "../src/server/registry/svg-check.js";
import { createContext } from "../src/server/context.js";
import { app, memoryCode, memoryData, USERS } from "./helpers/registry-doubles.js";

const enc = (text: string) => new TextEncoder().encode(text);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const NS = `xmlns="http://www.w3.org/2000/svg"`;

function utf16le(text: string, bom: boolean): Uint8Array {
  const body = Buffer.from(text, "utf16le");
  return new Uint8Array(bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body);
}

test("an SVG that hides script or an outside load from a word search is refused: the check reads XML", () => {
  // Each one passed the old regex check (red team r3, store-and-serve.test.ts).
  const refused: [string, Uint8Array, RegExp][] = [
    ["prefixed script", enc(`<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>`), /<svg:script>/],
    ["entity-encoded javascript: link", enc(`<svg ${NS}><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>`), /javascript:/],
    ["SMIL set to javascript:", enc(`<svg ${NS}><a><set attributeName="href" to="java&#x73;cript:alert(1)"/><rect/></a></svg>`), /<set>/],
    ["SMIL animate", enc(`<svg ${NS}><animate attributeName="href" values="x"/></svg>`), /<animate>/],
    ["UTF-16LE with a byte order mark", utf16le(`<svg ${NS}><script>alert(1)</script></svg>`, true), /UTF-16/],
    ["UTF-16LE without one", utf16le(`<svg ${NS}><script>alert(1)</script></svg>`, false), /zero byte|not UTF-8/],
    ["declared UTF-16", enc(`<?xml version="1.0" encoding="UTF-16"?><svg ${NS}/>`), /only UTF-8/],
    ["a comment inside the tag name", enc(`<svg ${NS}><scr<!---->ipt>alert(1)</scr<!---->ipt></svg>`), /could not be read as XML/],
    ["a DOCTYPE entity", enc(`<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;alert(1)&#60;/script&#62;">]><svg ${NS}>&x;</svg>`), /DOCTYPE that defines entities/],
    ["an undefined entity", enc(`<svg ${NS}><text>&x;</text></svg>`), /entity &x;/],
    ["<use> of an outside file", enc(`<svg ${NS}><use href="https://evil.example/x.svg#a"/></svg>`), /points at "https:\/\/evil\.example/],
    ["<image> from outside", enc(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://evil.example/p.png"/></svg>`), /points at/],
    ["an SVG inside a data: address", enc(`<svg ${NS}><image href="data:image/svg+xml;base64,PHN2Zz4="/></svg>`), /points at/],
    ["@import in a style", enc(`<svg ${NS}><style>@import url(https://evil.example/x.css);</style></svg>`), /@import/],
    ["@import in CDATA", enc(`<svg ${NS}><style><![CDATA[@import "https://evil.example/x.css";]]></style></svg>`), /@import/],
    ["url() in a style attribute", enc(`<svg ${NS}><rect style="fill:url(https://evil.example/p.png)"/></svg>`), /points at/],
    ["url() in a presentation attribute", enc(`<svg ${NS}><rect filter="url(https://evil.example/f.svg#f)"/></svg>`), /points at/],
    ["a CSS escape", enc(`<svg ${NS}><style>rect { fill: u\\72l(https://evil.example/p.png) }</style></svg>`), /escape/],
    ["an outside style sheet", enc(`<?xml-stylesheet href="https://evil.example/x.css"?><svg ${NS}/>`), /processing instruction/],
    ["foreignObject", enc(`<svg ${NS}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`), /<foreignObject>/],
    ["an event handler", enc(`<svg ${NS} onload="alert(1)"/>`), /event handler attribute \(onload\)/],
    ["a prefixed event handler", enc(`<svg ${NS} xmlns:e="http://www.w3.org/2001/xml-events"><rect e:onclick="x"/></svg>`), /event handler/],
    ["xml:base", enc(`<svg ${NS} xml:base="https://evil.example/"><use href="#a"/></svg>`), /xml:base/],
    ["HTML, not SVG", enc(`<html><script>alert(1)</script></html>`), /first element is <html>/],
    ["two roots", enc(`<svg ${NS}/><svg ${NS}/>`), /could not be read/],
    ["not closed", enc(`<svg ${NS}><g>`), /could not be read/],
    ["not UTF-8", new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x3e, 0xff, 0x3c, 0x2f, 0x73, 0x76, 0x67, 0x3e]), /not UTF-8/],
  ];
  for (const [name, bytes, why] of refused) {
    const problem = svgProblem(bytes);
    assert.ok(problem, `${name} must be refused`);
    assert.match(problem!, why, name);
  }
});

test("an ordinary SVG from a drawing program still copies", () => {
  const drawn = `﻿<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with a drawing program -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="24" height="24" viewBox="0 0 24 24">
  <title>Tom &amp; Jerry&#39;s icon</title>
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color='#000'/></linearGradient>
    <style><![CDATA[ .a { fill: url(#g); } ]]></style>
    <path id="p" d="M0 0h24v24H0z"/>
  </defs>
  <g inkscape:label="Layer 1" class="a" style="stroke: url('#g'); stroke-width: 2">
    <use xlink:href="#p" />
    <image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>
    <a href="#p"><text x="1" y="2">Hi</text></a>
  </g>
</svg>
`;
  assert.equal(svgProblem(enc(drawn)), null);
  assert.equal(svgProblem(enc(`<svg ${NS} width="1" height="1"><rect width="1" height="1"/></svg>`)), null);
  // A link is followed only on a click, in the file opened on its own, so <a> may point out (as Wikimedia's SVG logo
  // does). It may not load anything, and javascript: is still refused.
  assert.equal(svgProblem(enc(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="http://www.w3.org/Graphics/SVG/"><rect/></a></svg>`)), null);
  assert.match(svgProblem(enc(`<svg ${NS}><a href=" javascript:alert(1)"><rect/></a></svg>`))!, /javascript:/);
  assert.match(svgProblem(enc(`<svg ${NS}><rect href="https://evil.example/"/></svg>`))!, /points at/);
});

function fakeBuild(fetchAsset: BuildAdapter["fetchAsset"]): BuildAdapter {
  return { build: async (files, env) => compile(files, env), verify: (code) => verifyOutput(code), fetchAsset };
}

const plugin = (jsx: string, name = "Logo") => ({
  "plugin.thx": `import { definePlugin } from "thixo/plugin";
import { todoDetail } from "@app/slots";

export default definePlugin(todoDetail, { name: ${JSON.stringify(name)}, description: "Shows pictures." }, function Logo() {
  return ${jsx};
});
`,
});

const imgs = (addresses: string[]) => `<div>${addresses.map((a) => `<img src="${a}" alt="x" />`).join("")}</div>`;
const envOf = (build: BuildAdapter) => createContext(app, { identity: () => null, adapters: { code: memoryCode(), data: memoryData(), build }, layout: {}, signingKey: "k" }).compileEnv;

test("one build has one deadline for all its copies, however many slow addresses it names", async () => {
  // Red team r3: 32 addresses on a trickling host were fetched in series, each with its own full timeout.
  const addresses = Array.from({ length: ASSET_LIMITS.files }, (_, i) => `https://slow.example.com/${i}.png`);
  let started = 0;
  const build = fakeBuild(async () => {
    started++;
    return new Promise<FetchedAsset>(() => {}); // never answers and ignores the signal
  });
  const t0 = Date.now();
  const result = await buildWithCopies(build, envOf(build), plugin(imgs(addresses)), { deadlineMs: 200 });
  const took = Date.now() - t0;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(took < 1500, `the build gave up at its deadline (took ${took} ms)`);
  assert.equal(result.errors.length, 1, "one error, not one per address");
  assert.match(result.errors[0].message, /may spend 0\.2 seconds copying all of a plugin's files, and it ran out of time/);
  assert.equal(started, ASSET_LIMITS.concurrency, "only a few fetches ever started");
  assert.equal(inSeconds(20_000), "20 seconds");
  assert.equal(inSeconds(300), "0.3 seconds");
});

test("the first copy that fails stops the rest, and the others are told to stop", async () => {
  const addresses = Array.from({ length: 12 }, (_, i) => `https://cdn.example.com/${i}.png`);
  const signals: AbortSignal[] = [];
  let running = 0;
  let most = 0;
  const build = fakeBuild(async (address: string, limits: AssetLimits) => {
    signals.push(limits.signal!);
    running++;
    most = Math.max(most, running);
    try {
      if (address.endsWith("/0.png")) {
        await new Promise((done) => setTimeout(done, 5));
        return { ok: false, message: "the host answered 404." };
      }
      await new Promise((done) => limits.signal!.addEventListener("abort", done));
      return { ok: false, message: "aborted" };
    } finally {
      running--;
    }
  });
  const result = await buildWithCopies(build, envOf(build), plugin(imgs(addresses)));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /0\.png into the app: the host answered 404/);
  assert.ok(most <= ASSET_LIMITS.concurrency);
  assert.ok(signals.length <= ASSET_LIMITS.concurrency, "nothing after the failure was fetched");
  assert.ok(signals.every((s) => s.aborted), "the copies still running were told to stop");
});

test("copies run a few at once and all land", async () => {
  const addresses = Array.from({ length: 10 }, (_, i) => `https://cdn.example.com/${i}.png`);
  let running = 0;
  let most = 0;
  const build = fakeBuild(async (address: string) => {
    running++;
    most = Math.max(most, running);
    await new Promise((done) => setTimeout(done, 5));
    running--;
    return { ok: true, bytes: enc(`png ${address}`), contentType: "image/png" };
  });
  const result = await buildWithCopies(build, envOf(build), plugin(imgs(addresses)));
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(Object.keys(result.manifest.assets ?? {}).length, 10);
  assert.equal(most, ASSET_LIMITS.concurrency);
});

function server(served: Record<string, Uint8Array>, extra: Partial<ThixoConfig> = {}): { thixo: Thixo; code: ReturnType<typeof memoryCode> } {
  const code = memoryCode();
  const users = structuredClone(USERS);
  const build = fakeBuild(async (address: string) => (served[address] ? { ok: true, bytes: served[address], contentType: "image/png" } : { ok: false, message: "the host answered 404." }));
  const thixo = createThixo(app, {
    identity: { identify: (request) => users[request.headers.get("cookie") ?? ""] ?? null, scopesOf: (id) => users[id]?.scopes ?? null },
    adapters: { code, data: memoryData(), build },
    layout: {},
    signingKey: "test-key",
    ...extra,
  });
  return { thixo, code };
}

const MiB = 1024 * 1024;
const image = (n: number, size = 1.2 * MiB) => new Uint8Array(Math.floor(size)).fill(n);

test("what one person's submits store is capped, each file counted once, and a refused submit stores nothing", async () => {
  // Red team r3: one author stored 96 MiB with 12 plugins of 4 distinct 2 MiB images, with no limit hit.
  const served: Record<string, Uint8Array> = {};
  for (let i = 0; i < 4; i++) served[`https://cdn.example.com/${i}.png`] = image(i + 1);
  const { thixo, code } = server(served, { assetQuota: { authorBytes: 3 * MiB } });
  const submit = (user: string, i: number, name = `Logo ${i}`) => thixo.services.registry.submit({ user: USERS[user], files: plugin(`<img src="https://cdn.example.com/${i}.png" alt="x" />`, name) });

  assert.ok((await submit("ana", 0)).ok);
  assert.ok((await submit("ana", 1)).ok, "2.4 MiB is under 3");
  assert.ok((await submit("ana", 0, "Same picture again")).ok, "a file she already stored does not count twice");
  const over = await submit("ana", 2);
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.equal(over.errors[0].code, "build/asset-quota");
    assert.match(over.errors[0].message, /bring yours to 3\.6 MiB, over the 3 MiB one person may store/);
  }
  assert.equal(code.objects.has(`assets/${sha(served["https://cdn.example.com/2.png"])}`), false, "the refused submit stored nothing");
  assert.equal((await thixo.services.registry.search({ user: USERS.ana })).filter((s) => s.plugin.author === "ana").length, 3, "and made no plugin");

  assert.ok((await submit("ben", 2)).ok, "another person has their own cap");
});

test("what everyone's submits store together is capped too; deploys and forks do not count", async () => {
  const served: Record<string, Uint8Array> = {};
  for (let i = 0; i < 4; i++) served[`https://cdn.example.com/${i}.png`] = image(i + 1);
  const { thixo } = server(served, { assetQuota: { totalBytes: 3 * MiB } });
  const submit = (user: string, i: number) => thixo.services.registry.submit({ user: USERS[user], files: plugin(`<img src="https://cdn.example.com/${i}.png" alt="x" />`, `Logo ${user} ${i}`) });

  // The implementor's deploy stores 2.4 MiB and is not counted.
  const files = plugin(imgs(["https://cdn.example.com/2.png", "https://cdn.example.com/3.png"]), "Default logo");
  files["plugin.thx"] = files["plugin.thx"].replace(`{ name: "Default logo"`, `{ id: "logo", name: "Default logo"`);
  await thixo.services.deploy({ plugins: { logo: files }, layout: {}, deployment: "one" });

  const first = await submit("ana", 0);
  assert.ok(first.ok);
  if (!first.ok) return;
  await thixo.services.registry.share({ user: USERS.ana, plugin: first.plugin.id });
  await thixo.services.registry.fork({ user: USERS.ben, ref: { plugin: first.plugin.id, number: 1 } });
  assert.ok((await submit("ben", 1)).ok, "2.4 MiB in all: ben's fork stored nothing new");
  const over = await submit("ben", 0 + 2);
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.errors[0].message, /bring this app's to 3\.6 MiB, over the 3 MiB its people may store together/);
});

test("every route that serves a copied file sends the inert asset headers", () => {
  // The CSP sandbox is the second wall behind the SVG check: no route may serve a copy without it.
  const root = fileURLToPath(new URL("../src/server", import.meta.url));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : name.endsWith(".ts") ? [join(dir, name)] : []));
  const serving = walk(root).filter((file) => {
    const text = readFileSync(file, "utf8");
    return /registry\.asset\(|readAsset\(/.test(text) && !file.endsWith("assets.ts") && !file.endsWith("service.ts");
  });
  assert.ok(serving.length >= 1, "the asset route was found");
  for (const file of serving) assert.match(readFileSync(file, "utf8"), /new Response\([^)]*\{ headers: assetHeaders\(/, file);
});
