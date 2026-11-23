// A due date is a calendar day: it is stored as midnight UTC and reads back as the same day in any time zone.
// Set it once (SET=1), then read it again with another TZ for drive.mjs, such as TZ=Asia/Tokyo. DAY=<yyyy-mm-dd>.

export default async function ({ page, step, expect }) {
  const day = process.env.DAY ?? "2026-12-24";
  const offset = await page.evaluate(() => -new Date().getTimezoneOffset());
  await page.getByRole("region", { name: "Todo list (main)" }).getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  const box = page.getByRole("textbox", { name: "Due" });
  if (process.env.SET) {
    const patch = page.waitForRequest((r) => r.url().endsWith("/_thixo/data/patch"));
    await box.fill(day);
    const body = (await patch).postData() ?? "";
    expect(body.includes(`${day}T00:00:00.000Z`), `the day is sent as midnight UTC (${body})`);
    await page.reload();
    await page.getByRole("region", { name: "Todo list (main)" }).getByRole("button", { name: "Write the quarterly report", exact: true }).click();
  }
  await page.waitForFunction(() => document.querySelector('input[type="date"]')?.value);
  expect((await box.inputValue()) === day, `at UTC offset ${offset} min it reads ${day}`);
  await step("day");
}
