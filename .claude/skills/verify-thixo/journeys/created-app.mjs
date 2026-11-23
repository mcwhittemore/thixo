// An app create-thixo-app made: the hello plugin greets the signed-in user with a message from the app's own endpoint,
// a nickname saved through useStore is plugin data that survives a reload and belongs to one user, and the shell has
// the plugin browser and the authoring chat.
//   launch.mjs --run <id> --app examples-tmp/<app>, then drive.mjs --as ana (or ben) --script .../created-app.mjs
// Drive ana first: ana saves a nickname, and ben must not see it.

export default async function ({ page, step, expect, as }) {
  const hello = page.getByRole("region", { name: "Hello (main)" });
  await hello.getByText("Hello from the app's API.").waitFor();
  expect(true, "the message came from the app's API");
  await step("hello");

  if (as === "ana") {
    const nickname = `Annie ${Date.now()}`;
    await hello.getByRole("textbox").fill(nickname);
    await hello.getByRole("button", { name: "Save nickname" }).click();
    await hello.getByText(`Hello, ${nickname}`).waitFor();
    await page.reload();
    await hello.getByText(`Hello, ${nickname}`).waitFor();
    expect(true, "the nickname is saved and survives a reload");
    await step("nickname");
  } else {
    await hello.getByText(`Hello, ${as}`).waitFor();
    expect(true, `the plugin greets ${as} by name, not by ana's nickname`);
  }

  await page.getByRole("button", { name: "Plugins" }).click();
  await page.getByRole("region", { name: "Plugin browser" }).waitFor();
  await page.getByRole("button", { name: "Ask for a plugin" }).click();
  await page.getByRole("region", { name: "Authoring chat" }).waitFor();
  expect(true, "the plugin browser and the authoring chat open");
  await step("panels");
}
