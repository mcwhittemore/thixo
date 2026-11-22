import type { Manifest } from "thixo-thx/contract";
import type { ServerContext } from "../context.js";
import { DATA_READ, DATA_WRITE, annotatedRecords, findRecord, findSlot } from "./scopes.js";

const VERBS = new Set(["read", "see", "create", "change", "delete", "add", "remove", "edit", "update", "write", "send", "view", "list", "manage", "assign", "close", "open"]);

function inflect(word: string): string {
  return /(s|sh|ch|x|z)$/.test(word) ? `${word}es` : `${word}s`;
}

/** "Read todos" becomes "Reads todos". "Create and change todos" becomes "Creates and changes todos". */
export function plainSentence(description: string): string {
  const words = description.trim().split(/\s+/);
  const out = words.map((word, i) => {
    const lower = word.toLowerCase();
    const afterAnd = words[i - 1]?.toLowerCase() === "and";
    return (i === 0 || afterAnd) && VERBS.has(lower) ? inflect(word) : word;
  });
  return out.join(" ");
}

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
  const describe = (scope: string): string | null => {
    if (scope.startsWith("thixo.")) return null;
    const text = ctx.app.scopes[scope];
    return text ? plainSentence(text) : null;
  };
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

  const optional = [...new Set(endpointScopes(manifest.optionalEndpoints))].filter((s) => !endpointScopes(manifest.requiredEndpoints).includes(s));
  for (const scope of optional) {
    const s = describe(scope);
    if (s) push(`If you can, ${s.charAt(0).toLowerCase()}${s.slice(1)}`);
  }
  if (manifest.shellServices.length) push(`Uses: ${manifest.shellServices.map((s) => SERVICE_WORDS[s] ?? s).join(", ")}`);
  if (manifest.libraries.length) push(`Uses the app's libraries: ${manifest.libraries.join(", ")}`);
  if (manifest.addresses.length) push(`Names outside addresses: ${[...new Set(manifest.addresses.map(host))].join(", ")}`);
  if (!out.length) push("Shows something in its slot and reads nothing");
  return out;
}

export { DATA_READ, DATA_WRITE };
