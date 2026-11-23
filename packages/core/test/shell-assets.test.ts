// The shell hands the runtime where a version's copied files are served, with the load route's ticket, and an image
// a plugin wrote out reaches the DOM as a path on the app, never as the outside address.

import { window, waitFor } from "./helpers/dom.js";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { compile } from "thixo-thx";
import { createRuntime } from "thixo-thx/runtime";
import { main } from "../../../examples/todo/app/slots.js";
import { buildCompileEnv } from "../src/server/index.js";
import { Shell, Slot } from "../src/shell/index.js";
import { pluginLoad } from "./helpers/plugins.js";
import { app, fakeServer } from "./helpers/todo-server.js";

const h = React.createElement;
const doc = window.document;
const LOGO = "https://cdn.example.com/logo.png";
const FILE = `${"ab".repeat(32)}.png`;

const source = `import { definePlugin } from "thixo/plugin";
import { main } from "@app/slots";

export default definePlugin(main, { name: "Logo", description: "A logo." }, function Logo() {
  return <div><img src="${LOGO}" alt="copied" /><a href="https://docs.example.com/help">Help</a></div>;
});
`;
const result = compile({ "plugin.thx": source }, { ...buildCompileEnv(app, {}), assets: { [LOGO]: FILE } });
if (!result.ok) throw new Error(JSON.stringify(result.errors));
const load = pluginLoad("plg_logo", "Logo", result.manifest, { assets: { path: "/_thixo/plugins/plg_logo/1/assets/", query: "u=ana&e=1&k=sig" } });
const server = fakeServer({ user: "ana", versions: [{ load, code: result.code }], layout: { main: { plugin: "plg_logo", number: 1 } } });
const loadModule = (text: string) => import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);

const container = doc.createElement("div");
doc.body.appendChild(container);
const root = createRoot(container as unknown as Element);
after(() => root.unmount());

test("a copied image renders from the app's asset route with the ticket, and the link goes out as written", async () => {
  root.render(h(Shell, { fetch: server.fetch, createRuntime, loadModule }, h(Slot, { is: main } as never)));
  const img = await waitFor(() => doc.querySelector('[data-slot="main"] img') as unknown as HTMLImageElement | null, "the image");
  assert.equal(img.getAttribute("src"), `/_thixo/plugins/plg_logo/1/assets/${FILE}?u=ana&e=1&k=sig`);
  assert.equal(doc.querySelector('[data-slot="main"] [role="alert"]'), null);
  const link = doc.querySelector('[data-slot="main"] a') as unknown as HTMLAnchorElement;
  assert.equal(link.getAttribute("href"), "https://docs.example.com/help");
  assert.ok(!container.innerHTML.includes("cdn.example.com"), "the outside address is nowhere in the page");
});
