// As ben: use another author's shared plugin, see it in its slot, fork it, then promote it. The promote reply names
// the folder written into the app's plugins/ (in the run's disposable copy).
// Defaults to ana's "Todo summary" in todo-detail. For another plugin set PLUGIN=<name>, AUTHOR=<who shared it>,
// SLOT=<slot path>, and OPEN=<button name> when the slot shows only after a click (todo-detail needs a todo opened;
// OPEN="" opens nothing).

export default async function ({ page, step, expect, dir, as }) {
  const name = process.env.PLUGIN ?? "Todo summary";
  const author = process.env.AUTHOR ?? "ana";
  const slot = process.env.SLOT ?? "todo-detail";
  const open = process.env.OPEN ?? (slot === "todo-detail" ? "Write the quarterly report" : "");

  await page.getByRole("button", { name: "Plugins" }).click();
  const browser = page.getByRole("region", { name: "Plugin browser" });
  const shared = browser.getByRole("listitem", { name }).filter({ hasText: `by ${author}` });
  await shared.getByRole("button", { name: `Use ${name}` }).click();
  await browser.getByRole("listitem", { name: `Slot ${slot}` }).getByText(name).waitFor();
  expect(true, `${as}'s layout puts ${name} in ${slot}`);

  if (open) await page.getByRole("button", { name: open, exact: true }).first().click();
  await page.getByRole("region", { name: `${name} (${slot})` }).first().waitFor();
  expect(true, `the ${slot} slot shows ${name} for ${as}`);
  await step("used");

  await shared.getByRole("button", { name: `Fork ${name}` }).click();
  const status = browser.getByRole("status");
  await status.getByText(`Forked ${name}`).waitFor();
  const forkId = /as (plg_\w+)/.exec(await status.innerText())?.[1];
  expect(Boolean(forkId), `the status names the fork's id (${forkId}) and says how to use and change it`);
  await browser.getByRole("listitem", { name }).filter({ hasText: `personal · by ${as}` }).waitFor();
  expect(true, `a personal fork by ${as} is listed`);
  await step("forked");

  const reply = page.waitForResponse((r) => /\/_thixo\/registry\/plugins\/[^/]+\/promote$/.test(new URL(r.url()).pathname));
  await shared.getByRole("button", { name: `Promote ${name}` }).click();
  const answer = await reply;
  const body = await answer.json();
  expect(answer.status() === 200, `promote answered 200 with folder ${body.folder}`);
  await status.getByText(`its files are at plugins/${body.folder}/`).waitFor();
  const said = await status.innerText();
  expect(/It fills no slot yet|already names/.test(said), `the status names plugins/${body.folder}/ and what is left: ${said}`);
  const { existsSync } = await import("node:fs");
  expect(existsSync(`${dir}/plugins/${body.folder}/plugin.thx`), `plugins/${body.folder}/plugin.thx exists in the app copy`);
  await step("promoted");
}
