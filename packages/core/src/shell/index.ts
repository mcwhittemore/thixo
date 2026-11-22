import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

import { setMountedLibraries } from "./shell.js";

export { Shell, useThixo } from "./shell.js";
export type { ShellProps, ThixoValue } from "./shell.js";
export { Slot, boxStyle } from "./slot.js";
export { PluginBrowser, slotPaths } from "./plugin-browser.js";
export { AuthoringChat } from "./authoring-chat.js";
export { ThixoRefused, ThixoCallError } from "../plugin-host/refused.js";
export { slot } from "../slots/index.js";
export type { ContextOf, EmitsOf, SlotEvents, SlotHandle, SlotOptions, SlotProps } from "../slots/index.js";

export interface MountOptions {
  element?: Element | null;
  /** Exposed libraries (L3) by specifier. Every <Shell> without its own `libraries` prop uses these. */
  libraries?: Record<string, Record<string, unknown>>;
}

/** Renders the base app into `#root`. The CLI's browser entry is `mount(App)`, or `mount(App, { libraries })` when
 * the app exposes libraries. */
export function mount(App: React.ComponentType, options?: MountOptions | Element | null): Root {
  const opts: MountOptions = options && typeof (options as Element).nodeType === "number" ? { element: options as Element } : ((options as MountOptions | null) ?? {});
  if (opts.libraries) setMountedLibraries(opts.libraries);
  const target = opts.element ?? document.getElementById("root");
  if (!target) throw new Error("mount: no element with id root");
  const root = createRoot(target);
  root.render(React.createElement(App));
  return root;
}
