import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { verifyOutput } from "../src/index.js";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) } } };
}

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "thixo-cli-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

test("compile writes a verified module", () => {
  const dir = folder({ "main.thx": 'import { label } from "./lib/label";\nexport default function App() { return <p>{label()}</p>; }\n', "lib/label.thx": 'export function label() { return "hi"; }\n' });
  const out = join(dir, "out.js");
  const t = io();
  assert.equal(main(["compile", dir, "-o", out], t.io), 0);
  assert.ok(existsSync(out));
  assert.deepEqual(verifyOutput(readFileSync(out, "utf8")), { ok: true });
});

test("compile prints code to stdout without -o, and JSON with --json", () => {
  const dir = folder({ "main.thx": "export default function App() { return <div />; }\n" });
  const t = io();
  assert.equal(main(["compile", dir], t.io), 0);
  assert.match(t.out.join(""), /^export default function \(rt\)/);
  const j = io();
  assert.equal(main(["compile", join(dir, "main.thx"), "--json"], j.io), 0);
  const parsed = JSON.parse(j.out.join(""));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.imports, []);
  assert.match(parsed.code, /rt\.app/);
});

test("host modules come from a JSON file of declarations", () => {
  const dir = folder({
    "main.thx": 'import { greet } from "@host/greet";\nexport default function App() { return <p>{greet("a")}</p>; }\n',
    "greet.d.ts": "export declare function greet(name: string): string;\n",
    "modules.json": JSON.stringify({ "@host/greet": "greet.d.ts" }),
  });
  const t = io();
  assert.equal(main(["compile", dir, "--modules", join(dir, "modules.json"), "--json", "-o", join(dir, "o.js")], t.io), 0, t.err.join(""));
  assert.deepEqual(JSON.parse(t.out.join("")).imports, ["@host/greet"]);
  const without = io();
  assert.equal(main(["compile", dir, "-o", join(dir, "o.js")], without.io), 1);
});

test("a bad program exits 1 with file:line:column code", () => {
  const dir = folder({ "main.thx": "export default function App() {\n  return <div>{window.location.href}</div>;\n}\n" });
  const t = io();
  assert.equal(main(["compile", dir], t.io), 1);
  assert.match(t.err.join(""), /^main\.thx:2:\d+ thixo\/no-global /m);
  const j = io();
  assert.equal(main(["compile", dir, "--json"], j.io), 1);
  assert.equal(JSON.parse(j.out.join("")).ok, false);
});

test("bad usage exits 2", () => {
  assert.equal(main([], io().io), 2);
  assert.equal(main(["build", "x"], io().io), 2);
  assert.equal(main(["compile"], io().io), 2);
  assert.equal(main(["compile", "a", "--nope"], io().io), 2);
  assert.equal(main(["compile", "/definitely/not/here"], io().io), 2);
});
