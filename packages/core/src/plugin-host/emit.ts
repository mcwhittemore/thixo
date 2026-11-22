import type { SchemaJson } from "thixo-thx/contract";
import { ConvertError, pluginToHost, type RecordFields, type UrlMint } from "./convert.js";
import { ThixoRefused } from "./refused.js";

/** Receives an event a plugin sent, already checked against the slot's emits, in host form (urls as strings). */
export type Deliver = (event: string, payload: unknown) => void;

/** The `emit` a plugin's component gets (S11): one function per event the slot declares. Each checks its payload
 * against the event's schema, refusing a wrong one, and hands it to `deliver`. Returns unwrapped functions; wrap each
 * with `rt.hostFunction`. */
export function createEmit(
  emits: Record<string, SchemaJson>,
  deliver: Deliver,
  rt: UrlMint,
  signal: AbortSignal,
  records: RecordFields = {},
): Record<string, (payload: unknown) => void> {
  const out: Record<string, (payload: unknown) => void> = {};
  for (const [event, schema] of Object.entries(emits)) {
    out[event] = (payload: unknown) => {
      if (signal.aborted) throw new ThixoRefused(`emit.${event}`, "the plugin has stopped");
      let value: unknown;
      try {
        value = pluginToHost(schema, payload, rt, records);
      } catch (error) {
        if (error instanceof ConvertError) throw new ThixoRefused(`emit.${event}`, `bad payload: ${error.message}`);
        throw error;
      }
      deliver(event, value);
    };
  }
  return out;
}
