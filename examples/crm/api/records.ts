// The records plugins can annotate (A10), each with how Thixo asks the app about one (A13) and who sees an annotation
// on it (A11): a company's to everyone, a contact's to the one user who wrote it, a deal's to the writer's team.

import { record } from "thixo/api";
import { t } from "thixo/schema";
import { db } from "./db.js";

export const Company = record("company", {
  read: ["companies.read"],
  fields: { id: t.string(), name: t.string(), industry: t.string(), tier: t.string() },
  canRead: async (id, user) => user.scopes.includes("companies.read") && (await db.companies.find(id)) !== undefined,
  group: "everyone",
});

export const Contact = record("contact", {
  read: ["contacts.read"],
  fields: { id: t.string(), name: t.string(), email: t.string(), title: t.string(), companyId: t.string(), team: t.string(), lastContact: t.string() },
  canRead: async (id, user) => user.scopes.includes("contacts.read") && (await db.contacts.find(id)) !== undefined,
  group: "user",
});

export const Deal = record("deal", {
  read: ["deals.read"],
  fields: { id: t.string(), title: t.string(), companyId: t.string(), stage: t.string(), team: t.string() },
  canRead: async (id, user) => user.scopes.includes("deals.read") && (await db.deals.find(id)) !== undefined,
  group: (_id, user) => user.groups?.[0] ?? null,
});
