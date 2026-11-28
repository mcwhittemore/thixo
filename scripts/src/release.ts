import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { publishOrder, readWorkspaces } from "./versions.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

function published(name: string, version: string): boolean {
  try {
    return execFileSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" }).trim() === version;
  } catch {
    return false;
  }
}

function run(command: string, args: string[]): void {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

for (const { manifest } of publishOrder(readWorkspaces(root))) {
  const { name, version } = manifest;
  if (published(name, version)) {
    console.log(`${name}@${version} is already on npm.`);
    continue;
  }
  if (dryRun) {
    run("npm", ["publish", "--workspace", name, "--dry-run"]);
    continue;
  }
  run("npm", ["publish", "--workspace", name]);
  run("git", ["tag", `${name}@${version}`]);
  run("git", ["push", "origin", `${name}@${version}`]);
}
