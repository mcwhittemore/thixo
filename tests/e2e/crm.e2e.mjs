// The CRM example end to end: `thixo dev` on a disposable copy, driven in headless Chromium as the five users of the
// app's stand-in login (rita and ravi are sales reps on the east and west teams, mia a sales manager, sam a support
// agent, ada an admin). Run it with `npm run e2e` after `npm run build`.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { copyExample, removeCopy, startDev } from "./support.mjs";

let dir;
let dev;
let browser;
const problems = [];

before(async () => {
  dir = copyExample("crm");
  dev = await startDev(dir);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await dev?.stop();
  removeCopy(dir);
});

/** A signed-in page at `path`. The example's login is the `thixo-user` cookie. Page errors are collected. */
async function as(user, path = "/") {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: dev.url });
  await context.addCookies([{ name: "thixo-user", value: user, url: dev.url }]);
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`${user}: page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`${user}: console: ${message.text()}`);
  });
  await page.goto(dev.url + path);
  await page.getByRole("navigation", { name: "Sections" }).waitFor();
  return page;
}

const slot = (page, name, path) => page.getByRole("region", { name: `${name} (${path})` });
const pipeline = (page) => slot(page, "Deals pipeline", "deals");
const card = (page, title) => pipeline(page).getByRole("article", { name: title });
const stage = (page, name) => pipeline(page).getByRole("group", { name: `Stage ${name}` });
const pluginBrowser = (page) => page.getByRole("region", { name: "Plugin browser" });
const toast = (page, text) => page.getByRole("status").filter({ hasText: text });

async function openPlugins(page) {
  await page.getByRole("button", { name: "Plugins" }).click();
  await pluginBrowser(page).getByRole("list", { name: "Search results" }).getByRole("listitem").first().waitFor();
}

async function openDeals(page) {
  await page.getByRole("link", { name: "Deals" }).click();
  await card(page, "Acme warehouse robots").waitFor();
}

async function setScore(page, dealTitle, score) {
  const input = slot(card(page, dealTitle), "Lead score", "deals/deal-card").getByRole("spinbutton", { name: "Lead score" });
  const saved = page.waitForResponse((r) => r.url().endsWith("/_thixo/data/patch") && r.status() === 204);
  await input.fill(String(score));
  await saved;
}

async function readScore(page, dealTitle) {
  const input = slot(card(page, dealTitle), "Lead score", "deals/deal-card").getByRole("spinbutton", { name: "Lead score" });
  await input.waitFor();
  await page.waitForLoadState("networkidle");
  return input.inputValue();
}

test("the rep sees the pipeline by stage, moves a deal, and can not close one (P4)", async () => {
  const rita = await as("rita");
  await rita.getByRole("link", { name: "Deals" }).click();
  await pipeline(rita).waitFor();
  for (const [name, title] of [
    ["lead", "Cobalt fleet tracking"],
    ["qualified", "Birchwood scheduling"],
    ["proposal", "Delta render farm"],
    ["negotiation", "Acme warehouse robots"],
    ["closed", "Acme maintenance plan"],
  ]) {
    await stage(rita, name).getByRole("article", { name: title }).waitFor();
  }
  assert.equal(new URL(rita.url()).pathname, "/deals");

  const close = pipeline(rita).getByRole("button", { name: "Close deal" });
  assert.equal(await close.count(), 4);
  for (const button of await close.all()) assert.equal(await button.isDisabled(), true);
  assert.equal(await pipeline(rita).getByText("$", { exact: false }).count(), 0, "a rep sees no deal values");

  await card(rita, "Cobalt fleet tracking").getByLabel("Stage").selectOption("qualified");
  await toast(rita, "Moved Cobalt fleet tracking to qualified").waitFor();
  await stage(rita, "qualified").getByRole("article", { name: "Cobalt fleet tracking" }).waitFor();
  await rita.reload();
  await stage(rita, "qualified").getByRole("article", { name: "Cobalt fleet tracking" }).waitFor();
  await rita.context().close();
});

test("the manager sees values and closes a deal, which the dashboard counts as revenue", async () => {
  const mia = await as("mia");
  const before = slot(mia, "Pipeline totals", "dashboard-pipeline");
  await before.getByText("Closed revenue $30,000").waitFor();
  await before.getByText("Open pipeline $259,500").waitFor();

  await openDeals(mia);
  await card(mia, "Delta render farm").getByText("$76,000").waitFor();
  const close = card(mia, "Delta render farm").getByRole("button", { name: "Close deal" });
  assert.equal(await close.isDisabled(), false);
  const closed = mia.waitForResponse((r) => r.url().endsWith("/api/deals/dl-4/close"));
  await close.click();
  assert.equal((await closed).status(), 200);
  await toast(mia, "Closed Delta render farm").waitFor();
  await stage(mia, "closed").getByRole("article", { name: "Delta render farm" }).waitFor();
  assert.equal(await card(mia, "Delta render farm").getByRole("button", { name: "Close deal" }).count(), 0);

  await mia.getByRole("link", { name: "Dashboard" }).click();
  await slot(mia, "Pipeline totals", "dashboard-pipeline").getByText("Closed revenue $106,000").waitFor();
  await mia.context().close();
});

test("the pipeline widget carries on without finance.read: no values, no revenue", async () => {
  const rita = await as("rita");
  const widget = slot(rita, "Pipeline totals", "dashboard-pipeline");
  await widget.getByText("negotiation: 1 deals", { exact: true }).waitFor();
  await widget.getByText("Values are shown to people who hold finance.read.").waitFor();
  assert.equal(await widget.getByText("Closed revenue").count(), 0);
  await rita.context().close();
});

test("notes are private to each user", async () => {
  const rita = await as("rita");
  await rita.getByRole("link", { name: "Contacts" }).click();
  await rita.getByRole("button", { name: "Maria Lopez" }).click();
  await rita.waitForURL("**/contacts/ct-1");
  const notes = slot(rita, "My notes", "contact-detail/contact-notes");
  await notes.getByText("No note yet.").waitFor();
  await notes.getByRole("textbox", { name: "Note" }).fill("Wants a demo in January");
  const saved = rita.waitForResponse((r) => r.url().endsWith("/_thixo/data/patch") && r.status() === 204);
  await notes.getByRole("button", { name: "Save note" }).click();
  await saved;
  await notes.getByText("Your note: Wants a demo in January").waitFor();

  await rita.reload();
  await slot(rita, "My notes", "contact-detail/contact-notes").getByText("Your note: Wants a demo in January").waitFor();
  await rita.context().close();

  // mia is on the same team as rita and holds the same scopes. A contact's annotation is grouped by user (A11).
  const mia = await as("mia", "/contacts/ct-1");
  await slot(mia, "My notes", "contact-detail/contact-notes").getByText("No note yet.").waitFor();
  assert.equal(await mia.getByText("Wants a demo in January").count(), 0);
  await mia.context().close();
});

test("a lead score is shared within a team and not across teams", async () => {
  const rita = await as("rita");
  await openDeals(rita);
  await setScore(rita, "Acme warehouse robots", 80);
  await rita.context().close();

  const mia = await as("mia");
  await openDeals(mia);
  assert.equal(await readScore(mia, "Acme warehouse robots"), "80");
  await mia.context().close();

  const ravi = await as("ravi");
  await openDeals(ravi);
  assert.equal(await readScore(ravi, "Acme warehouse robots"), "");
  await setScore(ravi, "Acme warehouse robots", 20);
  await ravi.reload();
  await card(ravi, "Acme warehouse robots").waitFor();
  assert.equal(await readScore(ravi, "Acme warehouse robots"), "20");
  await ravi.context().close();

  const again = await as("rita");
  await openDeals(again);
  assert.equal(await readScore(again, "Acme warehouse robots"), "80");
  await again.context().close();
});

test("a company's annotation is seen by everyone", async () => {
  const rita = await as("rita", "/companies/co-1");
  const health = slot(rita, "Account health", "company-detail").getByLabel("Account health");
  await health.waitFor();
  const saved = rita.waitForResponse((r) => r.url().endsWith("/_thixo/data/patch") && r.status() === 204);
  await health.selectOption("at-risk");
  await saved;
  await rita.context().close();

  const ravi = await as("ravi", "/companies/co-1");
  const theirs = slot(ravi, "Account health", "company-detail").getByLabel("Account health");
  await theirs.waitFor();
  await ravi.waitForLoadState("networkidle");
  assert.equal(await theirs.inputValue(), "at-risk");
  await ravi.context().close();
});

test("the support agent is not offered plugins that need write scopes, and sees what they can read", async () => {
  const sam = await as("sam", "/contacts");
  await slot(sam, "Contacts list", "contacts").getByRole("button", { name: "Maria Lopez" }).waitFor();
  assert.equal(await sam.getByRole("link", { name: "Deals" }).count(), 1);

  await openPlugins(sam);
  const results = pluginBrowser(sam).getByRole("list", { name: "Search results" });
  await results.getByRole("listitem", { name: "Contacts list" }).waitFor();
  await results.getByRole("listitem", { name: "Contact detail" }).waitFor();
  await results.getByRole("listitem", { name: "Companies list" }).waitFor();
  for (const name of ["My notes", "Lead score", "Account health", "Pinned contacts", "Deals pipeline", "Pipeline totals", "Stage chart"]) {
    assert.equal(await results.getByRole("listitem", { name, exact: true }).count(), 0, `${name} is offered to support`);
  }
  assert.match(await results.getByLabel("Scopes of Contacts list").innerText(), /Needs: companies\.read, contacts\.read( ·|$)/);

  await sam.getByRole("button", { name: "Maria Lopez" }).click();
  const alert = sam.getByRole("alert").filter({ hasText: "My notes" });
  await alert.waitFor();
  assert.match(await alert.innerText(), /needs the scope thixo\.data\.write/);
  await sam.context().close();
  // The refused plugin load is a 403 the browser logs: the expected answer for a plugin the user may not run (G1).
  const refused = problems.filter((p) => p.startsWith("sam: console: Failed to load resource") && p.includes("403"));
  assert.ok(refused.length >= 1 && refused.length <= 2, problems.join("\n"));
  problems.splice(0, problems.length, ...problems.filter((p) => !refused.includes(p)));
});

test("a dashboard widget is swapped for another through the plugin browser", async () => {
  const ravi = await as("ravi");
  await slot(ravi, "Pipeline totals", "dashboard-pipeline").waitFor();
  await slot(ravi, "Pinned contacts", "dashboard-pinned").waitFor();
  await openPlugins(ravi);

  const chart = pluginBrowser(ravi).getByRole("listitem", { name: "Stage chart" });
  assert.match(await chart.innerText(), /fills dashboard-pipeline/);
  await chart.getByRole("button", { name: "Use Stage chart" }).click();
  await pluginBrowser(ravi).getByRole("listitem", { name: "Slot dashboard-pipeline" }).getByText("Stage chart v1").waitFor();

  const swapped = slot(ravi, "Stage chart", "dashboard-pipeline");
  await swapped.waitFor();
  const bars = swapped.getByRole("img");
  assert.match(await bars.getAttribute("aria-label"), /lead: 0, qualified: 2, proposal: 0, negotiation: 1, closed: 2/);
  assert.equal(await slot(ravi, "Pipeline totals", "dashboard-pipeline").count(), 0);
  await slot(ravi, "Pinned contacts", "dashboard-pinned").waitFor();

  await ravi.reload();
  await slot(ravi, "Stage chart", "dashboard-pipeline").waitFor();
  const other = await as("rita");
  await slot(other, "Pipeline totals", "dashboard-pipeline").waitFor();
  assert.equal(await slot(other, "Stage chart", "dashboard-pipeline").count(), 0);
  await other.context().close();
  await ravi.context().close();
});

test("pinned contacts are a private store and a click opens the contact", async () => {
  const rita = await as("rita");
  const widget = slot(rita, "Pinned contacts", "dashboard-pinned");
  await widget.getByText("Nothing pinned yet.").waitFor();
  const saved = rita.waitForResponse((r) => r.url().includes("/_thixo/data/") && r.request().method() === "POST" && r.ok());
  await widget.getByLabel("Pin a contact").selectOption({ label: "Tom Okafor" });
  await saved;
  await widget.getByRole("button", { name: "Unpin Tom Okafor" }).waitFor();
  await rita.reload();
  await slot(rita, "Pinned contacts", "dashboard-pinned").getByRole("button", { name: "Unpin Tom Okafor" }).waitFor();
  await rita.context().close();

  const mia = await as("mia");
  await slot(mia, "Pinned contacts", "dashboard-pinned").getByText("Nothing pinned yet.").waitFor();
  await mia.context().close();

  const again = await as("rita");
  await slot(again, "Pinned contacts", "dashboard-pinned").getByRole("button", { name: "Tom Okafor", exact: true }).click();
  await again.waitForURL("**/contacts/ct-2");
  await slot(again, "Contact detail", "contact-detail").getByText("CFO").waitFor();
  await again.context().close();
});

test("shell services: navigate, copy to the clipboard, a toast, and a CSV of what is on screen", async () => {
  const rita = await as("rita", "/contacts/ct-1");
  const detail = slot(rita, "Contact detail", "contact-detail");
  await detail.getByText("Last contact 2 Nov 2026 · team east").waitFor();

  await detail.getByRole("button", { name: "Copy email" }).click();
  await toast(rita, "Copied maria@acme.example").waitFor();
  assert.equal(await rita.evaluate(() => navigator.clipboard.readText()), "maria@acme.example");

  await detail.getByRole("button", { name: "Back to contacts" }).click();
  await rita.waitForURL((url) => url.pathname === "/contacts");
  await rita.getByRole("region", { name: "Selected contact" }).waitFor({ state: "detached" });

  const list = slot(rita, "Contacts list", "contacts");
  await list.getByRole("textbox", { name: "Search contacts" }).fill("acme");
  assert.equal(await list.getByRole("row").count(), 3);
  const [file] = await Promise.all([rita.waitForEvent("download"), list.getByRole("button", { name: "Download CSV" }).click()]);
  assert.equal(file.suggestedFilename(), "contacts.csv");
  const csv = readFileSync(await file.path(), "utf8");
  assert.equal(csv, ['name,email,company,team', '"Maria Lopez","maria@acme.example","Acme Robotics","east"', '"Tom Okafor","tom@acme.example","Acme Robotics","east"'].join("\n"));
  await toast(rita, "Downloaded 2 contacts").waitFor();

  await rita.getByRole("link", { name: "Companies" }).click();
  await rita.waitForURL((url) => url.pathname === "/companies");
  await rita.context().close();
});

test("exporting every contact needs admin.export: grayed out for the rep, working for the admin (P4)", async () => {
  const rita = await as("rita", "/contacts");
  const exportAll = slot(rita, "Contacts list", "contacts").getByRole("button", { name: "Export all" });
  await exportAll.waitFor();
  await rita.waitForLoadState("networkidle");
  assert.equal(await exportAll.isDisabled(), true);
  await rita.context().close();

  const ada = await as("ada", "/contacts");
  const button = slot(ada, "Contacts list", "contacts").getByRole("button", { name: "Export all" });
  await ada.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "Export all" && !b.disabled));
  const [file] = await Promise.all([ada.waitForEvent("download"), button.click()]);
  assert.equal(file.suggestedFilename(), "all-contacts.csv");
  assert.match(readFileSync(await file.path(), "utf8"), /^id,name,email,team\nct-1,Maria Lopez,maria@acme\.example,east/);
  await ada.context().close();
});

test("no page errors or console errors along the way", () => {
  assert.deepEqual(problems, []);
  assert.equal(existsSync(join(dir, ".thixo/dev.json")), true);
});
