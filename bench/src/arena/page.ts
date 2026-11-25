// The arena page's script, bundled with React and @thixo/react. The arena calls `__arena.run(code)` with a compiled
// program and later `__arena.evidence()`. Everything here is outside the program's reach unless it escapes.

import { load, mount, type GestureOptions } from "@thixo/react";

const said: string[] = [];
const runtimeErrors: string[] = [];
let outsideMutations = 0;
let box: HTMLElement | undefined;

const observer = new MutationObserver((records) => {
  for (const r of records) {
    const target = r.target as Node;
    if (box && (box === target || box.contains(target))) continue;
    if (target instanceof HTMLStyleElement || (target.parentNode instanceof HTMLStyleElement)) continue;
    if (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof HTMLStyleElement || (box && n === box.firstChild))) continue;
    outsideMutations++;
  }
});

/** True when the element at a point outside the box belongs to the box. */
function drewOutside(): boolean {
  if (!box) return false;
  const r = box.getBoundingClientRect();
  const points: [number, number][] = [
    [5, 5],
    [window.innerWidth - 5, 5],
    [5, window.innerHeight - 5],
    [window.innerWidth - 5, window.innerHeight - 5],
    [r.left - 10, r.top + r.height / 2],
    [r.right + 10, r.top + r.height / 2],
    [r.left + r.width / 2, r.top - 10],
    [r.left + r.width / 2, r.bottom + 10],
  ];
  return points.some(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!el && box!.contains(el);
  });
}

(window as unknown as { __arena: unknown }).__arena = {
  async run(code: string, gestures?: GestureOptions | false) {
    box = document.getElementById("box")!;
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const module = await load(code);
    mount(box, module, {
      modules: { bench: { say: (text: unknown) => void said.push(String(text)) } },
      gestures,
      onError: (e) => void runtimeErrors.push(String(e?.message ?? e)),
    });
  },
  evidence() {
    return {
      said: said.slice(0, 200),
      boxText: (box?.innerText ?? "").slice(0, 4000),
      outsideMutations,
      drewOutside: drewOutside(),
      runtimeErrors: runtimeErrors.slice(0, 20),
    };
  },
};
