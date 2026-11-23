// As ana: the list from the default plugin with a child-slot badge per row, add a todo, tick one, open the detail
// panel, set a due date, reload and see it kept. Run with drive.mjs --as ana --script <this file>.

export default async function ({ page, step, expect }) {
  const list = page.getByRole("region", { name: "Todo list (main)" });
  await list.getByRole("button", { name: "Write the quarterly report", exact: true }).waitFor();
  const badges = list.getByRole("region", { name: "Done badge (main/todo-row)" });
  await badges.first().waitFor();
  expect((await badges.count()) === (await list.getByRole("checkbox", { name: "Done" }).count()), "every row has a Done badge (main/todo-row)");
  await step("list");

  const title = `Verify ${Date.now()}`;
  await list.getByRole("textbox", { name: "Add a todo" }).fill(title);
  await list.getByRole("textbox", { name: "Add a todo" }).press("Enter");
  await list.getByRole("button", { name: title, exact: true }).waitFor();
  expect(true, `added "${title}"`);

  const review = list.locator("div", { has: page.getByRole("button", { name: "Review the pull request", exact: true }) }).last();
  const box = review.getByRole("checkbox", { name: "Done" });
  const before = await box.isChecked();
  await box.click();
  await page.waitForFunction((was) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Review the pull request");
    return button?.parentElement?.querySelector('input[type="checkbox"]')?.checked === !was;
  }, before);
  expect(true, `ticked "Review the pull request" (${before} -> ${!before})`);
  await review.getByRole("region", { name: "Done badge (main/todo-row)" }).getByText(before ? "Open" : "Done").waitFor();
  expect(true, `its row's badge (another plugin, in main/todo-row) now reads ${before ? "Open" : "Done"}`);
  await step("added-and-ticked");

  await list.getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  const panel = page.getByRole("region", { name: "Selected todo" }).getByRole("region", { name: "Due dates (todo-detail)" });
  await panel.getByRole("heading", { name: "Write the quarterly report" }).waitFor();
  const saved = page.waitForResponse((r) => r.url().endsWith("/_thixo/data/patch"));
  await panel.getByRole("textbox", { name: "Due" }).fill("2026-12-24");
  expect((await saved).status() === 204, "the due date patch answered 204");
  await step("due-date-set");

  await page.reload();
  await list.getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[type="date"]')?.value === "2026-12-24");
  expect(await list.getByRole("button", { name: title, exact: true }).isVisible(), "the new todo is still listed after reload");
  expect(await review.getByRole("checkbox", { name: "Done" }).isChecked() === !before, "the tick is kept after reload");
  expect(true, "the due date reads 2026-12-24 after reload");
}
