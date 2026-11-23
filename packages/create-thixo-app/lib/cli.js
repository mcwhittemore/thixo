import { checkoutBuilt, createApp, UsageError } from "./create.js";

export const USAGE = `create-thixo-app: start a new Thixo app in a new folder.

Usage
  create-thixo-app <name>

<name> is the new folder and the app's name. Use lower-case letters, digits and dashes.
The folder must not exist yet, or must be empty.`;

export function nextSteps(name, { checkout = null, built = true } = {}) {
  const lines = [`Created ${name}.`, ""];
  if (checkout) {
    lines.push(
      `thixo, thixo-cli, thixo-node and thixo-anthropic are not on npm yet, so package.json links them, and React, from the Thixo checkout`,
      `at ${checkout}.`,
    );
    if (!built) lines.push(`Build it first: cd ${checkout} && npm install && npm run build`);
    lines.push("");
  }
  lines.push(
    "Next:",
    `  cd ${name}`,
    "  npm install",
    "  npm run dev",
    "",
    'Then open the address dev prints and pick a user in "Signed in as": ana or ben.',
    "With dev running, `npx thixo agent describe --as ana` prints the plugin language and every component's props.",
  );
  return lines.join("\n");
}

/** Runs one command line and returns the exit code. */
export async function main(argv, { cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  const [name, ...rest] = argv;
  if (name === undefined || name === "-h" || name === "--help") {
    out(USAGE);
    return name === undefined ? 1 : 0;
  }
  if (rest.length > 0) {
    err(`create-thixo-app: takes one name, got ${argv.length}.\n${USAGE}`);
    return 1;
  }
  try {
    const result = await createApp({ name, cwd });
    out(nextSteps(result.name, { checkout: result.checkout, built: result.checkout ? await checkoutBuilt(result.checkout) : true }));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err(`create-thixo-app: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
