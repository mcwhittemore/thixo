// What a deal is worth is not on the deal. Scopes are about calls, not data (A12), so values and revenue are their
// own endpoints behind finance.read.

import { endpoint } from "thixo/api";
import { t } from "thixo/schema";
import { db } from "./db.js";

export const listDealValues = endpoint({
  method: "GET",
  path: "/finance/deal-values",
  scopes: ["deals.read", "finance.read"],
  output: t.array(t.object({ dealId: t.string(), value: t.number() })),
  handler: async () => db.values.all(),
});

export const getRevenue = endpoint({
  method: "GET",
  path: "/finance/revenue",
  scopes: ["finance.read"],
  output: t.object({ closed: t.number(), open: t.number() }),
  handler: async () => {
    const [deals, values] = await Promise.all([db.deals.all(), db.values.all()]);
    const stageOf = new Map(deals.map((d) => [d.id, d.stage]));
    let closed = 0;
    let open = 0;
    for (const { dealId, value } of values) {
      if (stageOf.get(dealId) === "closed") closed += value;
      else open += value;
    }
    return { closed, open };
  },
});
