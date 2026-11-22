import type { UrlMint } from "./convert.js";

const UNITLESS = new Set([
  "opacity", "zIndex", "fontWeight", "lineHeight", "flex", "flexGrow", "flexShrink", "order", "zoom", "gridRow", "gridColumn",
  "gridRowStart", "gridRowEnd", "gridColumnStart", "gridColumnEnd", "columnCount", "orphans", "widows", "tabSize", "aspectRatio",
]);

/** A value that could load something, run something, or break out of its declaration. */
const UNSAFE_VALUE = /[;{}<>\\@]|\/\*|url\s*\(|image-set\s*\(|image\s*\(|expression\s*\(|javascript:|-moz-binding|behavior\s*:/i;

const PROPERTY = /^[a-zA-Z]{1,64}$/;

/** Who may be loaded from a style `url()`: a `Url` the plugin was handed or wrote out, whose address is a data image
 * or a path on the app, or one the build listed in the manifest (L7). */
export interface StyleAddresses {
  rt: UrlMint;
  allowed: Set<string>;
}

function kebab(property: string): string {
  return property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^(webkit|moz|ms)-/, "-$1-");
}

function cssString(text: string): string {
  return `"${text.replace(/[^\w\-./:+=,?&#%~]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

function addressAllowed(address: string, allowed: Set<string>): boolean {
  if (/^data:image\/(png|gif|jpeg|webp|avif);/i.test(address)) return true;
  if (address.startsWith("/") && !address.startsWith("//")) return true;
  return allowed.has(address);
}

/** One style value, as CSS text, or undefined when it is refused. */
export function styleValue(property: string, value: unknown, addresses?: StyleAddresses): string | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return UNITLESS.has(property) || value === 0 ? String(value) : `${value}px`;
  }
  if (addresses && addresses.rt.isUrl(value)) {
    const address = addresses.rt.unwrapUrl(value);
    return addressAllowed(address, addresses.allowed) ? `url(${cssString(address)})` : undefined;
  }
  if (typeof value !== "string" || value.length > 500 || UNSAFE_VALUE.test(value) || /[\u0000-\u001f]/.test(value)) return undefined;
  return value;
}

/** A plugin's style object with every refused property and value dropped. Property names are camelCase CSS. */
export function sanitizeStyle(style: unknown, addresses?: StyleAddresses): Record<string, string> {
  const out: Record<string, string> = {};
  if (style === null || typeof style !== "object" || Array.isArray(style)) return out;
  for (const [property, value] of Object.entries(style as Record<string, unknown>)) {
    if (!PROPERTY.test(property)) continue;
    const v = styleValue(property, value, addresses);
    if (v !== undefined) out[property] = v;
  }
  return out;
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The class that scopes one plugin version's styles. Every rule `css()` makes starts with it, so a rule reaches
 * only elements inside that plugin's box (P8). */
export function scopeClassFor(plugin: string, version: number): string {
  return `thx-p-${plugin.replace(/[^a-zA-Z0-9_-]/g, "_")}-${version}`;
}

/** Collects one plugin version's `css()` rules, each under its scope class. `text()` is the stylesheet. */
export class ScopedStyles {
  readonly scopeClass: string;
  private readonly rules = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly addresses?: StyleAddresses;

  constructor(scopeClass: string, addresses?: StyleAddresses) {
    this.scopeClass = scopeClass;
    this.addresses = addresses;
  }

  /** `css({...})`: a class name for the style object. */
  className(style: unknown): string {
    const clean = sanitizeStyle(style, this.addresses);
    const body = Object.entries(clean)
      .map(([p, v]) => `${kebab(p)}: ${v};`)
      .join(" ");
    const name = `thx-c-${hash(body)}`;
    if (!this.rules.has(name)) {
      this.rules.set(name, `.${this.scopeClass} .${name} { ${body} }`);
      for (const listener of this.listeners) listener();
    }
    return name;
  }

  /** A rule the runtime's own `css()` made for `className` (RuntimeHost.insertStyle). Every selector of that class is
   * put under the scope class too, so the rule reaches only elements inside this plugin's box (P8). The runtime has
   * already checked values and addresses; a rule that selects anything but its own class is dropped. */
  insert(className: string, cssText: string): void {
    if (!/^[a-zA-Z][\w-]*$/.test(className) || this.rules.has(className)) return;
    if (/@import/i.test(cssText)) return;
    const selectors = cssText.replace(/\{[^{}]*\}/g, "{}").match(/[^{}]+(?=\{)/g) ?? [];
    const own = new RegExp(`^\\.${className}(:[a-z-]+(\\([a-z]+\\))?)?$`);
    if (selectors.some((sel) => !sel.trim().startsWith("@media") && !own.test(sel.trim()))) return;
    this.rules.set(className, cssText.split(`.${className}`).join(`.${this.scopeClass} .${className}`));
    for (const listener of this.listeners) listener();
  }

  text(): string {
    return [...this.rules.values()].join("\n");
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
