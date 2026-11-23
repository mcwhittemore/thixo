import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHECKOUT_PACKAGES, createApp, checkName, findCheckout, freshPluginId, UsageError } from "../lib/create.js";
import { main } from "../lib/cli.js";

const TEMPLATE = fileURLToPath(new URL("../template/", import.meta.url));

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "create-thixo-app-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sequence(values) {
  let i = 0;
  return () => values[i++];
}

test("copies the template into a new folder and names the app", async () => {
  await withTempDir(async (cwd) => {
    const result = await createApp({ name: "my-app", cwd });

    assert.equal(result.dir, join(cwd, "my-app"));
    const pkg = JSON.parse(await readFile(join(cwd, "my-app", "package.json"), "utf8"));
    assert.equal(pkg.name, "my-app");
    const shell = await readFile(join(cwd, "my-app", "app", "shell.tsx"), "utf8");
    assert.match(shell, />my-app</);
    assert.doesNotMatch(shell, /__APP_NAME__/);

    for (const file of ["thixo.config.ts", "api/hello.ts", "api/session.ts", "app/slots.ts", "app/shell.tsx"]) {
      await readFile(join(cwd, "my-app", file));
    }
    assert.ok(result.files.includes(".gitignore"));
    assert.ok(!result.files.includes("gitignore"));
    await readFile(join(cwd, "my-app", ".gitignore"), "utf8");
  });
});

test("gives each default plugin a fresh plg_ id, distinct from another app's", async () => {
  await withTempDir(async (cwd) => {
    const first = await createApp({ name: "one", cwd });
    const second = await createApp({ name: "two", cwd });

    assert.equal(first.pluginIds.length, 1);
    assert.equal(new Set([...first.pluginIds, ...second.pluginIds]).size, 2);
    for (const id of [...first.pluginIds, ...second.pluginIds]) assert.match(id, /^plg_[0-9a-f]{18}$/);

    const hello = await readFile(join(cwd, "one", "plugins", "hello", "plugin.thx"), "utf8");
    assert.deepEqual([hello.match(/id: "(plg_[^"]+)"/)?.[1]], first.pluginIds);
    assert.doesNotMatch(hello, /plg_hello"/);
  });
});

test("uses the random source for plugin ids in order", async () => {
  await withTempDir(async (cwd) => {
    const random = sequence(["aaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbb"]);
    const result = await createApp({ name: "fixed", cwd, random });
    assert.deepEqual(result.pluginIds, ["plg_aaaaaaaaaaaaaaaaaa"]);
  });
});

test("refuses a folder that already has files and leaves it untouched", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "taken"));
    await writeFile(join(cwd, "taken", "keep.txt"), "mine");

    await assert.rejects(createApp({ name: "taken", cwd }), (error) => error instanceof UsageError && /not empty/.test(error.message));
    assert.deepEqual(await readdir(join(cwd, "taken")), ["keep.txt"]);
  });
});

test("writes into an empty folder that already exists", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "empty"));
    const result = await createApp({ name: "empty", cwd });
    assert.equal(result.pluginIds.length, 1);
  });
});

test("refuses a name that is not a folder name for an app", () => {
  for (const name of ["My App", "../escape", "a/b", "", "-leading", "dots.app"]) {
    assert.throws(() => checkName(name), UsageError, name);
  }
  checkName("todo-2");
});

test("the CLI prints next steps and exits 0, and exits 1 on a refused name", async () => {
  await withTempDir(async (cwd) => {
    const out = [];
    const err = [];
    assert.equal(await main(["cli-app"], { cwd, out: (s) => out.push(s), err: (s) => err.push(s) }), 0);
    assert.match(out.join("\n"), /npm install/);
    assert.match(out.join("\n"), /npm run dev/);

    assert.equal(await main(["cli-app"], { cwd, out: () => {}, err: (s) => err.push(s) }), 1);
    assert.match(err.join("\n"), /not empty/);
  });
});

test("freshPluginId uses plg_ and the random hex", () => {
  assert.equal(freshPluginId(() => "0123456789abcdef01"), "plg_0123456789abcdef01");
});

test("the template is a neutral starter: one endpoint, one slot, one hello plugin, no todos", async () => {
  assert.deepEqual((await readdir(join(TEMPLATE, "plugins"))).sort(), ["hello"]);
  assert.deepEqual((await readdir(join(TEMPLATE, "plugins", "hello"))).sort(), ["data.thx", "plugin.thx"]);
  assert.deepEqual((await readdir(join(TEMPLATE, "api"))).sort(), ["hello.ts", "scopes.ts", "session.ts"]);
  const slots = await readFile(join(TEMPLATE, "app", "slots.ts"), "utf8");
  assert.equal(slots.match(/slot\.(page|panel|row|child)/g)?.length, 1);
  const hello = await readFile(join(TEMPLATE, "plugins", "hello", "plugin.thx"), "utf8");
  assert.match(hello, /import \{ hello \} from "@app\/sdk"/);
  assert.match(hello, /useStore\(prefs\)/);
  const shell = await readFile(join(TEMPLATE, "app", "shell.tsx"), "utf8");
  assert.match(shell, /<AuthoringChat \/>/);
  const all = [slots, hello, shell, await readFile(join(TEMPLATE, "thixo.config.ts"), "utf8")].join("\n");
  assert.doesNotMatch(all, /todo/i);
});

test("the readme tells a newcomer three things to try next", async () => {
  const readme = await readFile(fileURLToPath(new URL("../readme.md", import.meta.url)), "utf8");
  const section = readme.split("## Try these next")[1]?.split("\n## ")[0] ?? "";
  assert.equal(section.match(/^\d\. /gm)?.length, 3);
});

test("run from a Thixo checkout, package.json links the packages and React from it, so npm install needs no registry", async () => {
  const root = await findCheckout();
  assert.ok(root, "these tests run inside the checkout, after its npm install");
  await withTempDir(async (cwd) => {
    const result = await createApp({ name: "linked", cwd });
    assert.equal(result.checkout, root);
    const pkg = JSON.parse(await readFile(join(cwd, "linked", "package.json"), "utf8"));
    for (const [dep, path] of Object.entries(CHECKOUT_PACKAGES)) assert.equal(pkg.dependencies[dep], `file:${join(root, path)}`, dep);

    const out = [];
    assert.equal(await main(["printed"], { cwd, out: (s) => out.push(s), err: () => {} }), 0);
    assert.match(out.join("\n"), /not on npm yet, so package\.json links them/);
    assert.match(out.join("\n"), /thixo agent describe/);
  });
});

test("with checkout: null, package.json keeps the npm versions", async () => {
  await withTempDir(async (cwd) => {
    const result = await createApp({ name: "pinned", cwd, checkout: null });
    assert.equal(result.checkout, null);
    const pkg = JSON.parse(await readFile(join(cwd, "pinned", "package.json"), "utf8"));
    assert.equal(pkg.dependencies.thixo, "0.0.1");
    assert.equal(pkg.dependencies.react, "^19.0.0");
  });
});

test("a folder that is not a Thixo checkout is not taken for one", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "a", "b", "template"), { recursive: true });
    assert.equal(await findCheckout(join(cwd, "a", "b", "template")), null);
  });
});
