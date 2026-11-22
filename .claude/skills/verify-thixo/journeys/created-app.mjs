// An app create-thixo-app made: the list shows the seeded todos, and Delete is grayed out for a user without
// todos.delete (ana) and works for one with it (ben). That is the optional-endpoint pattern: the template's todo list
// imports deleteTodo from @app/sdk/optional and asks useCan(deleteTodo).
//   launch.mjs --run <id> --dir examples-tmp/<app>, then drive.mjs --as ana (or ben) --script .../created-app.mjs

export default async function ({ page, step, expect, as }) {
  const list = page.getByRole("region", { name: "Todo list (main)" });
  await list.getByRole("button", { name: "Write the first page", exact: true }).waitFor();
  const del = list.getByRole("button", { name: "Delete" }).first();
  const grayed = await del.isDisabled();
  await step("list");
  if (as === "ana") {
    expect(grayed, "ana's Delete is grayed out: she lacks todos.delete, an optional scope of the list");
    return;
  }
  expect(!grayed, `${as}'s Delete is enabled`);
  const title = `Delete me (${as} ${Date.now()})`;
  await list.getByRole("textbox").fill(title);
  await list.getByRole("textbox").press("Enter");
  const row = list.getByRole("button", { name: title, exact: true });
  await row.waitFor();
  await step("added");
  await row.locator("xpath=..").getByRole("button", { name: "Delete", exact: true }).click();
  await row.waitFor({ state: "detached" });
  expect(true, `${as} deleted the todo they added`);
  await step("deleted");
}
