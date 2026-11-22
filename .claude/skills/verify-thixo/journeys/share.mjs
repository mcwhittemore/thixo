// As the author: open Plugins and share a plugin. Run as ana after the agent submitted "Todo summary".
// PLUGIN=<name> shares another plugin of yours, such as PLUGIN="Priority and notes".

export default async function ({ page, step, expect, as }) {
  const name = process.env.PLUGIN ?? "Todo summary";
  await page.getByRole("button", { name: "Plugins" }).click();
  const item = page.getByRole("region", { name: "Plugin browser" }).getByRole("listitem", { name }).filter({ hasText: `by ${as}` });
  await item.getByRole("button", { name: `Share ${name}` }).click();
  await item.getByText(`shared · by ${as}`).waitFor();
  expect(true, `${name} reads shared · by ${as}`);
  await step("shared");
}
