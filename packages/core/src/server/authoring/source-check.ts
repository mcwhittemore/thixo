import type { SourceFiles } from "thixo-thx/contract";
import type { RefusalCategory } from "../../contract.js";

/** What the check found, with where, so the agent and `thixo agent` can print it as `file:line:col`. */
export interface SourceFlag {
  category: RefusalCategory;
  reason: string;
  file: string;
  line: number;
  column: number;
  /** The words that matched, as written. */
  match: string;
  /** The line it is on was already in a plugin this one was forked from, written by someone else. */
  inherited: boolean;
}

export interface FlagOptions {
  /** The source files of the plugins this one was forked from that someone else wrote. A match on a line that was
   * already there is still flagged, but marked `inherited`, so it is not counted against the person. */
  inherited?: Iterable<string>;
}

/** Words that ask for a secret. Flagged only when the plugin also has a field to type into. */
const SECRET = /\b(?:passwords?|passwd|passcodes?|passphrases?|one[- ]time (?:pass)?codes?|verification codes?|security codes?|auth(?:entication)? codes?|2fa|mfa codes?|cvv|cvc|card numbers?|credit card|api keys?|secret keys?|private keys?|access tokens?|recovery (?:phrases?|codes?)|seed phrases?|social security numbers?|(?:log ?in|sign[- ]?in) (?:details|credentials)|credentials)\b/gi;

/** A PIN, in capitals, so "pin this todo" is not one. */
const PIN = /\bPINs?\b/g;

/** A field the person types into. */
const FIELD = /<\s*(?:input|textarea)\b|\b(?:TextInput|NumberInput)\b/;

/** Words the app's own sign-in says. A plugin has no reason to say them. */
const SIGN_IN = /\b(?:session (?:has )?(?:expired|timed out)|sign in again|log ?in again|re-?enter your (?:password|credentials|details)|verify your (?:identity|account)|confirm your password)\b/gi;

/** Characters a reader doesn't see: zero-width, joiners, soft hyphen, direction marks, variation selectors. */
const INVISIBLE = /^[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]$/u;

/** Spaces that are not the plain one. */
const SPACE = /^[   -   　]$/u;

/** Cyrillic and Greek letters that look like Latin ones. */
const CONFUSABLE: Record<string, string> = Object.fromEntries(
  [
    ["а", "a"], ["в", "b"], ["е", "e"], ["ё", "e"], ["к", "k"], ["м", "m"], ["н", "h"], ["о", "o"], ["р", "p"], ["с", "c"], ["т", "t"], ["у", "y"], ["х", "x"],
    ["і", "i"], ["ї", "i"], ["ј", "j"], ["ѕ", "s"], ["ԁ", "d"], ["һ", "h"], ["ԛ", "q"], ["ԝ", "w"], ["ɡ", "g"], ["ɩ", "i"], ["ո", "n"], ["ս", "u"],
    ["А", "A"], ["В", "B"], ["Е", "E"], ["К", "K"], ["М", "M"], ["Н", "H"], ["О", "O"], ["Р", "P"], ["С", "C"], ["Т", "T"], ["Х", "X"], ["І", "I"], ["Ј", "J"], ["Ѕ", "S"],
    ["α", "a"], ["ε", "e"], ["ι", "i"], ["κ", "k"], ["ν", "v"], ["ο", "o"], ["ρ", "p"], ["τ", "t"], ["υ", "u"], ["χ", "x"],
    ["Α", "A"], ["Β", "B"], ["Ε", "E"], ["Ζ", "Z"], ["Η", "H"], ["Ι", "I"], ["Κ", "K"], ["Μ", "M"], ["Ν", "N"], ["Ο", "O"], ["Ρ", "P"], ["Τ", "T"], ["Υ", "Y"], ["Χ", "X"],
  ],
);

