import { endpoint, HttpError } from "thixo/api";
import { t } from "thixo/schema";
import { db, STAGES } from "./db.js";
import { Deal } from "./records.js";

export const listDeals = endpoint({
  method: "GET",
  path: "/deals",
  scopes: ["deals.read"],
  output: t.array(Deal),
  handler: async () => db.deals.all(),
});

export const getDeal = endpoint({
  method: "GET",
  path: "/deals/:id",
  scopes: ["deals.read"],
  input: t.object({ id: t.string() }),
  output: Deal,
  handler: async ({ input }) => {
    const deal = await db.deals.find(input.id);
    if (!deal) throw new HttpError(404, `No deal ${input.id}`);
    return deal;
  },
});

export const moveDeal = endpoint({
  method: "POST",
  path: "/deals/:id/move",
  scopes: ["deals.read", "deals.write"],
  input: t.object({ id: t.string(), stage: t.string() }),
  output: Deal,
  handler: async ({ input }) => {
    if (!(STAGES as readonly string[]).includes(input.stage) || input.stage === "closed") {
      throw new HttpError(400, `A deal moves to lead, qualified, proposal or negotiation. Closing is its own call.`);
    }
    const current = await db.deals.find(input.id);
    if (!current) throw new HttpError(404, `No deal ${input.id}`);
    if (current.stage === "closed") throw new HttpError(409, "A closed deal does not move");
    return (await db.deals.setStage(input.id, input.stage as (typeof STAGES)[number]))!;
  },
});

// Closing needs a scope moving a deal does not.
export const closeDeal = endpoint({
  method: "POST",
  path: "/deals/:id/close",
  scopes: ["deals.read", "deals.close"],
  input: t.object({ id: t.string() }),
  output: Deal,
  handler: async ({ input }) => {
    const deal = await db.deals.setStage(input.id, "closed");
    if (!deal) throw new HttpError(404, `No deal ${input.id}`);
    return deal;
  },
});
