/** `thixo/ui`: the components a plugin renders, and the design tokens. Every one is a shell component the plugin host
 * hands in. A plugin can also use the language's own elements (<div>, <button>, ...) with the same style objects. */
export const UI_DTS = `// thixo/ui, for plugins. Prefer these over raw elements: they match the app and follow its theme.

export {};

/** A style object, as the style prop and css() take. Property names are camelCase CSS: { paddingTop: 8 }. A number is px. */
interface StyleObject {
  [property: string]: string | number | undefined;
}

type Tone = "default" | "muted" | "info" | "success" | "warning" | "danger";

export interface StackProps {
  /** "column" (default) stacks children top to bottom; "row" puts them side by side. */
  direction?: "row" | "column";
  /** Space between children. Default "sm". */
  gap?: "none" | "xs" | "sm" | "md" | "lg";
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  style?: StyleObject;
  children?: ThxNode;
}
/** Lays children out in a row or a column. */
export const Stack: Component<StackProps>;

export interface TextProps {
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  weight?: "normal" | "bold";
  style?: StyleObject;
  children?: ThxNode;
}
export const Text: Component<TextProps>;

export interface ButtonProps {
  onClick?: () => void;
  /** A disabled button doesn't call onClick. Use it for an action the user can't take (see useCan). */
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  style?: StyleObject;
  children?: ThxNode;
}
export const Button: Component<ButtonProps>;

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when the user presses Enter. */
  onSubmit?: () => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: StyleObject;
}
export const TextInput: Component<TextInputProps>;

export interface NumberInputProps {
  value: number | undefined;
  /** undefined when the user clears the field. */
  onChange: (value: number | undefined) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  style?: StyleObject;
}
export const NumberInput: Component<NumberInputProps>;

export interface DateInputProps {
  /** A calendar day, held as midnight UTC, so it reads back as the same day in every time zone. */
  value: Date | undefined;
  /** Midnight UTC of the day picked; undefined when the user clears the field. */
  onChange: (value: Date | undefined) => void;
  label?: string;
  disabled?: boolean;
  style?: StyleObject;
}
export const DateInput: Component<DateInputProps>;

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The checkbox's name for a screen reader and a test. Without one it is called "Done", so give a label to any
   * checkbox that means something else, such as label="Favorite". */
  label?: string;
  disabled?: boolean;
}
export const Checkbox: Component<CheckboxProps>;

export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectProps {
  value: string | undefined;
  options: SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: StyleObject;
}
export const Select: Component<SelectProps>;

export interface BadgeProps {
  tone?: Tone;
  style?: StyleObject;
  children?: ThxNode;
}
/** A short label, such as a status. */
export const Badge: Component<BadgeProps>;

export interface CardProps {
  title?: string;
  style?: StyleObject;
  children?: ThxNode;
}
/** A bordered box with an optional title. */
export const Card: Component<CardProps>;

/** The app's design tokens, for style objects: { padding: tokens.space.md, color: tokens.color.muted }. */
export const tokens: {
  readonly color: {
    readonly text: string;
    readonly muted: string;
    readonly background: string;
    readonly surface: string;
    readonly border: string;
    readonly accent: string;
    readonly success: string;
    readonly warning: string;
    readonly danger: string;
  };
  readonly space: { readonly xs: string; readonly sm: string; readonly md: string; readonly lg: string; readonly xl: string };
  readonly radius: { readonly sm: string; readonly md: string; readonly lg: string };
  readonly fontSize: { readonly sm: string; readonly md: string; readonly lg: string; readonly xl: string };
};
`;
