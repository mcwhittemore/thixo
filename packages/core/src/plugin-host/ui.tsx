import { useId, type ReactNode } from "react";
import { sanitizeStyle } from "./styles.js";

type Tone = "default" | "muted" | "info" | "success" | "warning" | "danger";
type Gap = "none" | "xs" | "sm" | "md" | "lg";

function cssVar(group: string, name: string): string {
  return `var(--thixo-${group}-${name})`;
}

/** The app's design tokens (S4), as CSS custom properties the shell defines. An implementor restyles every plugin by
 * setting `--thixo-*` on the page. */
export const tokens = {
  color: {
    text: cssVar("color", "text"),
    muted: cssVar("color", "muted"),
    background: cssVar("color", "background"),
    surface: cssVar("color", "surface"),
    border: cssVar("color", "border"),
    accent: cssVar("color", "accent"),
    success: cssVar("color", "success"),
    warning: cssVar("color", "warning"),
    danger: cssVar("color", "danger"),
  },
  space: { xs: cssVar("space", "xs"), sm: cssVar("space", "sm"), md: cssVar("space", "md"), lg: cssVar("space", "lg"), xl: cssVar("space", "xl") },
  radius: { sm: cssVar("radius", "sm"), md: cssVar("radius", "md"), lg: cssVar("radius", "lg") },
  fontSize: { sm: cssVar("font-size", "sm"), md: cssVar("font-size", "md"), lg: cssVar("font-size", "lg"), xl: cssVar("font-size", "xl") },
};

const gapOf = (gap: Gap | undefined) => (gap === "none" ? "0" : cssVar("space", gap ?? "sm"));
const alignOf: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", between: "space-between" };

function call(fn: unknown, ...args: unknown[]): void {
  if (typeof fn === "function") fn(...args);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

const TONES = ["default", "muted", "info", "success", "warning", "danger"] as const;

export interface StackProps {
  direction?: "row" | "column";
  gap?: Gap;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  style?: unknown;
  children?: ReactNode;
}

export function Stack(props: StackProps) {
  return (
    <div
      className="thixo-stack"
      style={{
        display: "flex",
        flexDirection: props.direction === "row" ? "row" : "column",
        gap: gapOf(oneOf<Gap>(props.gap, ["none", "xs", "sm", "md", "lg"], "sm")),
        alignItems: props.align ? alignOf[props.align] : props.direction === "row" ? "center" : undefined,
        justifyContent: props.justify ? alignOf[props.justify] : undefined,
        flexWrap: props.wrap ? "wrap" : undefined,
        ...sanitizeStyle(props.style),
      }}
    >
      {props.children}
    </div>
  );
}

export interface TextProps {
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  weight?: "normal" | "bold";
  style?: unknown;
  children?: ReactNode;
}

export function Text(props: TextProps) {
  const tone = oneOf(props.tone, TONES, "default");
  return (
    <span
      className={`thixo-text thixo-tone-${tone}`}
      style={{
        fontSize: cssVar("font-size", oneOf(props.size, ["sm", "md", "lg"], "md")),
        fontWeight: props.weight === "bold" ? 600 : undefined,
        ...sanitizeStyle(props.style),
      }}
    >
      {props.children}
    </span>
  );
}

export interface ButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  style?: unknown;
  children?: ReactNode;
}

export function Button(props: ButtonProps) {
  const variant = oneOf(props.variant, ["primary", "secondary", "danger"], "secondary");
  return (
    <button
      type="button"
      className={`thixo-button thixo-button-${variant}`}
      disabled={props.disabled === true}
      onClick={() => {
        if (props.disabled !== true) call(props.onClick);
      }}
      style={sanitizeStyle(props.style)}
    >
      {props.children}
    </button>
  );
}

function Field(props: { label?: unknown; id: string; children: ReactNode }) {
  if (typeof props.label !== "string" || props.label === "") return <>{props.children}</>;
  return (
    <span className="thixo-field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
    </span>
  );
}

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: unknown;
}

