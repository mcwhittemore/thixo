// After a rollback (a default plugin's folder put back as it was, so the deploy finds its old version by hash), the
// plugin browser lists the newest version and names the one the default serves. PLUGIN=<name> (default "Due dates"),
// LATEST=<n> and DEFAULT=<n> (default 2 and 1). Also records the scope line, where thixo.* scopes carry words.

export default async function ({ page, step, expect }) {
  const name = process.env.PLUGIN ?? "Due dates";
  const latest = process.env.LATEST ?? "2";
  const served = process.env.DEFAULT ?? "1";
  await page.getByRole("button", { name: "Plugins" }).click();
  const item = page.getByRole("region", { name: "Plugin browser" }).getByRole("listitem", { name });
  await item.getByText(`v${latest} (the default is v${served})`).waitFor();
  expect(true, `${name} reads v${latest} (the default is v${served})`);
  const scopes = await item.getByLabel(`Scopes of ${name}`).innerText();
  console.log(scopes);
  await step("caption");
}
