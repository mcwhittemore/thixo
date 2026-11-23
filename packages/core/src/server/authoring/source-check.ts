import type { SourceFiles } from "thixo-thx/contract";
import type { RefusalCategory } from "../../contract.js";

/** What the check found, with where, so the agent and `thixo agent` can print it as `file:line:col`. */
export interface SourceFlag {
  category: RefusalCategory;
  reason: string;
  file: string;
  line: number;
  column: number;
  /** The words that matched. */
  match: string;
}

/** Words that ask for a secret. Flagged only when the plugin also has a field to type into. */
const SECRET = /\b(?:passwords?|passwd|passcodes?|passphrases?|one[- ]time (?:pass)?codes?|verification codes?|security codes?|auth(?:entication)? codes?|2fa|mfa codes?|cvv|cvc|card numbers?|credit card|api keys?|secret keys?|private keys?|access tokens?|recovery (?:phrases?|codes?)|seed phrases?|social security numbers?)\b/i;

/** A field the person types into. */
const FIELD = /<\s*(?:input|textarea)\b|\b(?:TextInput|NumberInput)\b/;

/** Words the app's own sign-in says. A plugin has no reason to say them. */
const SIGN_IN = /\b(?:session (?:has )?(?:expired|timed out)|sign in again|log ?in again|re-?enter your (?:password|credentials|details)|verify your (?:identity|account)|confirm your password)\b/i;

function at(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

/** A cheap, fixed check on the agent's submit path for the obvious cases: a plugin that says what the app's sign-in
 * says, or that asks for a secret in a field. It is a tripwire, not a classifier: it reads words, and the broker's
 * attributed dialogs stay the guard. */
export function flagSource(files: SourceFiles): SourceFlag | null {
  const entries = Object.entries(files).sort(([a], [b]) => (a === "plugin.thx" ? -1 : b === "plugin.thx" ? 1 : a.localeCompare(b)));
  for (const [file, text] of entries) {
    const m = SIGN_IN.exec(text);
    if (m) return { category: "credentials", reason: `The plugin says "${m[0]}", which is what the app's own sign-in says.`, file, ...at(text, m.index), match: m[0] };
  }
  const hasField = entries.some(([, text]) => FIELD.test(text));
  if (!hasField) return null;
  for (const [file, text] of entries) {
    const m = SECRET.exec(text);
    if (m) return { category: "credentials", reason: `The plugin has a field to type into and asks for "${m[0]}": a plugin never asks for a secret.`, file, ...at(text, m.index), match: m[0] };
  }
  return null;
}
