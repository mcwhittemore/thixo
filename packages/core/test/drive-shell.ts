// Drives the todo example's real shell (examples/todo/app/shell.tsx, bundled for the browser with esbuild, as the
// CLI will) in Chromium, with the example's .thx plugins compiled by the real thx compiler and run by the real
// runtime. The token, /_thixo/app and /api are the real server; layout, plugin loads and code, registry, data and
// authoring are the in-memory stand-ins in helpers/todo-server.ts. Prints what it saw; saves screenshots.
//
//   node --import tsx packages/core/test/drive-shell.ts [artifacts-dir]     drive, then stop
//   node --import tsx packages/core/test/drive-shell.ts --serve             serve on a port and wait

import { build } from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { PluginSummary } from "../src/contract.js";
import { compile } from "thixo-thx";
import { buildCompileEnv } from "../src/server/index.js";
import { pluginLoad } from "./helpers/plugins.js";
import { app, fakeServer, type FakeVersion } from "./helpers/todo-server.js";

const here = import.meta.dirname;
const repo = resolve(here, "../../..");
const serve = process.argv.includes("--serve");
const artifacts = resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(repo, "artifacts/shell-and-plugins"));

const env = buildCompileEnv(app, {});
const pluginsDir = join(repo, "examples/todo/plugins");
/** Each of the example's plugin folders, compiled by the real thx compiler. */
function compiled(name: string, id: string): FakeVersion {
  const files: Record<string, string> = {};
  for (const file of readdirSync(join(pluginsDir, name))) files[file] = readFileSync(join(pluginsDir, name, file), "utf8");
  const result = compile(files, env);
  if (!result.ok) throw new Error(`${name} does not compile: ${JSON.stringify(result.errors)}`);
  return { load: pluginLoad(id, result.meta.name, result.manifest), code: result.code };
}
const versions: FakeVersion[] = [compiled("todo-list", "plg_todo_list"), compiled("done-badge", "plg_done_badge"), compiled("due-dates", "plg_due_dates")];
const summaries: PluginSummary[] = versions.map((v) => ({
  plugin: v.load.plugin,
  latest: 1,
  manifest: v.load.manifest,
  summary: v.load.plugin.id === "plg_due_dates" ? ["Reads todos", "Adds a due date to todos"] : ["Reads todos"],
  requiredScopes: ["todos.read"],
  optionalScopes: [],
  isDefault: true,
}));

/** userCan depends on who asks: the stand-in answers for the cookie's user, as the real plugin route will. */
const scopesOf: Record<string, string[]> = {
  ana: ["listTodos", "createTodo", "updateTodo", "listAssignees", "getTodo"],
  ben: ["listTodos", "createTodo", "updateTodo", "deleteTodo", "listAssignees", "getTodo"],
  cy: ["listTodos", "getTodo"],
};

const backends = new Map<string, ReturnType<typeof fakeServer>>();
function backendFor(user: string) {
  let b = backends.get(user);
  if (!b) {
    const own = versions.map((v) => ({ ...v, load: { ...v.load, userCan: [...v.load.manifest.requiredEndpoints, ...v.load.manifest.optionalEndpoints].filter((e) => scopesOf[user]?.includes(e)) } }));
    b = fakeServer({
      user,
      versions: own,
      layout: { main: { plugin: "plg_todo_list", number: 1 }, "main/todo-row": { plugin: "plg_done_badge", number: 1 }, "todo-detail": { plugin: "plg_due_dates", number: 1 } },
      summaries,
    });
    backends.set(user, b);
  }
  return b;
}

