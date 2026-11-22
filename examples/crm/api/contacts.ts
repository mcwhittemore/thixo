import { endpoint, HttpError } from "thixo/api";
import { t } from "thixo/schema";
import { db } from "./db.js";
import { Contact } from "./records.js";

export const listContacts = endpoint({
  method: "GET",
  path: "/contacts",
  scopes: ["contacts.read"],
  output: t.array(Contact),
  handler: async () => db.contacts.all(),
});

export const getContact = endpoint({
  method: "GET",
  path: "/contacts/:id",
  scopes: ["contacts.read"],
  input: t.object({ id: t.string() }),
  output: Contact,
  handler: async ({ input }) => {
    const contact = await db.contacts.find(input.id);
    if (!contact) throw new HttpError(404, `No contact ${input.id}`);
    return contact;
  },
});

export const createContact = endpoint({
  method: "POST",
  path: "/contacts",
  scopes: ["contacts.read", "contacts.write"],
  input: t.object({ name: t.string(), email: t.string(), title: t.optional(t.string()), companyId: t.string() }),
  output: Contact,
  handler: async ({ input, user }) =>
    db.contacts.create({ name: input.name, email: input.email, title: input.title ?? "", companyId: input.companyId, team: user.groups?.[0] ?? "east" }),
});

// Everything at once, for the admin. Its own scope, so a plugin that offers it is refused to everyone else (A3).
export const exportContacts = endpoint({
  method: "GET",
  path: "/export/contacts",
  scopes: ["contacts.read", "admin.export"],
  output: t.string(),
  handler: async () => {
    const rows = await db.contacts.all();
    return ["id,name,email,team", ...rows.map((c) => [c.id, c.name, c.email, c.team].join(","))].join("\n");
  },
});
