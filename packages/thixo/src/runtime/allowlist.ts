// The one list of elements, attributes and style properties a program may use. The compiler reads it to check JSX
// and to write the JSX types; the runtime reads it to check every element as it is made. Browser-safe.

export type AttrKind =
  | "text"
  | "number"
  | "boolean"
  | "token"
  | "link"
  | "load"
  | "event"
  | "style"
  | "class"
  | "key"
  | "svg";

const GLOBAL_ATTRS: Record<string, AttrKind> = {
  key: "key",
  className: "class",
  style: "style",
  title: "text",
  lang: "token",
  dir: "token",
  hidden: "boolean",
  tabIndex: "number",
  role: "token",
  spellCheck: "boolean",
  translate: "token",
};

/** Event props a program may give a raw element. A handler gets plain data, never the event. */
export const EVENTS: readonly string[] = [
  "onClick",
  "onDoubleClick",
  "onChange",
  "onInput",
  "onSubmit",
  "onKeyDown",
  "onKeyUp",
  "onFocus",
  "onBlur",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseDown",
  "onMouseUp",
  "onPointerDown",
  "onPointerUp",
  "onPointerMove",
];

const FORM_FIELD: Record<string, AttrKind> = { disabled: "boolean", name: "token", required: "boolean" };

const HTML: Record<string, Record<string, AttrKind>> = {
  a: { href: "link" },
  abbr: {},
  address: {},
  article: {},
  aside: {},
  b: {},
  bdi: {},
  bdo: {},
  blockquote: {},
  br: {},
  button: { type: "token", disabled: "boolean", value: "text" },
  caption: {},
  cite: {},
  code: {},
  col: { span: "number" },
  colgroup: { span: "number" },
  data: { value: "text" },
  dd: {},
  del: {},
  details: { open: "boolean" },
  dfn: {},
  div: {},
  dl: {},
  dt: {},
  em: {},
  fieldset: { disabled: "boolean" },
  figcaption: {},
  figure: {},
  footer: {},
  form: {},
  h1: {},
  h2: {},
  h3: {},
  h4: {},
  h5: {},
  h6: {},
  header: {},
  hgroup: {},
  hr: {},
  i: {},
  img: { src: "load", alt: "text", width: "number", height: "number", loading: "token", decoding: "token" },
  input: {
    ...FORM_FIELD,
    type: "token",
    value: "text",
    defaultValue: "text",
    checked: "boolean",
    defaultChecked: "boolean",
    placeholder: "text",
    min: "text",
    max: "text",
    step: "text",
    readOnly: "boolean",
    maxLength: "number",
    minLength: "number",
    size: "number",
  },
  ins: {},
  kbd: {},
  label: {},
  legend: {},
  li: { value: "number" },
  main: {},
  mark: {},
  menu: {},
  meter: { value: "number", min: "number", max: "number", low: "number", high: "number", optimum: "number" },
  nav: {},
  ol: { start: "number", reversed: "boolean" },
  optgroup: { label: "text", disabled: "boolean" },
  option: { value: "text", disabled: "boolean", label: "text" },
  output: {},
  p: {},
  pre: {},
  progress: { value: "number", max: "number" },
  q: {},
  rp: {},
  rt: {},
  ruby: {},
  s: {},
  samp: {},
  search: {},
  section: {},
  select: { ...FORM_FIELD, value: "text", defaultValue: "text", multiple: "boolean" },
  small: {},
  span: {},
  strong: {},
  sub: {},
  summary: {},
  sup: {},
  table: {},
  tbody: {},
  td: { colSpan: "number", rowSpan: "number" },
  textarea: {
    ...FORM_FIELD,
    value: "text",
    defaultValue: "text",
    placeholder: "text",
    rows: "number",
    cols: "number",
    readOnly: "boolean",
    maxLength: "number",
  },
  tfoot: {},
  th: { colSpan: "number", rowSpan: "number", scope: "token" },
  thead: {},
  time: { dateTime: "text" },
  tr: {},
  u: {},
  ul: {},
  var: {},
  wbr: {},
};

