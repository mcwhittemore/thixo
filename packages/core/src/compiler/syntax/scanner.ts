// Turns text into tokens on demand. The parser drives it: it asks for a regular expression, a template's next piece,
// a JSX name or JSX text only where the grammar says one can stand, the way TypeScript's scanner is rescanned.

export type TokType = "name" | "num" | "string" | "template" | "punct" | "private" | "regex" | "bigint" | "jsxText" | "eof";

export interface Token {
  type: TokType;
  /** Name text, punctuator, cooked string value, or raw JSX text. */
  value: string;
  start: number;
  end: number;
  /** A line break sits between this token and the one before it. */
  nl: boolean;
  /** A name spelled with a `\u` escape. */
  escaped?: boolean;
  num?: number;
  /** A template piece: cooked and raw text, and whether it ends the template with a backtick. */
  raw?: string;
  tail?: boolean;
}

/** A syntax error. Not an Error: the parser throws these while it tries a reading, and a stack trace each time would
 * cost more than the parse. */
export class SyntaxError_ {
  constructor(
    readonly message: string,
    readonly pos: number,
  ) {}
}

/** Punctuators by first character, longest first. */
const PUNCTS: Record<string, string[]> = {
  "{": ["{"], "}": ["}"], "(": ["("], ")": [")"], "[": ["["], "]": ["]"], ";": [";"], ",": [","], "~": ["~"], ":": [":"], "@": ["@"],
  ".": ["...", "."],
  "<": ["<<=", "<=", "<<", "<"],
  "=": ["===", "==", "=>", "="],
  "!": ["!==", "!=", "!"],
  "+": ["++", "+=", "+"],
  "-": ["--", "-=", "-"],
  "*": ["**=", "**", "*=", "*"],
  "/": ["/=", "/"],
  "%": ["%=", "%"],
  "&": ["&&=", "&&", "&=", "&"],
  "|": ["||=", "||", "|=", "|"],
  "^": ["^=", "^"],
  "?": ["??=", "??", "?.", "?"],
};

const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$\u200c\u200d]/u;

function isIdStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$" || (ch > "\x7f" && ID_START.test(ch));
}

