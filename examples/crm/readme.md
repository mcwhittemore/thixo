# CRM example

A small CRM written the way a Thixo app should read: companies, contacts and deals, a dashboard, and ten default
plugins. It stretches what the [todo example](../todo/readme.md) does not: several records with different annotation
groupings, finance data behind its own scope, an exposed library, shell services, and a swap through the plugin
browser.

From the repository root:

```sh
npm install
npm run build
npx thixo dev examples/crm --port 4311
```

Open http://127.0.0.1:4311 and pick a user in **Signed in as**. The login is a stand-in (`api/session.ts`): the
`thixo-user` cookie names the user.

| User | Holds | Sees |
| --- | --- | --- |
| `rita` (team east), `ravi` (team west) | contacts, companies and deals read/write, plugin data, `thixo.plugins.author`, `thixo.plugins.share` | Everything, Close deal grayed out, no deal values |
| `mia` (east, sales manager) | a rep's scopes plus `deals.close`, `finance.read`, `thixo.plugins.promote` | Deal values and revenue, Close deal works |
| `sam` (support agent) | `contacts.read`, `companies.read`, `thixo.data.read` | Contacts and companies. Plugins that write data are not offered to them |
| `ada` (admin) | everything, including `admin.export` | Export all contacts |

`thixo dev` keeps plugin data, the registry and each user's layout in `.thixo/` here (git-ignored). The records
themselves are in memory (`api/db.ts`).

`npm run e2e` at the root drives all of this in headless Chromium (`tests/e2e/crm.e2e.mjs`) on a throwaway copy of
this folder.

## The files

```
api/
  scopes.ts        nine scopes, in words
  records.ts       Company, Contact and Deal: canRead and who sees an annotation
  contacts.ts      listContacts, getContact, createContact, exportContacts
  companies.ts     listCompanies, getCompany, updateCompany
  deals.ts         listDeals, getDeal, moveDeal, closeDeal
  finance.ts       listDealValues, getRevenue (finance.read)
  session.ts       the app's own login (stand-in)
  db.ts            the app's own storage (stand-in, in memory)
app/
  slots.ts         where plugins go: three pages, two panels, two child slots, two widgets
  shell.tsx        the base app: navigation, client-side routes, panels
lib/               @app/format, a library the implementor exposes to plugins
plugins/           ten default plugins, below
thixo.config.ts   identity, adapters, the exposed library, and the default layout
```

## What it shows

Requirement by requirement.

| Requirement | Where |
| --- | --- |
| A2, A3: scopes per endpoint, several per endpoint | [api/](api/): `closeDeal` needs `deals.read` and `deals.close`; `exportContacts` needs `contacts.read` and `admin.export` |
| A12: data behind another scope is another endpoint | [api/finance.ts](api/finance.ts): a deal's value and revenue are not on the deal. Without `finance.read` the board shows no values |
| A10, A13: records that plugins annotate, `canRead` | [api/records.ts](api/records.ts): each record checks that it exists and that the user holds its read scope |
| A11: who sees an annotation | [api/records.ts](api/records.ts): contacts by user (`"user"`), deals by team (a function returning the user's team), companies by everyone |
| S5, S10, S12: slots, context in, events out, one plugin each | [app/slots.ts](app/slots.ts): a page slot per section, `select`, `openCompany`, `openStage` and `open` events |
| S13: child slots, context fields carrying scopes | `contact-detail/contact-notes` (a child of the contact panel) and `deals/deal-card` (one per card). Every context id names the scope that reads it |
| S1, S7: an ordinary React shell with client-side routes | [app/shell.tsx](app/shell.tsx): `/`, `/contacts/:id`, `/companies/:id`, `/deals`. A plugin's `navigate` is heard through `popstate` |
| S8: shell services | `navigate` and `copyToClipboard` ([contact-detail](plugins/contact-detail/plugin.thx)), `download` ([contacts-list](plugins/contacts-list/plugin.thx), a CSV of the rows on screen), `toast` |
| P2, P4: optional endpoints, grayed-out actions | Close deal (`deals.close`), Export all (`admin.export`), Add contact (`contacts.write`) and the company tier select (`companies.write`) are disabled with `useCan` |
| P2: optional data endpoints | [pipeline-totals](plugins/pipeline-totals/plugin.thx) and the board use the finance endpoints if the user may call them, and carry on without |
| D1, D2, D3: annotations and a private store | [notes](plugins/notes/data.thx) and [lead-score](plugins/lead-score/data.thx) annotate; [pinned-contacts](plugins/pinned-contacts/data.thx) has a store, private to the user |
| G1, G5: only what a user may run is offered | The plugin browser does not list plugins that need `thixo.data.write` or `deals.read` for `sam`. A default plugin whose scope `sam` lacks shows `needs the scope thixo.data.write` in its slot |
| L3: an exposed library | [lib/](lib/) is `@app/format`: `formatMoney`, `formatDay` and a `BarChart` component, declared in `lib/format-types.ts` and listed in `thixo.config.ts` |
| L5: raw elements and `css()` | `contacts-list`, `companies-list` and `deals-pipeline` use `<table>`, `<section>`, `<article>` and `css()`; the others use `thixo/ui` |
| S9, S12, G5: swapping the plugin in a slot | `plugins/stage-chart` is deployed but is not in the layout. A user switches the dashboard's pipeline widget to it in the plugin browser |

## The plugins

| Folder | Slot | Required | Optional | Data |
| --- | --- | --- | --- | --- |
| `contacts-list` | `contacts` | `contacts.read`, `companies.read` | `contacts.write`, `admin.export` | none |
| `contact-detail` | `contact-detail` | `contacts.read`, `companies.read` | none | none |
| `notes` | `contact-notes` | `contacts.read`, `thixo.data.*` | none | Annotation on contact: `note`. Private per user |
| `companies-list` | `companies` | `companies.read`, `contacts.read` | `companies.write` | none |
| `account-health` | `company-detail` | `companies.read`, `thixo.data.*` | none | Annotation on company: `status`. Shared with everyone |
| `deals-pipeline` | `deals` | `deals.read`, `deals.write` | `deals.close`, `finance.read` | none |
| `lead-score` | `deal-card` | `deals.read`, `thixo.data.*` | none | Annotation on deal: `score`. Shared within a team |
| `pipeline-totals` | `dashboard-pipeline` | `deals.read` | `finance.read` | none |
| `stage-chart` | `dashboard-pipeline` | `deals.read` | none | none. Not in the layout |
| `pinned-contacts` | `dashboard-pinned` | `contacts.read`, `thixo.data.*` | none | Private store `pins`: `contactId` |

`npx thixo compile examples/crm/plugins/<folder>` prints what the build derives for any of them.

## What writing this surfaced

1. **A raw element in a list could not take `key`.** `<tr key={c.id}>` was a type error in thx, because the element
   typings left `key` out. It is now allowed on every raw element (`packages/thx/src/compiler/lib-dts.ts`).
2. **`thixo/ui` has no table, and a label is not a name.** `Select` and the inputs take a `label`, but a list of
   records is raw elements. That is by design (L5), and works.
3. **A default plugin the user may not run is a message in its slot.** For `sam`, the notes child slot reads
   `needs the scope thixo.data.write`. An app that would rather hide it checks the scope in the shell, as the
   dashboard does for users without `deals.read`.
