# The CRM app

The CRM example run by `thixo dev`: a signed-in rep, manager, support agent or admin sees a dashboard, contacts, companies and a deals board, each drawn by a default plugin in its own slot, with a notes plugin private to each user, a lead score shared within a team, finance values only for people who hold `finance.read`, and a dashboard widget the user can swap in the plugin browser.

## Sub-features

- `crm-routes` shows the sections at `/` (dashboard), `/contacts`, `/contacts/:id`, `/companies`, `/companies/:id` and `/deals`; the `Sections` navigation and a plugin's `navigate` both change the address without a reload.
- `crm-pipeline` draws `Deals pipeline (deals)` as a `Stage <name>` group per stage. A deal's `Stage` select moves it (`POST /api/deals/:id/move`); `Close deal` needs `deals.close` and is disabled without it (P4).
- `crm-finance` shows `$` values on cards and `Closed revenue` and `Open pipeline` in `Pipeline totals (dashboard-pipeline)` only for a user who can call the finance endpoints, and the text `Values are shown to people who hold finance.read.` for the rest (A12, P2).
- `crm-notes` is `My notes (contact-detail/contact-notes)`, a child slot of the contact panel; the note is an annotation on `contact` grouped by user, so another user, even a teammate, sees `No note yet.` (A11).
- `crm-lead-score` is `Lead score (deals/deal-card)` in each card, an annotation on `deal` grouped by the user's team: the same team sees the number, the other team sees an empty box.
- `crm-account-health` is `Account health (company-detail)`, an annotation on `company` seen by everyone.
- `crm-pinned` is `Pinned contacts (dashboard-pinned)`, a private store (`pins`); a pinned name opens the contact through the slot's `open` event.
- `crm-services` covers `Copy email` (clipboard and a toast), `Back to contacts` (navigate), `Download CSV` (the rows on screen, filtered by `Search contacts`) and `Export all` (`GET /api/export/contacts`, needs `admin.export`, disabled without it).
- `crm-library` is `@app/format`, exposed through `thixo.config.ts` (L3): `formatMoney` and `formatDay` in the lists, `BarChart` in `Stage chart`.
- `crm-browser` lists plugins in the plugin browser only when the user holds what they need (G1) and swaps the dashboard's pipeline widget for `Stage chart` with `Use Stage chart`.
- `crm-refused` shows the support agent `needs the scope thixo.data.write` in the notes slot (a 403 on the plugin's load) and no deals plugin.

## How to get to it (user POV)

- Run `npx thixo dev examples/crm` (or `node .claude/skills/verify-thixo/bin/launch.mjs --run crm --example crm`, which does it on a copy) and open the printed address.
- Pick a user in `Signed in as`: `rita` (rep, east), `ravi` (rep, west), `mia` (manager, east), `sam` (support), `ada` (admin). The choice is the `thixo-user` cookie; the page reloads.
- Use `Dashboard`, `Contacts`, `Companies` and `Deals` in the `Sections` navigation; click a contact or company name to open its panel; press `Close` to close it.
- Press `Plugins` for the plugin browser. Press `Ask for a plugin` for the authoring chat.

## Driving it with drive.mjs (Playwright, headless Chromium)

Preconditions:

- `npm run build` has run. `node .claude/skills/verify-thixo/bin/launch.mjs --run crm --example crm` printed its state.
- The run is fresh: the seeded deals (`Delta render farm` in proposal, `Acme maintenance plan` closed), no notes, scores or pins. `doctor.mjs` signs in as `ana`, who does not exist here, and fails with `sign-in as ana: token refused`; its first four checks (`process`, `port is ours`, `copy is disposable`, `app info` listing `contact-notes`, `dashboard-pipeline`, `deal-card`) are the ones that apply.

- **Rep cannot close (rita).** Run `node .claude/skills/verify-thixo/bin/drive.mjs --run crm --as rita --script .claude/skills/verify-thixo/journeys/crm-pipeline.mjs --name crm-pipeline-rita`. It prints `ok every Close deal button is grayed out for the rep (P4)` and `ok the rep sees no deal values`. `crm-pipeline-rita/01-pipeline.aria.txt` has four `button "Close deal" [disabled]`.
- **Manager closes (mia).** Run the same with `--as mia --name crm-pipeline-mia`. It prints `ok every Close deal button is enabled for the manager`, `ok deal values show for finance.read`, `ok closeDeal answered 200`, `ok Delta render farm sits in the closed column` and `ok the dashboard widget shows closed revenue (finance endpoint, optional)`. `crm-pipeline-mia/requests.json` has `POST /api/deals/dl-4/close` with status 200 and `GET /api/finance/revenue` with status 200; the rep's `requests.json` has no `/api/finance/` call.
- **Per-user and per-team data.** Run `npm run e2e` (it runs `tests/e2e/crm.e2e.mjs` after the todo test). It covers: a note rita saves is `Your note: Wants a demo in January` after a reload and `No note yet.` for mia; a lead score of 80 set by rita reads `80` for mia, empty for ravi, who sets `20` without changing rita's `80`; an `at-risk` account health set by rita is read by ravi; pins of rita are not mia's.
- **Support agent.** In `tests/e2e/crm.e2e.mjs` the support test opens `Plugins` as sam and finds `Contacts list`, `Contact detail` and `Companies list` in `Search results` but none of `My notes`, `Lead score`, `Account health`, `Pinned contacts`, `Deals pipeline`, `Pipeline totals` or `Stage chart`; `Scopes of Contacts list` reads `Needs: companies.read, contacts.read · Uses if you have them: admin.export, contacts.write`. After clicking `Maria Lopez`, the notes slot shows an alert `needs the scope thixo.data.write`.
- **Swap a widget.** As ravi, press `Plugins`, `Use Stage chart` on the `Stage chart` item; `Slot dashboard-pipeline` reads `Stage chart v1`, `Stage chart (dashboard-pipeline)` has an image whose label starts `lead: `, `Pipeline totals (dashboard-pipeline)` is gone and `Pinned contacts (dashboard-pinned)` is still there. A reload keeps it; rita still has `Pipeline totals`.
- **Services.** As rita on `/contacts/ct-1`: `Copy email` shows the toast `Copied maria@acme.example` and `navigator.clipboard.readText()` returns it; `Back to contacts` changes the path to `/contacts`; with `acme` in `Search contacts`, `Download CSV` saves `contacts.csv` of a header and two rows, and a toast `Downloaded 2 contacts`. As ada, `Export all` saves `all-contacts.csv` starting `id,name,email,team`.
- **Whole journey, automated.** `npm run e2e` ends with `# fail 0`; the CRM file reports twelve tests passing.
- **Proof.** Keep `artifacts/verify/crm/crm-pipeline-rita/` and `crm-pipeline-mia/` (screenshots, ARIA snapshots, `requests.json`, `console.txt`) and `dev.log`. Run `node .claude/skills/verify-thixo/bin/cleanup.mjs --run crm`; the folders are still there after it.

## Gotchas

- Seed data is in memory and shared by the run: closing `Delta render farm` is not undone by reloading. Start a fresh run (`launch.mjs --run <other>`) to see it in proposal again. The mia journey on a used run fails at the `Delta render farm` value or Close deal step, and says so.
- Lead scores, notes, account health and pins are plugin data in `.thixo/data.sqlite` and survive a restart of the same copy, while the deals and contacts do not.
- A refused default plugin is a 403 on `/_thixo/plugins/<id>/1/load` and one `Failed to load resource` line in the console. It is the expected answer for sam, not an error to chase.
- Only the user's own layout changes when a widget is swapped. Use a fresh user or `Reset dashboard-pipeline to default` in the plugin browser before checking the default again.
- `Select` and the inputs have their label as the visible text, not an `aria-label`: use `getByLabel("Stage")` within the card, not a CSS attribute selector.
- A write through any plugin makes every `useQuery` on the page ask again; a card's `Lead score` can briefly re-read, so wait for network idle before reading its value.
- Clipboard reads need `clipboard-read` and `clipboard-write` granted on the context; `drive.mjs` does not grant them, `tests/e2e/crm.e2e.mjs` does.
