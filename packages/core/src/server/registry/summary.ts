import type { Manifest } from "thixo-thx/contract";
import type { ServerContext } from "../context.js";
import { plainSentence, scopeSentence } from "../../scope-words.js";
import { DATA_READ, DATA_WRITE, annotatedRecords, declaresData, findRecord, findSlot } from "./scopes.js";

export { plainSentence };

const SERVICE_WORDS: Record<string, string> = {
  navigate: "navigation",
  openModal: "dialogs",
  copyToClipboard: "clipboard",
  download: "downloads",
  toast: "notices",
};

function host(address: string): string {
  try {
    const url = new URL(address);
    return url.protocol === "data:" ? "inline data" : url.host || address;
  } catch {
    return address;
  }
}

/** G5: what a plugin does, in plain sentences, from its manifest and the scopes' own descriptions. */
export function summarise(ctx: ServerContext, manifest: Manifest): string[] {
  const out: string[] = [];
  const push = (sentence: string) => {
    if (!out.includes(sentence)) out.push(sentence);
  };
  const describe = (scope: string): string | null => (scope.startsWith("thixo.") ? null : scopeSentence(ctx.app.scopes, scope));
  const endpointScopes = (names: string[]) => names.flatMap((n) => ctx.app.endpoints.find((e) => e.name === n)?.scopes ?? []);

  for (const scope of endpointScopes(manifest.requiredEndpoints)) {
    const s = describe(scope);
    if (s) push(s);
  }
  for (const name of annotatedRecords(manifest)) {
    for (const scope of findRecord(ctx, name)?.read ?? []) {
      const s = describe(scope);
      if (s) push(s);
    }
  }
  const slot = findSlot(ctx, manifest.slot);
  if (slot) for (const list of Object.values(slot.contextScopes)) for (const scope of list) {
    const s = describe(scope);
    if (s) push(s);
  }
  for (const [record, fields] of Object.entries(manifest.data.annotations)) {
    if (!fields.length) continue;
    push(`Adds ${fields.length} field${fields.length > 1 ? "s" : ""} to ${record}: ${fields.map((f) => `${f.name} (${f.type})`).join(", ")}`);
  }
  const stores = Object.keys(manifest.data.stores);
  if (stores.length) push(`Keeps ${stores.length > 1 ? "private stores" : "a private store"}: ${stores.join(", ")}`);
  // The plugin data scopes it needs (thixo.data.read and .write), in the same words the scope list uses.
  if (declaresData(manifest)) for (const scope of [DATA_READ, DATA_WRITE]) push(scopeSentence(ctx.app.scopes, scope)!);

  const optional = [...new Set(endpointScopes(manifest.optionalEndpoints))].filter((s) => !endpointScopes(manifest.requiredEndpoints).includes(s));
  for (const scope of optional) {
    const s = describe(scope);
    if (s) push(`If you can, ${s.charAt(0).toLowerCase()}${s.slice(1)}`);
  }
  if (manifest.shellServices.length) push(`Uses: ${manifest.shellServices.map((s) => SERVICE_WORDS[s] ?? s).join(", ")}`);
  if (manifest.libraries.length) push(`Uses the app's libraries: ${manifest.libraries.join(", ")}`);
  if (manifest.addresses.length) {
    push(`Names outside addresses: ${[...new Set(manifest.addresses.map(host))].join(", ")}`);
    // A plugin that picks which of several fixed addresses on one host to show, by what it read, tells whoever
    // runs that host what it read: one load or click per choice (redteam rounds 1 and 2). Say so where it happens.
    const perHost = new Map<string, number>();
    for (const address of new Set(manifest.addresses)) perHost.set(host(address), (perHost.get(host(address)) ?? 0) + 1);
    for (const [name, count] of perHost)
      if (count > 1) push(`Can choose among ${count} addresses on ${name}: which one it shows tells ${name} something about what it read`);
  }
  if (!out.length) push("Shows something in its slot and reads nothing");
  return out;
}

export { DATA_READ, DATA_WRITE };