function isIdPart(ch: string): boolean {
  return isIdStart(ch) || (ch >= "0" && ch <= "9") || (ch > "\x7f" && ID_PART.test(ch));
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isLineBreak(ch: string): boolean {
  return ch === "\n" || ch === "\r" || ch === " " || ch === " ";
}

export class Scanner {
  pos = 0;

  constructor(readonly text: string) {}

  fail(message: string, pos = this.pos): never {
    throw new SyntaxError_(message, pos);
  }

  /** Skips whitespace and comments. Returns true if a line break was crossed. */
  private skipTrivia(): boolean {
    const t = this.text;
    const n = t.length;
    let nl = false;
    while (this.pos < n) {
      const c = t.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 11 || c === 12) this.pos++;
      else if (c === 10 || c === 13) {
        nl = true;
        this.pos++;
      } else if (c === 47) {
        const d = t.charCodeAt(this.pos + 1);
        if (d === 47) {
          while (this.pos < n && !isLineBreak(t[this.pos])) this.pos++;
        } else if (d === 42) {
          const close = t.indexOf("*/", this.pos + 2);
          if (close < 0) this.fail("'*/' expected.");
          for (let i = this.pos; i < close; i++) {
            const e = t.charCodeAt(i);
            if (e === 10 || e === 13 || e === 0x2028 || e === 0x2029) nl = true;
          }
          this.pos = close + 2;
        } else break;
      } else if (c > 127) {
        const ch = t[this.pos];
        if (isLineBreak(ch)) {
          nl = true;
          this.pos++;
        } else if (ch === "\ufeff" || /\s/.test(ch)) this.pos++;
        else break;
      } else break;
    }
    return nl;
  }

  next(): Token {
    const nl = this.skipTrivia();
    const t = this.text;
    const start = this.pos;
    if (start >= t.length) return { type: "eof", value: "", start, end: start, nl: true };
    const ch = t[start];
    if (isIdStart(ch) || ch === "\\") {
      const { name, escaped } = this.identifier();
      return { type: "name", value: name, start, end: this.pos, nl, escaped };
    }
    if (ch === "#") {
      this.pos++;
      if (this.pos < t.length && (isIdStart(t[this.pos]) || t[this.pos] === "\\")) {
        const { name } = this.identifier();
        return { type: "private", value: name, start, end: this.pos, nl };
      }
      this.fail("Invalid character.", start);
    }
    if (isDigit(ch) || (ch === "." && isDigit(t[start + 1] ?? ""))) return this.number(start, nl);
    if (ch === '"' || ch === "'") {
      const value = this.string(ch);
      return { type: "string", value, start, end: this.pos, nl };
    }
    if (ch === "`") {
      this.pos++;
      return this.templatePiece(start, nl);
    }
    if (ch === "?" && t[start + 1] === "." && isDigit(t[start + 2] ?? "")) {
      this.pos++;
      return { type: "punct", value: "?", start, end: this.pos, nl };
    }
    // `>` is always one token here. The parser joins `>>`, `>=` and the rest where an operator can stand.
    if (ch === ">") {
      this.pos++;
      return { type: "punct", value: ">", start, end: this.pos, nl };
    }
    const options = PUNCTS[ch];
    if (options)
      for (const p of options)
        if (p.length === 1 || t.startsWith(p, start)) {
          this.pos += p.length;
          return { type: "punct", value: p, start, end: this.pos, nl };
        }
    this.fail("Invalid character.", start);
  }

  private identifier(): { name: string; escaped: boolean } {
    const t = this.text;
    const from = this.pos;
    let i = from;
    while (i < t.length) {
      const c = t.charCodeAt(i);
      if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 36 || (i > from && c >= 48 && c <= 57)) i++;
      else break;
    }
    const stop = t.charCodeAt(i);
    if (i > from && !(stop === 92 || stop > 127)) {
      this.pos = i;
      return { name: t.slice(from, i), escaped: false };
    }
    let name = "";
    let escaped = false;
    let first = true;
    while (this.pos < t.length) {
      const cp = t.codePointAt(this.pos)!;
      const ch = String.fromCodePoint(cp);
      if (ch === "\\") {
        if (t[this.pos + 1] !== "u") this.fail("Invalid character.");
        this.pos += 2;
        const c = this.unicodeEscape();
        if (!(first ? isIdStart(c) : isIdPart(c))) this.fail("Invalid character.");
        name += c;
        escaped = true;
      } else if (first ? isIdStart(ch) : isIdPart(ch)) {
        name += ch;
        this.pos += ch.length;
      } else break;
      first = false;
    }
    return { name, escaped };
  }

  /** After `\u`: `XXXX` or `{X...}`. */
  private unicodeEscape(): string {
    const t = this.text;
    if (t[this.pos] === "{") {
      const close = t.indexOf("}", this.pos);
      const hex = close < 0 ? "" : t.slice(this.pos + 1, close);
      if (!/^[0-9a-fA-F]+$/.test(hex) || parseInt(hex, 16) > 0x10ffff) this.fail("Invalid Unicode escape sequence.");
      this.pos = close + 1;
      return String.fromCodePoint(parseInt(hex, 16));
    }
    const hex = t.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("Hexadecimal digit expected.");
    this.pos += 4;
    return String.fromCharCode(parseInt(hex, 16));
  }

  private number(start: number, nl: boolean): Token {
    const t = this.text;
    const digits = (ok: (c: string) => boolean) => {
      const from = this.pos;
      while (this.pos < t.length && (ok(t[this.pos]) || (t[this.pos] === "_" && this.pos > from && ok(t[this.pos + 1] ?? "")))) this.pos++;
      return this.pos > from;
    };
    const prefixed = t[start] === "0" ? (t[start + 1] ?? "").toLowerCase() : "";
    if (prefixed === "x" || prefixed === "o" || prefixed === "b") {
      this.pos += 2;
      const ok = prefixed === "x" ? (c: string) => /[0-9a-fA-F]/.test(c) : prefixed === "o" ? (c: string) => c >= "0" && c <= "7" : (c: string) => c === "0" || c === "1";
      if (!digits(ok)) this.fail(prefixed === "x" ? "Hexadecimal digit expected." : prefixed === "o" ? "Octal digit expected." : "Binary digit expected.");
    } else {
      if (t[start] === "0" && isDigit(t[start + 1] ?? "")) this.fail("Octal literals are not allowed. Use the syntax '0o" + t.slice(start + 1).match(/^\d+/)![0] + "'.", start);
      digits(isDigit);
      if (t[this.pos] === "." ) {
        this.pos++;
        digits(isDigit);
      }
      if (t[this.pos] === "e" || t[this.pos] === "E") {
        this.pos++;
        if (t[this.pos] === "+" || t[this.pos] === "-") this.pos++;
        if (!digits(isDigit)) this.fail("Digit expected.");
      }
    }
    if (t[this.pos] === "n") {
      this.pos++;
      return { type: "bigint", value: t.slice(start, this.pos), start, end: this.pos, nl };
    }
    if (this.pos < t.length && isIdStart(t[this.pos])) this.fail("An identifier or keyword cannot immediately follow a numeric literal.");
    const raw = t.slice(start, this.pos);
    const clean = raw.replace(/_/g, "");
    const num = /^0[oO]/.test(clean) ? parseInt(clean.slice(2), 8) : /^0[bB]/.test(clean) ? parseInt(clean.slice(2), 2) : Number(clean);
    return { type: "num", value: raw, start, end: this.pos, nl, num };
  }

  private escape(inTemplate: boolean): string {
    const t = this.text;
    const c = t[this.pos++];
    switch (c) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "0":
        if (isDigit(t[this.pos] ?? "")) this.fail(inTemplate ? "Octal escape sequences are not allowed in template strings." : "Octal escape sequences are not allowed. Use the syntax '\\x0" + t[this.pos] + "'.", this.pos - 2);
        return "\0";
      case "x": {
        const hex = t.slice(this.pos, this.pos + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) this.fail("Hexadecimal digit expected.");
        this.pos += 2;
        return String.fromCharCode(parseInt(hex, 16));
      }
      case "u":
        return this.unicodeEscape();
      case "\r":
        if (t[this.pos] === "\n") this.pos++;
        return "";
      case "\n":
      case " ":
      case " ":
        return "";
      case undefined:
        this.fail("Unterminated string literal.");
      default:
        if (c >= "1" && c <= "9") this.fail("Octal escape sequences are not allowed.", this.pos - 2);
        return c;
    }
  }

  private string(quote: string): string {
    const t = this.text;
    this.pos++;
    let out = "";
    while (true) {
      if (this.pos >= t.length) this.fail("Unterminated string literal.");
      const ch = t[this.pos];
      if (ch === quote) {
        this.pos++;
        return out;
      }
      if (ch === "\n" || ch === "\r") this.fail("Unterminated string literal.");
      if (ch === "\\") {
        this.pos++;
        out += this.escape(false);
      } else {
        out += ch;
        this.pos++;
      }
    }
  }

  /** Scans a template piece from just after "`" or "}" up to "${" or the closing "`". */
  templatePiece(start: number, nl: boolean): Token {
    const t = this.text;
    let cooked = "";
    const from = this.pos;
    while (true) {
      if (this.pos >= t.length) this.fail("Unterminated template literal.");
      const ch = t[this.pos];
      if (ch === "`") {
        const raw = t.slice(from, this.pos).replace(/\r\n?/g, "\n");
        this.pos++;
        return { type: "template", value: cooked, raw, tail: true, start, end: this.pos, nl };
      }
      if (ch === "$" && t[this.pos + 1] === "{") {
        const raw = t.slice(from, this.pos).replace(/\r\n?/g, "\n");
        this.pos += 2;
        return { type: "template", value: cooked, raw, tail: false, start, end: this.pos, nl };
      }
      if (ch === "\\") {
        this.pos++;
        cooked += this.escape(true);
      } else if (ch === "\r") {
        cooked += "\n";
        this.pos += t[this.pos + 1] === "\n" ? 2 : 1;
      } else {
        cooked += ch;
        this.pos++;
      }
    }
  }

  /** The parser saw `/` or `/=` where an expression starts: scan a regular expression from `start`. */
  regex(start: number, nl: boolean): Token {
    const t = this.text;
    this.pos = start + 1;
    let inClass = false;
    while (true) {
      if (this.pos >= t.length || isLineBreak(t[this.pos])) this.fail("Unterminated regular expression literal.", start);
      const ch = t[this.pos];
      if (ch === "\\") this.pos++;
      else if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) break;
      this.pos++;
    }
    this.pos++;
    while (this.pos < t.length && isIdPart(t[this.pos])) this.pos++;
    return { type: "regex", value: t.slice(start, this.pos), start, end: this.pos, nl };
  }

  /** Joins a `>` token with what directly follows it, where a binary operator can stand. */
  greater(tok: Token): Token {
    const t = this.text;
    for (const p of [">>>=", ">>>", ">>=", ">=", ">>"])
      if (t.startsWith(p, tok.start)) {
        this.pos = tok.start + p.length;
        return { ...tok, value: p, end: this.pos };
      }
    return tok;
  }

  /** A JSX name: a name that may contain `-`, scanned from `tok`, which the scanner read as a plain name. */
  jsxName(tok: Token): Token {
    const t = this.text;
    let end = tok.end;
    while (end < t.length && (t[end] === "-" || isIdPart(t[end]))) end++;
    this.pos = end;
    return { ...tok, value: t.slice(tok.start, end), end };
  }

  /** After a JSX attribute's `=` at `from`: the string value, as the raw text between the quotes with no escapes,
   * or undefined when the value is not a string. */
  jsxStringAfter(from: number): Token | undefined {
    const t = this.text;
    this.pos = from;
    const nl = this.skipTrivia();
    const start = this.pos;
    const quote = t[start];
    if (quote !== '"' && quote !== "'") {
      this.pos = from;
      return undefined;
    }
    const close = t.indexOf(quote, start + 1);
    if (close < 0) this.fail("Unterminated string literal.", start);
    this.pos = close + 1;
    return { type: "string", value: t.slice(start + 1, close), start, end: this.pos, nl };
  }

  /** Scans a JSX child from `pos`: text up to `<` or `{`, or one of those two tokens. */
  jsxChild(): Token {
    const t = this.text;
    const start = this.pos;
    if (start >= t.length) return { type: "eof", value: "", start, end: start, nl: false };
    if (t[start] === "<" || t[start] === "{") {
      this.pos++;
      return { type: "punct", value: t[start], start, end: this.pos, nl: false };
    }
    let i = start;
    while (i < t.length && t[i] !== "<" && t[i] !== "{") {
      if (t[i] === ">") this.fail("Unexpected token. Did you mean `{'>'}` or `&gt;`?", i);
      if (t[i] === "}") this.fail("Unexpected token. Did you mean `{'}'}` or `&rbrace;`?", i);
      i++;
    }
    this.pos = i;
    return { type: "jsxText", value: t.slice(start, i), start, end: i, nl: false };
  }
}

export function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      starts.push(i + 1);
    } else if (ch === "\n" || ch === " " || ch === " ") starts.push(i + 1);
  }
  return starts;
}