const SVG_PAINT: Record<string, AttrKind> = {
  fill: "svg",
  stroke: "svg",
  strokeWidth: "svg",
  strokeLinecap: "svg",
  strokeLinejoin: "svg",
  strokeDasharray: "svg",
  strokeDashoffset: "svg",
  strokeOpacity: "svg",
  fillOpacity: "svg",
  fillRule: "svg",
  clipRule: "svg",
  opacity: "svg",
  transform: "svg",
  vectorEffect: "svg",
};

const SVG: Record<string, Record<string, AttrKind>> = {
  svg: { ...SVG_PAINT, viewBox: "svg", width: "svg", height: "svg", preserveAspectRatio: "svg" },
  g: { ...SVG_PAINT },
  path: { ...SVG_PAINT, d: "svg" },
  circle: { ...SVG_PAINT, cx: "svg", cy: "svg", r: "svg" },
  ellipse: { ...SVG_PAINT, cx: "svg", cy: "svg", rx: "svg", ry: "svg" },
  line: { ...SVG_PAINT, x1: "svg", y1: "svg", x2: "svg", y2: "svg" },
  rect: { ...SVG_PAINT, x: "svg", y: "svg", width: "svg", height: "svg", rx: "svg", ry: "svg" },
  polyline: { ...SVG_PAINT, points: "svg" },
  polygon: { ...SVG_PAINT, points: "svg" },
  text: {
    ...SVG_PAINT,
    x: "svg",
    y: "svg",
    dx: "svg",
    dy: "svg",
    textAnchor: "svg",
    dominantBaseline: "svg",
    fontSize: "svg",
    fontFamily: "svg",
    fontWeight: "svg",
  },
  tspan: { ...SVG_PAINT, x: "svg", y: "svg", dx: "svg", dy: "svg", textAnchor: "svg", fontSize: "svg", fontWeight: "svg" },
};

/** Values a `type` attribute may take, by tag. */
export const TOKEN_VALUES: Record<string, Record<string, readonly string[]>> = {
  input: {
    type: [
      "text",
      "number",
      "checkbox",
      "radio",
      "date",
      "time",
      "datetime-local",
      "month",
      "week",
      "email",
      "search",
      "tel",
      "url",
      "color",
      "range",
      "submit",
      "reset",
      "button",
    ],
  },
  button: { type: ["button", "submit", "reset"] },
  img: { loading: ["lazy", "eager"], decoding: ["async", "sync", "auto"] },
  th: { scope: ["row", "col", "rowgroup", "colgroup"] },
  "*": { dir: ["ltr", "rtl", "auto"], translate: ["yes", "no"] },
};

export function isElementAllowed(tag: string): boolean {
  return Object.prototype.hasOwnProperty.call(HTML, tag) || Object.prototype.hasOwnProperty.call(SVG, tag);
}

export function isSvgTag(tag: string): boolean {
  return Object.prototype.hasOwnProperty.call(SVG, tag);
}

/** The kind of an attribute on a tag, or undefined when it is not allowed. */
export function attrKind(tag: string, name: string): AttrKind | undefined {
  const own = Object.prototype.hasOwnProperty.call(HTML, tag) ? HTML[tag] : Object.prototype.hasOwnProperty.call(SVG, tag) ? SVG[tag] : undefined;
  if (!own) return undefined;
  if (Object.prototype.hasOwnProperty.call(own, name)) return own[name];
  if (Object.prototype.hasOwnProperty.call(GLOBAL_ATTRS, name)) return GLOBAL_ATTRS[name];
  if (EVENTS.includes(name)) return "event";
  if (/^aria-[a-z]+$/.test(name)) return "text";
  if (/^data-[a-z][a-z0-9-]*$/.test(name)) return "text";
  return undefined;
}

export function elementTags(): string[] {
  return [...Object.keys(HTML), ...Object.keys(SVG)];
}

/** Every attribute a tag allows, without the aria-* and data-* patterns. */
export function attrsOf(tag: string): Record<string, AttrKind> {
  const own = Object.prototype.hasOwnProperty.call(HTML, tag) ? HTML[tag] : SVG[tag];
  const out: Record<string, AttrKind> = { ...GLOBAL_ATTRS };
  for (const e of EVENTS) out[e] = "event";
  return { ...out, ...own };
}

