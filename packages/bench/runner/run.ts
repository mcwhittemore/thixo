// npm run bench -- [--goal read-dom,network-out] [--model claude-opus-5-5] [--attempts 15] [--turns 80]
//                  [--budget 5] [--black-box] [--out packages/bench/results]
// npm run bench -- replay <folder of .thx files> --goal <id>
//
// Runs an agent against each goal and writes every attempt, and a summary, under the results folder. `replay`
// submits a saved program once: use it to check that a found escape is fixed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readProgram } from "@thixo/cli";
import { runAgent, type RunSummary } from "./agent.js";
import { Arena, feedback } from "../src/arena/arena.js";
import { goal, GOALS } from "../src/goals.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]): Promise<number> {
  const arena = new Arena();
  await arena.start();
  try {
    if (args[0] === "replay") {
      const folder = args[1];
      const id = flag(args, "goal");
      if (!folder || !id) throw new Error("usage: replay <folder> --goal <id>");
      const r = await arena.attempt(goal(id), readProgram(folder).files);
      console.log(feedback(r));
      return r.achieved ? 1 : 0;
    }
    const ids = flag(args, "goal")?.split(",") ?? GOALS.map((g) => g.id);
    const model = flag(args, "model") ?? "claude-opus-5-5";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const root = resolve(flag(args, "out") ?? "results", stamp);
    const summaries: RunSummary[] = [];
    for (const id of ids) {
      const g = goal(id);
      console.log(`\n== ${g.id}: ${g.title}`);
      const s = await runAgent(g, arena, {
        model,
        maxAttempts: Number(flag(args, "attempts") ?? 15),
        maxTurns: Number(flag(args, "turns") ?? 80),
        maxBudgetUsd: Number(flag(args, "budget") ?? 5),
        whiteBox: !args.includes("--black-box"),
        out: join(root, g.id),
        log: (l) => console.log(`  ${l}`),
      });
      summaries.push(s);
      console.log(`  -> ${s.achieved ? `ESCAPED on attempt ${s.winningAttempt}` : `held (${s.stoppedBecause})`} after ${s.attempts} attempts${s.costUsd !== undefined ? `, $${s.costUsd.toFixed(2)}` : ""}`);
    }
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "summary.json"), JSON.stringify(summaries, null, 2));
    console.log(`\n${summaries.filter((s) => s.achieved).length} of ${summaries.length} goals reached. Results in ${root}`);
    return summaries.some((s) => s.achieved) ? 1 : 0;
  } finally {
    await arena.stop();
  }
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (e) => {
    console.error(e);
    process.exitCode = 2;
  },
);
