// Opens "Write the quarterly report" and records which plugin fills todo-detail. Set EXPECT_DETAIL to the plugin
// name the panel must show, such as "Todo summary" or "Due dates".

export default async function ({ page, step, expect }) {
  const list = page.getByRole("region", { name: "Todo list (main)" });
  await list.getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  const panel = page.getByRole("region", { name: "Selected todo" }).getByRole("region", { name: /\(todo-detail\)$/ });
  await panel.waitFor();
  await page.waitForLoadState("networkidle");
  const name = (await panel.getAttribute("aria-label")).replace(/ \(todo-detail\)$/, "");
  if (process.env.EXPECT_DETAIL) expect(name === process.env.EXPECT_DETAIL, `todo-detail is filled by ${process.env.EXPECT_DETAIL} (saw ${name})`);
  else console.log(`todo-detail is filled by ${name}`);
  await step("detail");
}
