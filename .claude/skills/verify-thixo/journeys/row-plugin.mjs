// Which plugin fills main/todo-row: run after `thixo agent use ... --slot todo-row` (a bare child name, stored as
// main/todo-row). PLUGIN=<name> is the plugin that should fill every row; it replaced the Done badge there.

export default async function ({ page, step, expect }) {
  const name = process.env.PLUGIN;
  if (!name) throw new Error("set PLUGIN to the row plugin's name");
  const rows = page.getByRole("region", { name: `${name} (main/todo-row)` });
  await rows.first().waitFor();
  const count = await rows.count();
  expect(count > 0, `${name} fills main/todo-row in ${count} rows`);
  expect((await page.getByRole("region", { name: "Done badge (main/todo-row)" }).count()) === 0, "it replaced the Done badge: a slot holds one plugin");
  await step("rows");
}
