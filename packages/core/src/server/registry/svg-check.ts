// The build's check on a copied SVG. It reads the file as XML, element by element, rather than looking for words, so
// a prefix (`<svg:script>`), an entity (`&#106;avascript:`), a comment inside a tag name or another encoding does not
// get past it. It refuses what can run script or reach outside the file. The asset route's sandboxing CSP stays the
// second wall: this one means a stored copy is inert even where that header is lost.

/** Elements a copied SVG may not have, by local name, lower-cased: script, HTML inside the SVG, animation that can
 * set an attribute (SMIL `set` and `animate*` can write an `href`), and the event elements of SVG Tiny. */
const BANNED = new Set([
  "script",
  "foreignobject",
  "set",
  "animate",
  "animatemotion",
  "animatetransform",
  "animatecolor",
  "discard",
  "handler",
  "listener",
  "iframe",
  "embed",
  "object",
  "frame",
  "frameset",
  "audio",
  "video",
  "canvas",
  "html",
  "body",
  "meta",
  "link",
  "base",
  "form",
]);

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const SPACE = /[ \t\r\n]+/y;

/** A data: address an SVG may point at: a raster image, which can't hold script. */
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i;

class Bad extends Error {}

const localName = (name: string) => (name.includes(":") ? name.slice(name.indexOf(":") + 1) : name).toLowerCase();

/** Turns the five XML entities and character references into text. Any other entity is refused: with no DOCTYPE
 * there is no other, and a reader that defines one is the thing to keep out. */
function decode(text: string): string {
  return text.replace(/&([^;&\s]*);?/g, (whole, body: string) => {
    if (!whole.endsWith(";")) throw new Bad("the SVG has a bare & that is not an entity.");
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[body] !== undefined) return named[body];
    const m = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (!m) throw new Bad(`the SVG uses the entity &${body};, which it does not define.`);
    const code = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10);
    if (!Number.isFinite(code) || code > 0x10ffff) throw new Bad("the SVG has a character reference that is not a character.");
    return String.fromCodePoint(code);
  });
}

/** What an address in the SVG must be: inside the file (`#id`) or a data: raster image. */
function checkTarget(raw: string, where: string): void {
  const target = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (target.startsWith("#") || DATA_IMAGE.test(target)) return;
  const shown = target.length > 60 ? `${target.slice(0, 59)}…` : target;
  throw new Bad(`the SVG points at "${shown}" in ${where}: a copied SVG may only point inside itself or at a data: image.`);
}

