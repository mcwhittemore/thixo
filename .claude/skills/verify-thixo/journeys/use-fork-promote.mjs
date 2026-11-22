// As ben: use ana's shared "Todo summary" in todo-detail, see it in the panel, fork it, then promote it. The promote
// reply names the folder written into the app's plugins/ (in the run's disposable copy).

export default async function ({ page, step, expect, dir }) {
  await page.getByRole("button", { name: "Plugins" }).click();
  const browser = page.getByRole("region", { name: "Plugin browser" });
  const shared = browser.getByRole("listitem", { name: "Todo summary" }).filter({ hasText: "by ana" });
  await shared.getByRole("button", { name: "Use Todo summary" }).click();
  await browser.getByRole("listitem", { name: "Slot todo-detail" }).getByText("Todo summary").waitFor();
  expect(true, "ben's layout puts Todo summary in todo-detail");

  await page.getByRole("region", { name: "Todo list (main)" }).getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  await page.getByRole("region", { name: "Todo summary (todo-detail)" }).getByText(/Still open\.|This one is done\./).waitFor();
  expect(true, "the panel shows Todo summary for ben");
  await step("used");

  await shared.getByRole("button", { name: "Fork Todo summary" }).click();
  await browser.getByRole("status").getByText("Forked Todo summary").waitFor();
  await browser.getByRole("listitem", { name: "Todo summary" }).filter({ hasText: "personal · by ben" }).waitFor();
  expect(true, "a personal fork by ben is listed");
  await step("forked");

  const reply = page.waitForResponse((r) => /\/_thixo\/registry\/plugins\/[^/]+\/promote$/.test(new URL(r.url()).pathname));
  await shared.getByRole("button", { name: "Promote Todo summary" }).click();
  const answer = await reply;
  const body = await answer.json();
  expect(answer.status() === 200, `promote answered 200 with folder ${body.folder}`);
  const { existsSync } = await import("node:fs");
  expect(existsSync(`${dir}/plugins/${body.folder}/plugin.thx`), `plugins/${body.folder}/plugin.thx exists in the app copy`);
  await step("promoted");
}
