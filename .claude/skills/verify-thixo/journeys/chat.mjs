// Sends one message to the authoring chat and waits for the agent to finish. It runs the app's model adapter (in the
// examples, anthropic() from thixo-anthropic/node: the API with a key, else the local `claude` command), so it costs usage: run it only when a real turn is the point.
//   ASK="Add a star to each todo row ..." node .../drive.mjs --run <id> --as ana --script .../journeys/chat.mjs --name chat
// Enter in the Message box sends (Shift+Enter is a new line). While the agent works, a status reads "The agent is
// working…" and each tool call adds a "Using <tool>" line to the log, which becomes the tool's outcome when it
// returns ("check passed", "use put plg_…@2 in main/todo-row (confirmed in your layout)", "use failed: …"); the turn
// ends with a "Done" line. A confirmed use shows in the page at once: no reload.

export default async function ({ page, step, expect }) {
  const ask = process.env.ASK;
  if (!ask) throw new Error("set ASK to the message to send");
  await page.getByRole("button", { name: "Ask for a plugin" }).click();
  const chat = page.getByRole("region", { name: "Authoring chat" });
  const log = chat.getByRole("log", { name: "Chat messages" });
  await chat.getByRole("textbox", { name: "Message" }).fill(ask);
  await step("asked");
  await chat.getByRole("textbox", { name: "Message" }).press("Enter");
  await chat.getByRole("status").getByText("The agent is working").waitFor();
  expect(true, "Enter sent the message and the status says the agent is working");
  await log.locator('[data-kind="done"]').last().waitFor({ timeout: Number(process.env.WAIT_MS ?? 180_000) });
  expect(true, "the turn ended with Done");
  const tools = await log.locator('[data-kind="tool"]').allInnerTexts();
  console.log(`tools: ${tools.join(", ")}`);
  const used = tools.filter((t) => /^use put .+ \(confirmed in your layout\)$/.test(t));
  expect(used.length > 0 || !process.env.EXPECT_USE, `a use the layout confirmed: ${used.join("; ") || "none"}`);
  const failed = await log.locator('[data-kind="tool"][data-ok="false"]').allInnerTexts();
  if (failed.length) console.log(`failed tool calls: ${failed.join(" | ")}`);
  await step("answered");
}
