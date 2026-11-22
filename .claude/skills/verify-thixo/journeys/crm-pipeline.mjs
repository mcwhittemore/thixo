// As rita (rep): the pipeline's Close deal buttons are grayed out. As mia (manager): values show, she closes "Delta
// render farm" and the dashboard counts it as revenue. Run with drive.mjs --as rita|mia --script <this file>.

export default async function ({ page, url, as, step, expect }) {
  await page.goto(`${url}/deals`);
  const pipeline = page.getByRole("region", { name: "Deals pipeline (deals)" });
  await pipeline.getByRole("article", { name: "Acme warehouse robots" }).waitFor();
  const closeButtons = pipeline.getByRole("button", { name: "Close deal" });
  const disabled = await Promise.all((await closeButtons.all()).map((b) => b.isDisabled()));
  await step("pipeline");

  if (as === "mia") {
    expect(disabled.every((d) => d === false) && disabled.length > 0, "every Close deal button is enabled for the manager");
    await pipeline.getByRole("article", { name: "Delta render farm" }).getByText("$76,000").waitFor();
    expect(true, "deal values show for finance.read");
    const closed = page.waitForResponse((r) => r.url().includes("/api/deals/") && r.url().endsWith("/close"));
    await pipeline.getByRole("article", { name: "Delta render farm" }).getByRole("button", { name: "Close deal" }).click();
    expect((await closed).status() === 200, "closeDeal answered 200");
    await pipeline.getByRole("group", { name: "Stage closed" }).getByRole("article", { name: "Delta render farm" }).waitFor();
    expect(true, "Delta render farm sits in the closed column");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await page.getByRole("region", { name: "Pipeline totals (dashboard-pipeline)" }).getByText(/Closed revenue \$/).waitFor();
    expect(true, "the dashboard widget shows closed revenue (finance endpoint, optional)");
  } else {
    expect(disabled.length > 0 && disabled.every(Boolean), "every Close deal button is grayed out for the rep (P4)");
    expect((await pipeline.getByText("$").count()) === 0, "the rep sees no deal values");
  }
  await step("done");
}
