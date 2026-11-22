// As the author: open Plugins and share "Todo summary". Run as ana after the agent submitted it.

export default async function ({ page, step, expect }) {
  await page.getByRole("button", { name: "Plugins" }).click();
  const item = page.getByRole("region", { name: "Plugin browser" }).getByRole("listitem", { name: "Todo summary" });
  await item.getByRole("button", { name: "Share Todo summary" }).click();
  await item.getByText("shared · by ana").waitFor();
  expect(true, "Todo summary reads shared · by ana");
  await step("shared");
}
