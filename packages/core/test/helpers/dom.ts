import { Window } from "happy-dom";

/** A DOM for React to render into, installed on globalThis. Import this before react-dom. */
export const window = new Window({ url: "http://thixo.test/" });

const names = [
  "window", "document", "navigator", "location", "history", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLSelectElement", "HTMLButtonElement", "Text", "Event", "KeyboardEvent", "MouseEvent", "FocusEvent", "InputEvent", "PopStateEvent",
  "CustomEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DocumentFragment", "SVGElement",
];
const g = globalThis as Record<string, unknown>;
for (const name of names) {
  if (name === "window") g.window = window;
  else if (name === "navigator") Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  else g[name] = (window as unknown as Record<string, unknown>)[name];
}

/** Runs `fn`, then lets React and pending promises settle. The tests poll with `waitFor` instead of React's act(). */
export async function act(fn: () => unknown): Promise<void> {
  await fn();
  await new Promise((r) => setTimeout(r, 0));
}

export async function waitFor<T>(check: () => T | undefined | null | false, what: string, timeout = 3_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    let value: T | undefined | null | false;
    let failure: unknown;
    try {
      value = check();
    } catch (error) {
      failure = error;
    }
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}${failure ? `: ${String(failure)}` : ""}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

export function setValue(element: Element, value: string): void {
  const proto = element instanceof (window.HTMLTextAreaElement as unknown as typeof HTMLTextAreaElement) ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
}
