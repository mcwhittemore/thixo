import type { SourceFiles } from "thixo-thx/contract";

/** The entry file of a plugin. `definePlugin`'s second argument, a literal, names it (U7). */
export const ENTRY_FILES = ["plugin.thx"];

interface Property {
  start: number;
  /** End of the value, before any comma. */
  end: number;
  key: string;
  valueStart: number;
}

interface Literal {
  /** Index just after `{`. */
  open: number;
  /** Index of the closing `}`. */
  close: number;
  properties: Property[];
}

function skipSpace(text: string, i: number): number {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else return i;
  }
}

function skipString(text: string, i: number): number {
  const quote = text[i];
  i++;
  while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/** Index of the end of an expression that starts at `i`: the next top-level `,`, `)`, `]` or `}`. */
function skipValue(text: string, i: number): number {
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") i = skipString(text, i);
    else if (text.startsWith("//", i) || text.startsWith("/*", i)) i = skipSpace(text, i);
    else if (c === "(" || c === "[" || c === "{") depth++, i++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--, i++;
    } else if (c === "," && depth === 0) return i;
    else i++;
  }
  return i;
}

function trimEnd(text: string, floor: number, end: number): number {
  while (end > floor && /\s/.test(text[end - 1])) end--;
  return end;
}

function findLiteral(text: string): Literal | null {
  const call = /\bdefinePlugin\s*\(/.exec(text);
  if (!call) return null;
  let i = skipValue(text, call.index + call[0].length);
  if (text[i] !== ",") return null;
  i = skipSpace(text, i + 1);
  if (text[i] !== "{") return null;
  const open = i + 1;
  const properties: Property[] = [];
  i = skipSpace(text, open);
  while (i < text.length && text[i] !== "}") {
    const start = i;
    let key: string;
    if (text[i] === '"' || text[i] === "'") {
      const end = skipString(text, i);
      key = text.slice(i + 1, end - 1);
      i = end;
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
      if (!m) return null;
      key = m[0];
      i += key.length;
    }
    i = skipSpace(text, i);
    if (text[i] !== ":") {
      const stop = skipValue(text, i);
      properties.push({ start, end: trimEnd(text, start, stop), key, valueStart: start });
      i = stop;
    } else {
      const valueStart = skipSpace(text, i + 1);
      const end = trimEnd(text, valueStart, skipValue(text, valueStart));
      properties.push({ start, end, key, valueStart });
      i = skipValue(text, valueStart);
    }
    if (text[i] === ",") i = skipSpace(text, i + 1);
  }
  if (text[i] !== "}") return null;
  return { open, close: i, properties };
}

export function readPluginId(files: SourceFiles): string | null {
  for (const file of ENTRY_FILES) {
    const text = files[file];
    const literal = text && findLiteral(text);
    const id = literal && literal.properties.find((p) => p.key === "id");
    if (id) {
      const raw = text.slice(id.valueStart, id.end).trim();
      const m = /^(["'`])(.*)\1$/s.exec(raw);
      if (m) return m[2];
    }
  }
  return null;
}

/** Adds the id to `definePlugin`'s metadata literal, or replaces the one there, and changes nothing else. */
export function withPluginId(files: SourceFiles, id: string): SourceFiles {
  const file = ENTRY_FILES.find((f) => files[f] && findLiteral(files[f]));
  if (!file) throw new Error(`No definePlugin call with a literal second argument in ${ENTRY_FILES.join(" or ")}`);
  const text = files[file];
  const literal = findLiteral(text)!;
  const value = JSON.stringify(id);
  const existing = literal.properties.find((p) => p.key === "id");
  let out: string;
  if (existing) out = text.slice(0, existing.valueStart) + value + text.slice(existing.end);
  else if (literal.properties.length) {
    const at = literal.properties[0].start;
    out = `${text.slice(0, at)}id: ${value}, ${text.slice(at)}`;
  } else {
    const at = skipSpace(text, literal.open);
    out = `${text.slice(0, at)}id: ${value}${text.slice(at)}`;
  }
  return { ...files, [file]: out };
}

/** The inverse of `withPluginId`: the source as it was before the id was added. A source without an id comes back
 * unchanged. Versions are stored and hashed in this form, so a promoted folder deploys to the version it came from. */
export function withoutPluginId(files: SourceFiles): SourceFiles {
  const file = ENTRY_FILES.find((f) => files[f] && findLiteral(files[f])?.properties.some((p) => p.key === "id"));
  if (!file) return files;
  const text = files[file];
  const literal = findLiteral(text)!;
  const index = literal.properties.findIndex((p) => p.key === "id");
  const prop = literal.properties[index];
  let from = prop.start;
  let to = prop.end;
  const comma = skipSpaceOnly(text, to);
  if (text[comma] === ",") {
    to = skipSpaceOnly(text, comma + 1);
  } else if (index > 0) {
    from = literal.properties[index - 1].end;
  }
  return { ...files, [file]: text.slice(0, from) + text.slice(to) };
}

function skipSpaceOnly(text: string, i: number): number {
  while (i < text.length && /[ \t]/.test(text[i])) i++;
  return i;
}
