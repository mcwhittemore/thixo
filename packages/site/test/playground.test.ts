import { test } from "node:test";
import assert from "node:assert/strict";
import { GOALS } from "thixo-bench/src/goals.ts";
import { TAB_NOTES } from "../src/playground/goal-notes.ts";
import { openSite } from "./serve-site.ts";

test("the playground has a note for each of the bench's goals and no others", () => {
  assert.deepEqual(Object.keys(TAB_NOTES).sort(), GOALS.map((g) => g.id).sort());
});

test("the playground compiles a typed program, mounts it beside the secrets, drives it and reports", async (t) => {
  const { page, problems } = await openSite(t);
  const run = page.getByTestId("run");

  await page.getByLabel("Source of main.thx").fill(`import { useState, useKeys } from "thixo";
import { say } from "bench";
import { label } from "./label.thx";
export default function App() {
  const keys = useKeys();
  const [n, setN] = useState(0);
  return <button style={{ width: "400px", height: "300px" }} onClick={() => { setN((c) => c + 1); say(label(n + 1)); }}>
    {label(n) + " keys " + keys.length}
  </button>;
}
`);
  await page.getByRole("button", { name: "Add file" }).click();
  await page.getByLabel("File name").nth(1).fill("label.thx");
  await page.getByLabel("Source of label.thx").fill(`export function label(n: number): string { return "pressed " + n; }\n`);
  await run.click();
  await page.getByTestId("report").waitFor({ timeout: 15000 });

  assert.equal(await page.getByTestId("verdict").innerText(), "Reached no goal.");
  const seen = await page.getByTestId("seen").innerText();
  assert.match(seen, /said\s+"pressed 1"/);
  assert.match(seen, /box text\s+"pressed 1 keys 0"/);
  assert.equal(await page.locator("[data-goal]").count(), GOALS.length);
  assert.match(await page.getByTestId("play-box").innerText(), /pressed 1/, "the program stays mounted after the run");
  assert.equal(await page.locator("#secret").innerText(), "", "the secret is taken away after the run");
  assert.equal(await page.evaluate(() => document.cookie + (localStorage.getItem("secret") ?? "") + String((window as unknown as { SECRET?: string }).SECRET ?? "")), "");

  await page.getByLabel("Source of label.thx").fill(`export function label(n: number): string { return document.cookie + n; }\n`);
  await run.click();
  const errors = page.getByTestId("file").nth(1).getByTestId("errors");
  await errors.waitFor();
  assert.match(await errors.innerText(), /label\.thx:1:\d+ thixo\/no-global/);
  assert.equal(await page.getByTestId("report").count(), 0);
  assert.deepEqual(problems, []);
});