export function TextInput(props: TextInputProps) {
  const id = useId();
  return (
    <Field label={props.label} id={id}>
      <input
        id={id}
        className="thixo-input"
        type="text"
        value={typeof props.value === "string" ? props.value : ""}
        placeholder={typeof props.placeholder === "string" ? props.placeholder : undefined}
        aria-label={typeof props.label === "string" ? undefined : typeof props.placeholder === "string" ? props.placeholder : undefined}
        disabled={props.disabled === true}
        onChange={(e) => call(props.onChange, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") call(props.onSubmit);
        }}
        style={sanitizeStyle(props.style)}
      />
    </Field>
  );
}

export interface NumberInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  style?: unknown;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function NumberInput(props: NumberInputProps) {
  const id = useId();
  return (
    <Field label={props.label} id={id}>
      <input
        id={id}
        className="thixo-input"
        type="number"
        value={num(props.value) ?? ""}
        min={num(props.min)}
        max={num(props.max)}
        step={num(props.step)}
        disabled={props.disabled === true}
        onChange={(e) => {
          const text = e.currentTarget.value;
          const n = Number(text);
          call(props.onChange, text.trim() === "" || !Number.isFinite(n) ? undefined : n);
        }}
        style={sanitizeStyle(props.style)}
      />
    </Field>
  );
}

function dateText(value: unknown): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export interface DateInputProps {
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
  label?: string;
  disabled?: boolean;
  style?: unknown;
}

export function DateInput(props: DateInputProps) {
  const id = useId();
  return (
    <Field label={props.label} id={id}>
      <input
        id={id}
        className="thixo-input"
        type="date"
        value={dateText(props.value)}
        disabled={props.disabled === true}
        onChange={(e) => {
          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.currentTarget.value);
          call(props.onChange, match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined);
        }}
        style={sanitizeStyle(props.style)}
      />
    </Field>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox(props: CheckboxProps) {
  const id = useId();
  return (
    <span className="thixo-checkbox">
      <input
        id={id}
        type="checkbox"
        checked={props.checked === true}
        disabled={props.disabled === true}
        aria-label={typeof props.label === "string" ? undefined : "Done"}
        onChange={(e) => call(props.onChange, e.currentTarget.checked)}
      />
      {typeof props.label === "string" && <label htmlFor={id}>{props.label}</label>}
    </span>
  );
}

export interface SelectProps {
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: unknown;
}

export function Select(props: SelectProps) {
  const id = useId();
  const options = Array.isArray(props.options) ? props.options.filter((o) => o && typeof o.value === "string") : [];
  return (
    <Field label={props.label} id={id}>
      <select
        id={id}
        className="thixo-input"
        value={typeof props.value === "string" ? props.value : ""}
        disabled={props.disabled === true}
        onChange={(e) => call(props.onChange, e.currentTarget.value)}
        style={sanitizeStyle(props.style)}
      >
        <option value="" disabled>
          {typeof props.placeholder === "string" ? props.placeholder : "Choose"}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {String(o.label ?? o.value)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface BadgeProps {
  tone?: Tone;
  style?: unknown;
  children?: ReactNode;
}

export function Badge(props: BadgeProps) {
  return (
    <span className={`thixo-badge thixo-tone-${oneOf(props.tone, TONES, "default")}`} style={sanitizeStyle(props.style)}>
      {props.children}
    </span>
  );
}

export interface CardProps {
  title?: string;
  style?: unknown;
  children?: ReactNode;
}

export function Card(props: CardProps) {
  return (
    <section className="thixo-card" style={sanitizeStyle(props.style)} aria-label={typeof props.title === "string" ? props.title : undefined}>
      {typeof props.title === "string" && <h3 className="thixo-card-title">{props.title}</h3>}
      {props.children}
    </section>
  );
}

export const UI_COMPONENTS = { Stack, Text, Button, TextInput, NumberInput, DateInput, Checkbox, Select, Badge, Card };
