import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp, checkName, freshPluginId, UsageError } from "../lib/create.js";
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

    for (const file of ["thixo.config.ts", "api/todos.ts", "api/session.ts", "app/slots.ts", "app/shell.tsx"]) {
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

    assert.equal(first.pluginIds.length, 2);
    assert.equal(new Set([...first.pluginIds, ...second.pluginIds]).size, 4);
    for (const id of [...first.pluginIds, ...second.pluginIds]) assert.match(id, /^plg_[0-9a-f]{18}$/);

    const list = await readFile(join(cwd, "one", "plugins", "todo-list", "plugin.thx"), "utf8");
    const info = await readFile(join(cwd, "one", "plugins", "todo-info", "plugin.thx"), "utf8");
    const written = [list, info].map((text) => text.match(/id: "(plg_[^"]+)"/)?.[1]);
    assert.deepEqual(written.slice().sort(), first.pluginIds.slice().sort());
    assert.doesNotMatch(list + info, /plg_todo_/);
  });
});

test("uses the random source for plugin ids in order", async () => {
  await withTempDir(async (cwd) => {
    const random = sequence(["aaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbb"]);
    const result = await createApp({ name: "fixed", cwd, random });
    assert.deepEqual(result.pluginIds, ["plg_aaaaaaaaaaaaaaaaaa", "plg_bbbbbbbbbbbbbbbbbb"]);
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
    assert.equal(result.pluginIds.length, 2);
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

test("the template exists and has the default plugins", async () => {
  const plugins = await readdir(join(TEMPLATE, "plugins"));
  assert.deepEqual(plugins.sort(), ["todo-info", "todo-list"]);
});
