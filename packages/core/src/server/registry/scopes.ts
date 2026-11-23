import type { Manifest } from "thixo-thx/contract";
import type { RecordDef, SlotDef } from "../../contract.js";
import type { ServerContext } from "../context.js";

export const DATA_READ = "thixo.data.read";
export const DATA_WRITE = "thixo.data.write";

export function findRecord(ctx: ServerContext, name: string): RecordDef | undefined {
  return ctx.app.records.find((r) => r.name === name) ?? ctx.app.records.find((r) => r.exportName === name);
}

export function findSlot(ctx: ServerContext, name: string): SlotDef | undefined {
  return ctx.app.slots.find((s) => s.name === name) ?? ctx.app.slots.find((s) => s.exportName === name);
}

export function declaresData(manifest: Manifest): boolean {
  return Object.keys(manifest.data.stores).length + Object.keys(manifest.data.annotations).length > 0;
}

export function annotatedRecords(manifest: Manifest): string[] {
  return [...new Set([...manifest.annotates, ...Object.keys(manifest.data.annotations)])];
}

function endpointScopes(ctx: ServerContext, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const endpoint = ctx.app.endpoints.find((e) => e.name === name);
    if (endpoint) out.push(...endpoint.scopes);
  }
  return out;
}

/** P2, D11, D12, S13: what a user must hold to be offered a version. Endpoints, records and slots are looked up now,
 * so a scope an endpoint gains later is required of plugins already built. */
export function requiredScopes(ctx: ServerContext, manifest: Manifest): string[] {
  const scopes = new Set<string>(endpointScopes(ctx, manifest.requiredEndpoints));
  for (const name of annotatedRecords(manifest)) for (const s of findRecord(ctx, name)?.read ?? []) scopes.add(s);
  const slot = findSlot(ctx, manifest.slot);
  if (slot) for (const list of Object.values(slot.contextScopes)) for (const s of list) scopes.add(s);
  if (declaresData(manifest)) {
    scopes.add(DATA_READ);
    scopes.add(DATA_WRITE);
  }
  return [...scopes].sort();
}

export function optionalScopes(ctx: ServerContext, manifest: Manifest): string[] {
  const required = new Set(requiredScopes(ctx, manifest));
  return [...new Set(endpointScopes(ctx, manifest.optionalEndpoints))].filter((s) => !required.has(s)).sort();
}

/** Endpoints in the manifest, required or optional, whose scopes `holder` holds (P3, P4). */
export function endpointsCallableBy(ctx: ServerContext, manifest: Manifest, holder: { id: string; scopes: string[] }): string[] {
  return [...manifest.requiredEndpoints, ...manifest.optionalEndpoints].filter((name) => {
    const endpoint = ctx.app.endpoints.find((e) => e.name === name);
    return endpoint !== undefined && ctx.holds(holder, endpoint.scopes);
  });
}
