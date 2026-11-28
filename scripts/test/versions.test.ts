import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkVersions, compareVersions, publishOrder, readWorkspaces } from "../src/versions.ts";

function manifest(name: string, version: string, dependencies: Record<string, string> = {}): string {
  return `${JSON.stringify({ name, version, files: ["dist"], dependencies }, null, 2)}\n`;
}

function repo(): { dir: string; write: (path: string, text: string) => void; commit: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "thixo-versions-"));
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (): void => {
    git("add", "-A");
    git("commit", "-q", "-m", "change", "--allow-empty");
  };
  write("packages/core/package.json", manifest("@thixo/core", "0.1.0"));
  write("packages/core/src/index.ts", "export const a = 1;\n");
  write("packages/core/test/a.test.ts", "// test\n");
  write("packages/react/package.json", manifest("@thixo/react", "0.1.0", { "@thixo/core": "0.1.0" }));
  write("packages/react/src/index.ts", "export const b = 1;\n");
  write("docs/language.md", "# language\n");
  commit();
  git("branch", "base");
  return { dir, write, commit };
}

test("a pull request that changes no package passes", () => {
  const r = repo();
  r.write("docs/language.md", "# language, edited\n");
  r.commit();
  assert.deepEqual(checkVersions(r.dir, "base"), []);
});

test("a test-only change needs no new version", () => {
  const r = repo();
  r.write("packages/core/test/a.test.ts", "// another test\n");
  r.commit();
  assert.deepEqual(checkVersions(r.dir, "base"), []);
});

test("a source change without a new version fails", () => {
  const r = repo();
  r.write("packages/react/src/index.ts", "export const b = 2;\n");
  r.commit();
  const problems = checkVersions(r.dir, "base");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^@thixo\/react changed but its version, 0\.1\.0, is not above 0\.1\.0/);
});

test("a source change with a new version passes", () => {
  const r = repo();
  r.write("packages/react/src/index.ts", "export const b = 2;\n");
  r.write("packages/react/package.json", manifest("@thixo/react", "0.1.1", { "@thixo/core": "0.1.0" }));
  r.commit();
  assert.deepEqual(checkVersions(r.dir, "base"), []);
});

test("a lower version fails", () => {
  const r = repo();
  r.write("packages/react/src/index.ts", "export const b = 2;\n");
  r.write("packages/react/package.json", manifest("@thixo/react", "0.0.9", { "@thixo/core": "0.1.0" }));
  r.commit();
  assert.match(checkVersions(r.dir, "base")[0], /@thixo\/react changed but its version, 0\.0\.9, is not above 0\.1\.0/);
});

test("raising core without updating the pins in its dependents fails", () => {
  const r = repo();
  r.write("packages/core/src/index.ts", "export const a = 2;\n");
  r.write("packages/core/package.json", manifest("@thixo/core", "0.2.0"));
  r.commit();
  assert.deepEqual(checkVersions(r.dir, "base"), [
    "@thixo/react depends on @thixo/core@0.1.0, but @thixo/core is 0.2.0. Pin it to 0.2.0.",
  ]);
});

test("updating a pin is a change to the dependent, so it needs a new version too", () => {
  const r = repo();
  r.write("packages/core/src/index.ts", "export const a = 2;\n");
  r.write("packages/core/package.json", manifest("@thixo/core", "0.2.0"));
  r.write("packages/react/package.json", manifest("@thixo/react", "0.1.0", { "@thixo/core": "0.2.0" }));
  r.commit();
  const problems = checkVersions(r.dir, "base");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^@thixo\/react changed but its version, 0\.1\.0, is not above 0\.1\.0/);

  r.write("packages/react/package.json", manifest("@thixo/react", "0.1.1", { "@thixo/core": "0.2.0" }));
  r.commit();
  assert.deepEqual(checkVersions(r.dir, "base"), []);
});

test("changes already on the base branch don't count against the pull request", () => {
  const r = repo();
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: r.dir, stdio: "ignore" });
  };
  git("checkout", "-q", "base");
  r.write("packages/core/src/index.ts", "export const a = 3;\n");
  r.write("packages/core/package.json", manifest("@thixo/core", "0.1.1"));
  r.write("packages/react/package.json", manifest("@thixo/react", "0.1.1", { "@thixo/core": "0.1.1" }));
  r.commit();
  git("checkout", "-q", "main");
  r.write("docs/language.md", "# language, edited\n");
  r.commit();
  assert.deepEqual(checkVersions(r.dir, "base"), []);
});

test("a pull request behind its base must raise its version above the base's", () => {
  const r = repo();
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: r.dir, stdio: "ignore" });
  };
  git("checkout", "-q", "base");
  r.write("packages/react/src/index.ts", "export const b = 3;\n");
  r.write("packages/react/package.json", manifest("@thixo/react", "0.1.1", { "@thixo/core": "0.1.0" }));
  r.commit();
  git("checkout", "-q", "main");
  r.write("packages/react/src/index.ts", "export const b = 2;\n");
  r.write("packages/react/package.json", manifest("@thixo/react", "0.1.1", { "@thixo/core": "0.1.0" }));
  r.commit();
  assert.match(checkVersions(r.dir, "base")[0], /0\.1\.1, is not above 0\.1\.1\. Raise it above 0\.1\.1/);
});

test("versions compare by number, not by text", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.throws(() => compareVersions("0.1", "0.1.0"), /not a MAJOR\.MINOR\.PATCH version/);
});

test("packages publish after the packages they depend on", () => {
  const r = repo();
  r.write("packages/a-cli/package.json", manifest("@thixo/cli", "0.1.0", { "@thixo/core": "0.1.0" }));
  r.commit();
  const order = publishOrder(readWorkspaces(r.dir)).map((w) => w.manifest.name);
  assert.equal(order.indexOf("@thixo/core"), 0);
  assert.equal(order.length, 3);
});
