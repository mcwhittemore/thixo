import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

export { Shell, useThixo } from "./shell.js";
export type { ShellProps, ThixoValue } from "./shell.js";
export { Slot, boxStyle } from "./slot.js";
export { PluginBrowser, slotPaths } from "./plugin-browser.js";
export { AuthoringChat } from "./authoring-chat.js";
export { ThixoRefused, ThixoCallError } from "../plugin-host/refused.js";
export { slot } from "../slots/index.js";
export type { ContextOf, EmitsOf, SlotEvents, SlotHandle, SlotOptions, SlotProps } from "../slots/index.js";

/** Renders the base app into `#root`. The CLI's browser entry is `mount(App)`. */
export function mount(App: React.ComponentType, element?: Element | null): Root {
  const target = element ?? document.getElementById("root");
  if (!target) throw new Error("mount: no element with id root");
  const root = createRoot(target);
  root.render(React.createElement(App));
  return root;
}
