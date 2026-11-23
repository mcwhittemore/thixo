// As ana, after a server restart: the due date that todo-basics set on "Write the quarterly report" is still
// there, read back from the database. Run with drive.mjs --as ana --script <this file>.

export default async function ({ page, step, expect }) {
  const list = page.getByRole("region", { name: "Todo list (main)" });
  await list.getByRole("button", { name: "Write the quarterly report", exact: true }).waitFor();
  await list.getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  const panel = page.getByRole("region", { name: "Selected todo" }).getByRole("region", { name: "Due dates (todo-detail)" });
  await panel.getByRole("heading", { name: "Write the quarterly report" }).waitFor();
  const due = await panel.getByRole("textbox", { name: "Due" }).inputValue();
  expect(due === "2026-12-24", `the due date reads ${due} after the restart`);
  await step("after-restart");
}
