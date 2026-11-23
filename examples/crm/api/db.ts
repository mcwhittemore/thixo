// The app's own storage (stand-in, in memory). Thixo has no opinion about it. A deal's value is kept apart from the
// deal because it takes another scope to see (A12).

export const STAGES = ["lead", "qualified", "proposal", "negotiation", "closed"] as const;
export type Stage = (typeof STAGES)[number];

export type Company = { id: string; name: string; industry: string; tier: string };
export type Contact = { id: string; name: string; email: string; title: string; companyId: string; team: string; lastContact: string };
export type Deal = { id: string; title: string; companyId: string; stage: Stage; team: string };

const companies = new Map<string, Company>(
  [
    { id: "co-1", name: "Acme Robotics", industry: "Manufacturing", tier: "key" },
    { id: "co-2", name: "Birchwood Health", industry: "Healthcare", tier: "standard" },
    { id: "co-3", name: "Cobalt Logistics", industry: "Transport", tier: "standard" },
    { id: "co-4", name: "Delta Studios", industry: "Media", tier: "standard" },
  ].map((c) => [c.id, c]),
);

const contacts = new Map<string, Contact>(
  [
    { id: "ct-1", name: "Maria Lopez", email: "maria@acme.example", title: "Head of Ops", companyId: "co-1", team: "east", lastContact: "2026-11-02" },
    { id: "ct-2", name: "Tom Okafor", email: "tom@acme.example", title: "CFO", companyId: "co-1", team: "east", lastContact: "2026-10-21" },
    { id: "ct-3", name: "Priya Nair", email: "priya@birchwood.example", title: "Director", companyId: "co-2", team: "west", lastContact: "2026-11-10" },
    { id: "ct-4", name: "Jon Berg", email: "jon@cobalt.example", title: "Buyer", companyId: "co-3", team: "west", lastContact: "2026-09-30" },
    { id: "ct-5", name: "Lena Fischer", email: "lena@delta.example", title: "Producer", companyId: "co-4", team: "east", lastContact: "2026-11-15" },
  ].map((c) => [c.id, c]),
);

const deals = new Map<string, Deal>(
  [
    { id: "dl-1", title: "Acme warehouse robots", companyId: "co-1", stage: "negotiation", team: "east" },
    { id: "dl-2", title: "Birchwood scheduling", companyId: "co-2", stage: "qualified", team: "west" },
    { id: "dl-3", title: "Cobalt fleet tracking", companyId: "co-3", stage: "lead", team: "west" },
    { id: "dl-4", title: "Delta render farm", companyId: "co-4", stage: "proposal", team: "east" },
    { id: "dl-5", title: "Acme maintenance plan", companyId: "co-1", stage: "closed", team: "east" },
  ].map((d) => [d.id, d as Deal]),
);

const values = new Map<string, number>([
  ["dl-1", 120_000],
  ["dl-2", 45_000],
  ["dl-3", 18_500],
  ["dl-4", 76_000],
  ["dl-5", 30_000],
]);

export const db = {
  companies: {
    all: async () => [...companies.values()],
    find: async (id: string) => companies.get(id),
    update: async (id: string, changes: Partial<Pick<Company, "tier" | "industry">>) => {
      const current = companies.get(id);
      if (!current) return undefined;
      const next = { ...current, ...changes };
      companies.set(id, next);
      return next;
    },
  },
  contacts: {
    all: async () => [...contacts.values()],
    find: async (id: string) => contacts.get(id),
    create: async (input: Omit<Contact, "id" | "lastContact">) => {
      const contact = { ...input, id: crypto.randomUUID(), lastContact: new Date().toISOString().slice(0, 10) };
      contacts.set(contact.id, contact);
      return contact;
    },
  },
  deals: {
    all: async () => [...deals.values()],
    find: async (id: string) => deals.get(id),
    setStage: async (id: string, stage: Stage) => {
      const current = deals.get(id);
      if (!current) return undefined;
      const next = { ...current, stage };
      deals.set(id, next);
      return next;
    },
  },
  values: {
    all: async () => [...values].map(([dealId, value]) => ({ dealId, value })),
  },
};
