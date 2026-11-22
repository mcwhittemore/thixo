// Where plugins go (S1). Three pages with routes of their own, a panel beside a picked record, a child slot inside
// the contact panel and one per deal card, and two dashboard widgets. A slot's contract is the context the shell
// passes in (with the scopes that read each field, S13) and the events it takes back (S11).

import { slot } from "thixo/slots";
import { t } from "thixo/schema";

// A child of the contact panel (S13): whatever fills it decides what is shown under a contact.
export const contactNotes = slot.widget({
  name: "contact-notes",
  context: t.object({ contactId: t.string() }),
  contextScopes: { contactId: ["contacts.read"] },
});

// A child of the pipeline: one per deal card.
export const dealCard = slot.widget({
  name: "deal-card",
  context: t.object({ dealId: t.string() }),
  contextScopes: { dealId: ["deals.read"] },
});

export const contacts = slot.page({
  name: "contacts",
  emits: { select: t.object({ contactId: t.string() }) },
});

export const contactDetail = slot.panel({
  name: "contact-detail",
  context: t.object({ contactId: t.string() }),
  contextScopes: { contactId: ["contacts.read"] },
  emits: { openCompany: t.object({ companyId: t.string() }) },
  children: [contactNotes],
});

export const companies = slot.page({
  name: "companies",
  emits: { select: t.object({ companyId: t.string() }) },
});

export const companyDetail = slot.panel({
  name: "company-detail",
  context: t.object({ companyId: t.string() }),
  contextScopes: { companyId: ["companies.read"] },
});

export const deals = slot.page({
  name: "deals",
  emits: { select: t.object({ dealId: t.string() }) },
  children: [dealCard],
});

// The dashboard: each widget is its own slot, so a user can swap one without touching the others.
export const dashboardPipeline = slot.widget({
  name: "dashboard-pipeline",
  emits: { openStage: t.object({ stage: t.string() }) },
  size: { minHeight: "10rem" },
});

export const dashboardPinned = slot.widget({
  name: "dashboard-pinned",
  emits: { open: t.object({ contactId: t.string() }) },
  size: { minHeight: "10rem" },
});