// ---- Styles ----

/** Properties a style object may set. A number on a length property means pixels. */
const LENGTH_PROPS = [
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginInline",
  "marginBlock",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingInline",
  "paddingBlock",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "gap",
  "rowGap",
  "columnGap",
  "fontSize",
  "letterSpacing",
  "wordSpacing",
  "textIndent",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "outlineWidth",
  "outlineOffset",
  "flexBasis",
];

const UNITLESS_PROPS = ["opacity", "zIndex", "flex", "flexGrow", "flexShrink", "fontWeight", "lineHeight", "order"];

const OTHER_PROPS = [
  "display",
  "position",
  "boxSizing",
  "overflow",
  "overflowX",
  "overflowY",
  "visibility",
  "color",
  "background",
  "backgroundColor",
  "backgroundImage",
  "backgroundSize",
  "backgroundPosition",
  "backgroundRepeat",
  "border",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "borderColor",
  "borderStyle",
  "borderCollapse",
  "outline",
  "outlineColor",
  "outlineStyle",
  "boxShadow",
  "textShadow",
  "fontFamily",
  "fontStyle",
  "fontVariant",
  "textAlign",
  "textDecoration",
  "textTransform",
  "textOverflow",
  "whiteSpace",
  "wordBreak",
  "overflowWrap",
  "verticalAlign",
  "listStyle",
  "listStyleType",
  "cursor",
  "pointerEvents",
  "userSelect",
  "flexDirection",
  "flexWrap",
  "flexFlow",
  "justifyContent",
  "justifyItems",
  "justifySelf",
  "alignItems",
  "alignContent",
  "alignSelf",
  "placeItems",
  "placeContent",
  "gridTemplateColumns",
  "gridTemplateRows",
  "gridTemplateAreas",
  "gridColumn",
  "gridRow",
  "gridArea",
  "gridAutoFlow",
  "gridAutoColumns",
  "gridAutoRows",
  "transform",
  "transformOrigin",
  "transition",
  "transitionProperty",
  "transitionDuration",
  "transitionTimingFunction",
  "transitionDelay",
  "aspectRatio",
  "objectFit",
  "objectPosition",
  "tableLayout",
  "fill",
  "stroke",
  "accentColor",
  "caretColor",
];

export const STYLE_LENGTH = new Set(LENGTH_PROPS);
export const STYLE_UNITLESS = new Set(UNITLESS_PROPS);
export const STYLE_PROPS = new Set([...LENGTH_PROPS, ...UNITLESS_PROPS, ...OTHER_PROPS]);
/** Properties that may hold a Url, written out as `url("...")`. */
export const STYLE_URL_PROPS = new Set(["backgroundImage", "background", "listStyle"]);
/** Values `position` may take. `fixed` is left out: the program's box contains it, and it is still not needed. */
export const POSITION_VALUES = new Set(["static", "relative", "absolute", "sticky"]);
/** Functions a style value may call. */
export const STYLE_FUNCTIONS = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "calc",
  "var",
  "min",
  "max",
  "clamp",
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeat",
  "minmax",
  "fit-content",
  "translate",
  "translatex",
  "translatey",
  "rotate",
  "scale",
  "scalex",
  "scaley",
  "skew",
  "skewx",
  "skewy",
  "cubic-bezier",
  "steps",
]);
/** States a `css()` object may nest. */
export const STYLE_STATES = new Set([
  ":hover",
  ":focus",
  ":focus-visible",
  ":focus-within",
  ":active",
  ":disabled",
  ":checked",
  ":first-child",
  ":last-child",
  ":nth-child(odd)",
  ":nth-child(even)",
  "::placeholder",
]);
export const MEDIA_RE = /^@media [a-z0-9 ():,.\-]+$/;
/** A style string may hold only these characters. No `;`, braces, backslashes or angle brackets. */
export const STYLE_VALUE_RE = /^[a-zA-Z0-9 #%.,()+\-*/'"!_]*$/;