/** The text as a reader sees it, for matching: NFKC, invisible characters dropped, odd spaces made plain,
 * look-alike letters made Latin, and `"pass" + "word"` joined. `at[i]` is where folded character `i` came from. */
function fold(text: string): { text: string; at: number[] } {
  let out = "";
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    if (!INVISIBLE.test(ch)) {
      const seen = SPACE.test(ch) ? " " : ch.normalize("NFKC");
      for (const c of seen) {
        for (const unit of CONFUSABLE[c] ?? c) {
          out += unit;
          at.push(i);
        }
      }
    }
    i += ch.length;
  }
  at.push(text.length);
  // Join string literals built with +: drop the closing quote, the plus and the opening quote between them.
  let joined = "";
  const joinedAt: number[] = [];
  let from = 0;
  for (const m of out.matchAll(/(["'`])\s*\+\s*\1/g)) {
    joined += out.slice(from, m.index);
    joinedAt.push(...at.slice(from, m.index));
    from = m.index + m[0].length;
  }
  joined += out.slice(from);
  joinedAt.push(...at.slice(from));
  return { text: joined, at: joinedAt };
}

function position(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end < 0 ? text.length : end).trim();
}

interface Hit {
  file: string;
  index: number;
  match: string;
  inherited: boolean;
}

/** A cheap, fixed check on the agent's submit path for the obvious cases: a plugin that says what the app's sign-in
 * says, or that asks for a secret in a field. It is a tripwire, not a classifier: it reads words, and the broker's
 * attributed dialogs stay the guard. It reads text as a person sees it, so look-alike letters, invisible characters
 * and split strings do not hide a word. */
export function flagSource(files: SourceFiles, options: FlagOptions = {}): SourceFlag | null {
  const entries = Object.entries(files).sort(([a], [b]) => (a === "plugin.thx" ? -1 : b === "plugin.thx" ? 1 : a.localeCompare(b)));
  const inheritedLines = new Set<string>();
  for (const text of options.inherited ?? []) for (const line of text.split("\n")) if (line.trim()) inheritedLines.add(line.trim());
  const folded = entries.map(([file, original]) => ({ file, original, ...fold(original) }));

  const hits = (pattern: RegExp): Hit[] => {
    const out: Hit[] = [];
    for (const f of folded) {
      for (const m of f.text.matchAll(pattern)) {
        const start = f.at[m.index];
        const end = f.at[m.index + m[0].length] ?? f.original.length;
        out.push({ file: f.file, index: start, match: f.original.slice(start, end).trim(), inherited: inheritedLines.has(lineAt(f.original, start)) });
      }
    }
    return out;
  };

  const signIn = hits(SIGN_IN);
  const hasField = folded.some((f) => FIELD.test(f.text));
  const secrets = hasField ? [...hits(SECRET), ...hits(PIN)].sort((a, b) => order(a) - order(b)) : [];
  function order(hit: Hit) {
    return entries.findIndex(([name]) => name === hit.file) * 1e9 + hit.index;
  }

  const make = (hit: Hit, reason: string): SourceFlag => ({ category: "credentials", reason, file: hit.file, ...position(files[hit.file], hit.index), match: hit.match, inherited: hit.inherited });
  const signInReason = (hit: Hit) => `The plugin says "${hit.match}", which is what the app's own sign-in says.`;
  const secretReason = (hit: Hit) => `The plugin has a field to type into and asks for "${hit.match}": a plugin never asks for a secret.`;

  // What the person wrote comes first; a line inherited from someone else's plugin only when nothing else matched.
  const own = signIn.find((h) => !h.inherited) ?? null;
  if (own) return make(own, signInReason(own));
  const ownSecret = secrets.find((h) => !h.inherited) ?? null;
  if (ownSecret) return make(ownSecret, secretReason(ownSecret));
  if (signIn[0]) return make(signIn[0], signInReason(signIn[0]));
  if (secrets[0]) return make(secrets[0], secretReason(secrets[0]));
  return null;
}
