// Opens the plugin browser and snapshots it: the user's layout per slot path and the search results.

export default async function ({ page, step, expect }) {
  await page.getByRole("button", { name: "Plugins" }).click();
  const browser = page.getByRole("region", { name: "Plugin browser" });
  await browser.getByRole("list", { name: "Search results" }).getByRole("listitem").first().waitFor();
  const slots = await browser.getByRole("list", { name: "Your layout" }).getByRole("listitem").count();
  const results = await browser.getByRole("list", { name: "Search results" }).getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Use / }) }).count();
  expect(slots >= 3, `Your layout lists ${slots} slot paths`);
  expect(results >= 3, `Search results list ${results} plugins`);
  await step("open");
}
