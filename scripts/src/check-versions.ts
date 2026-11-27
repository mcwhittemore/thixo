import { fileURLToPath } from "node:url";
import { checkVersions } from "./versions.ts";

const base = process.argv[2];
if (!base) {
  console.error("usage: check-versions <base-ref>");
  process.exit(2);
}

const problems = checkVersions(fileURLToPath(new URL("../..", import.meta.url)), base);
for (const problem of problems) console.error(problem);
if (problems.length > 0) process.exit(1);
console.log(`Every package that changed since ${base} has a new version.`);
