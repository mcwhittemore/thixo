import type { ServerContext } from "../context.js";
import { createDataServices } from "./plugin-data.js";

const live = new Set<ServerContext>();

export function trackContext(ctx: ServerContext): void {
  live.add(ctx);
}

/** A13: an implementor's handler calls this when it deletes a record that plugins annotate, so the annotations go
 * with it. It reaches every Thixo in this process, because a handler has no `ctx` to hand. `record` is the record's
 * name or its export name. */
export async function recordDeleted(record: string, id: string): Promise<void> {
  for (const ctx of live) await createDataServices(ctx).recordDeleted(record, id);
}
