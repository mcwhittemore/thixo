import { endpoint, HttpError } from "thixo/api";
import { t } from "thixo/schema";
import { db } from "./db.js";
import { Company } from "./records.js";

export const listCompanies = endpoint({
  method: "GET",
  path: "/companies",
  scopes: ["companies.read"],
  output: t.array(Company),
  handler: async () => db.companies.all(),
});

export const getCompany = endpoint({
  method: "GET",
  path: "/companies/:id",
  scopes: ["companies.read"],
  input: t.object({ id: t.string() }),
  output: Company,
  handler: async ({ input }) => {
    const company = await db.companies.find(input.id);
    if (!company) throw new HttpError(404, `No company ${input.id}`);
    return company;
  },
});

export const updateCompany = endpoint({
  method: "PATCH",
  path: "/companies/:id",
  scopes: ["companies.read", "companies.write"],
  input: t.object({ id: t.string(), tier: t.optional(t.string()), industry: t.optional(t.string()) }),
  output: Company,
  handler: async ({ input }) => {
    const { id, ...changes } = input;
    const company = await db.companies.update(id, changes);
    if (!company) throw new HttpError(404, `No company ${id}`);
    return company;
  },
});
