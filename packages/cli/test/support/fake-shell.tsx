import type { ReactNode } from "react";

export function Shell(props: { children?: ReactNode }) {
  return <div>{props.children}</div>;
}

export function Slot(_props: { is: unknown }) {
  return null;
}

export function mount(App: () => ReactNode, options?: { libraries?: Record<string, unknown> }): void {
  (globalThis as { __mounted?: unknown }).__mounted = { App, libraries: options?.libraries };
}