const bundle = await build({
  stdin: {
    contents: `import App from ${JSON.stringify(join(repo, "examples/todo/app/shell.tsx"))};\nimport { mount } from "thixo/shell";\nmount(App);\n`,
    resolveDir: join(repo, "examples/todo"),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "error",
});
const shellJs = bundle.outputFiles[0].text;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Todos</title></head><body style="margin:0"><div id="root"></div><script type="module" src="/shell.js"></script></body></html>`;

function body(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((ok) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/" || !url.pathname.startsWith("/_thixo") && !url.pathname.startsWith("/api") && url.pathname !== "/shell.js") {
    res.writeHead(200, { "content-type": "text/html" }).end(html);
    return;
  }
  if (url.pathname === "/shell.js") {
    res.writeHead(200, { "content-type": "text/javascript" }).end(shellJs);
    return;
  }
  const cookie = req.headers.cookie ?? "";
  const user = /thixo-user=([^;]+)/.exec(cookie)?.[1];
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
  const reply = user
    ? await backendFor(user).fetch(url.pathname + url.search, { method: req.method, headers, body: await body(req) })
    : new Response(JSON.stringify({ error: { code: "unauthorized", message: "Not signed in" } }), { status: 401, headers: { "content-type": "application/json" } });
  res.writeHead(reply.status, Object.fromEntries(reply.headers));
  res.end(Buffer.from(await reply.arrayBuffer()));
});
await new Promise<void>((ok) => server.listen(serve ? Number(process.env.PORT ?? 4317) : 0, "127.0.0.1", ok));
const port = (server.address() as { port: number }).port;
const origin = `http://127.0.0.1:${port}`;
console.log(`serving the todo shell at ${origin}`);

if (serve) {
  console.log("set the thixo-user cookie with the header's user switcher; Ctrl-C to stop");
} else {
  mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const say = (line: string) => console.log(line);
  try {
    await page.goto(origin);
    say(`no cookie: ${await page.getByRole("alert", { name: "Sign-in problem" }).textContent()}`);

    await page.getByRole("combobox", { name: "Signed in as" }).selectOption("ana");
    await page.waitForSelector('[data-slot="main"][data-plugin]');
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="main/todo-row"][data-plugin]').length >= 3);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="main/todo-row"]')].every((e) => /Done|Open/.test(e.textContent ?? "")));
    say(`ana: signed in as ${await page.getByRole("combobox", { name: "Signed in as" }).inputValue()}`);
    say(`main slot: ${await page.getByRole("region", { name: "Todo list (main)" }).getAttribute("data-plugin")}`);
    const badges = await page.locator('[data-slot="main/todo-row"][data-plugin]').allTextContents();
    say(`row badges (main/todo-row): ${badges.join(", ")}`);
    const style = await page.locator('[data-slot="main"][data-plugin]').evaluate((e) => {
      const s = getComputedStyle(e);
      return `contain=${s.contain} overflow=${s.overflow} isolation=${s.isolation} position=${s.position}`;
    });
    say(`main box: ${style}`);
    const deleteButtons = page.getByRole("button", { name: "Delete" });
    say(`ana Delete buttons disabled: ${(await deleteButtons.evaluateAll((els) => els.map((e) => (e as HTMLButtonElement).disabled))).join(",")}`);
    await page.screenshot({ path: join(artifacts, "ana-list.png") });

    await page.getByRole("button", { name: "Write the quarterly report" }).click();
    const detail = page.getByRole("region", { name: "Due dates (todo-detail)" });
    await detail.waitFor();
    await detail.locator('input[type="date"]').fill("2026-12-01");
    await page.waitForTimeout(200);
    const patch = backendFor("ana").requests.find((r) => r.path === "/_thixo/data/patch");
    say(`due date patch: ${JSON.stringify(patch?.body)}`);
    await page.screenshot({ path: join(artifacts, "ana-detail.png") });

    await page.getByRole("button", { name: "Plugins" }).click();
    const panel = page.getByRole("region", { name: "Plugin browser" });
    await panel.getByRole("listitem", { name: "Due dates" }).waitFor();
    for (const path of ["main", "main/todo-row", "todo-detail"]) say(`layout ${path}: ${await panel.getByTestId(`slot-fill-${path}`).textContent()}`);
    say(`Due dates summary: ${(await panel.getByRole("list", { name: "What Due dates does" }).locator("li").allTextContents()).join("; ")}`);
    say(`Promote Due dates: disabled=${await panel.getByRole("button", { name: "Promote Due dates" }).isDisabled()} (${await panel.getByRole("button", { name: "Promote Due dates" }).getAttribute("title")})`);
    say(`Use Todo list: disabled=${await panel.getByRole("button", { name: "Use Todo list" }).isDisabled()} (${await panel.getByRole("button", { name: "Use Todo list" }).getAttribute("title")})`);
    await page.screenshot({ path: join(artifacts, "ana-plugin-browser.png") });

    await page.getByRole("combobox", { name: "Signed in as" }).selectOption("ben");
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="main/todo-row"][data-plugin]').length >= 3);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].filter((b) => b.textContent === "Delete").length >= 3);
    say(`ben Delete buttons disabled: ${(await page.getByRole("button", { name: "Delete" }).evaluateAll((els) => els.map((e) => (e as HTMLButtonElement).disabled))).join(",")}`);
    await page.screenshot({ path: join(artifacts, "ben-list.png") });
    say(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => undefined);
    console.error(`drive failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(artifacts, "requests.json"), JSON.stringify(Object.fromEntries([...backends].map(([u, b]) => [u, b.requests.map((r) => `${r.method} ${r.path}`)])), null, 2));
    await browser.close();
    server.close();
  }
}