/** Every `url(...)` in a value or a style sheet must stay inside the file. */
function checkUrls(value: string, where: string): void {
  for (const m of value.matchAll(/url\s*\(\s*(['"]?)([^'")]*)/gi)) checkTarget(m[2], where);
}

/** A style sheet, from a `<style>` or a `style` attribute: no imports, no escapes that could spell a function's name,
 * and no outside `url()`. */
function checkCss(css: string, where: string): void {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (text.includes("/*")) throw new Bad(`the SVG has an unclosed comment in ${where}.`);
  if (text.includes("\\")) throw new Bad(`the SVG has an escape in ${where}, which can hide what the style loads.`);
  if (/@import/i.test(text)) throw new Bad(`the SVG has an @import in ${where}.`);
  if (/(?:image-set|\bsrc|expression)\s*\(/i.test(text)) throw new Bad(`the SVG loads something in ${where} in a way a copy may not.`);
  checkUrls(text, where);
}

/** The text, if the bytes are UTF-8. UTF-16 (with its byte order mark or its zero bytes) and anything else that is
 * not UTF-8 is refused, since a reader that decodes it another way would see other markup. */
function utf8(bytes: Uint8Array): string {
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) throw new Bad("the SVG is UTF-16, and only UTF-8 SVG is copied.");
  if (bytes.includes(0)) throw new Bad("the SVG has a zero byte in it, so it is not UTF-8 text.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Bad("the SVG is not UTF-8 text.");
  }
  return text.startsWith("﻿") ? text.slice(1) : text;
}

/** Why a copied SVG is refused, or null when it is inert: XML with one `<svg>` root, no element or attribute that
 * runs script, no address that leaves the file, no entity definitions, no processing instruction but the XML
 * declaration, UTF-8 only. */
export function svgProblem(bytes: Uint8Array): string | null {
  try {
    check(utf8(bytes));
    return null;
  } catch (error) {
    if (error instanceof Bad) return error.message;
    throw error;
  }
}

function check(text: string): void {
  const malformed = () => new Bad("the SVG could not be read as XML, so it can't be checked.");
  const stack: string[] = [];
  let css: string | null = null;
  let sawRoot = false;
  let i = 0;

  const content = (raw: string, entities: boolean) => {
    if (!stack.length) {
      if (raw.trim()) throw malformed();
      return;
    }
    const value = entities ? decode(raw) : raw;
    if (css !== null) css += value;
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    content(text.slice(i, lt < 0 ? text.length : lt), true);
    if (lt < 0) break;

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) throw malformed();
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0 || !stack.length) throw malformed();
      content(text.slice(lt + 9, end), false);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) throw malformed();
      const body = text.slice(lt + 2, end);
      const target = /^[^\s?]*/.exec(body)![0];
      if (target !== "xml" || sawRoot || text.slice(0, lt).trim()) throw new Bad(`the SVG has the processing instruction <?${target}>, which can load a style sheet from outside.`);
      const encoding = /encoding\s*=\s*["']([^"']*)["']/i.exec(body)?.[1];
      if (encoding !== undefined && !/^utf-?8$/i.test(encoding)) throw new Bad(`the SVG says it is ${encoding}, and only UTF-8 SVG is copied.`);
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) {
      // A DOCTYPE that only names a public DTD defines nothing. One with an internal subset can define entities.
      const m = /^<!DOCTYPE[ \t\r\n]+[^[\]<>]*>/i.exec(text.slice(lt));
      if (!m || sawRoot) throw new Bad("the SVG has a DOCTYPE that defines entities, or another declaration. Drawing programs sometimes write one: save it again as plain SVG, or use a PNG.");
      i = lt + m[0].length;
      continue;
    }
    if (text.startsWith("</", lt)) {
      NAME.lastIndex = lt + 2;
      const name = NAME.exec(text)?.[0];
      if (!name) throw malformed();
      let at = lt + 2 + name.length;
      SPACE.lastIndex = at;
      if (SPACE.exec(text)) at = SPACE.lastIndex;
      if (text[at] !== ">" || stack.pop() !== name) throw malformed();
      if (localName(name) === "style" && css !== null) {
        checkCss(css, "a <style>");
        css = null;
      }
      i = at + 1;
      continue;
    }

    // An element.
    NAME.lastIndex = lt + 1;
    const name = NAME.exec(text)?.[0];
    if (!name) throw malformed();
    let at = lt + 1 + name.length;
    const local = localName(name);
    if (!sawRoot) {
      if (local !== "svg") throw new Bad(`the file's first element is <${name}>, not <svg>.`);
      sawRoot = true;
    } else if (!stack.length) {
      throw malformed();
    }
    if (BANNED.has(local)) throw new Bad(`the SVG has a <${name}> in it.`);

    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      SPACE.lastIndex = at;
      const spaced = !!SPACE.exec(text);
      if (spaced) at = SPACE.lastIndex;
      if (text.startsWith("/>", at)) {
        selfClosing = true;
        at += 2;
        break;
      }
      if (text[at] === ">") {
        at += 1;
        break;
      }
      if (!spaced) throw malformed();
      NAME.lastIndex = at;
      const attr = NAME.exec(text)?.[0];
      if (!attr || seen.has(attr)) throw malformed();
      seen.add(attr);
      at += attr.length;
      const eq = /[ \t\r\n]*=[ \t\r\n]*(["'])/y;
      eq.lastIndex = at;
      const q = eq.exec(text);
      if (!q) throw malformed();
      at = eq.lastIndex;
      const close = text.indexOf(q[1], at);
      if (close < 0) throw malformed();
      const raw = text.slice(at, close);
      if (raw.includes("<")) throw malformed();
      at = close + 1;
      checkAttribute(name, attr, decode(raw));
    }

    if (!selfClosing) {
      stack.push(name);
      if (local === "style") css = "";
    }
    i = at;
  }
  if (!sawRoot || stack.length) throw malformed();
}

function checkAttribute(element: string, attr: string, value: string): void {
  const local = localName(attr);
  const where = `the ${attr} of a <${element}>`;
  if (local.startsWith("on")) throw new Bad(`the SVG has an event handler attribute (${attr}) in it.`);
  if (local === "base" || attr.toLowerCase() === "xml:base") throw new Bad(`the SVG sets ${attr}, which changes where its addresses point.`);
  if (/javascript:/i.test(value.replace(/[\u0000- \u007f-\u009f]/g, ""))) throw new Bad("the SVG has a javascript: address in it.");
  // A link is followed only when someone clicks it, in a page opened on its own (an <img> follows none), so <a> may
  // point at an http, https or mailto address. Nothing else may leave the file.
  if (local === "href" && localName(element) === "a" && /^(?:https?|mailto):/i.test(value.replace(/[\u0000- \u007f-\u009f]/g, ""))) return;
  if (local === "href" || local === "src") return checkTarget(value, where);
  if (local === "style") return checkCss(value, where);
  checkUrls(value, where);
}
