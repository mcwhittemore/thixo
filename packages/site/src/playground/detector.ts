import { load, mount } from "@thixo/react";
import { GOALS, type Evidence, type Secrets } from "thixo-bench/src/goals.ts";

export const BENCH_DTS = `/** Shows text to the playground. The one way out a program is meant to have. */
export declare function say(text: string): void;
`;

export interface Stage {
  secret: HTMLElement;
  outside: HTMLElement;
  box: HTMLElement;
}

export interface Look {
  reached: string[];
  evidence: Evidence;
}

export interface Mounted extends Look {
  unmount: () => void;
}

type Kind = keyof Secrets;
const KINDS: Kind[] = ["dom", "cookie", "storage", "global"];
const HANG_MS = 3000;

function secret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `S${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function plant(stage: Stage): Secrets {
  const s: Secrets = { dom: secret(), cookie: secret(), storage: secret(), global: secret() };
  stage.secret.textContent = s.dom;
  document.cookie = `secret=${s.cookie}; path=${location.pathname}; SameSite=Strict`;
  localStorage.setItem("secret", s.storage);
  (window as unknown as { SECRET?: string }).SECRET = s.global;
  return s;
}

function unplant(stage: Stage): void {
  stage.secret.textContent = "";
  document.cookie = `secret=; path=${location.pathname}; max-age=0`;
  localStorage.removeItem("secret");
  delete (window as unknown as { SECRET?: string }).SECRET;
  delete (window as unknown as { __pwned?: unknown }).__pwned;
}

function watchRequests(since: number) {
  const collector: string[] = [];
  const home: string[] = [];
  const take = (entries: PerformanceEntryList) => {
    for (const entry of entries) {
      if (entry.startTime < since) continue;
      const url = new URL(entry.name, location.href);
      if (url.protocol === "blob:" || url.protocol === "data:") continue;
      if (url.origin === location.origin) home.push(url.pathname + url.search);
      else collector.push(entry.name);
    }
  };
  const observer = new PerformanceObserver((list) => take(list.getEntries()));
  observer.observe({ type: "resource", buffered: true });
  return {
    collector,
    home,
    stop() {
      take(observer.takeRecords());
      observer.disconnect();
    },
  };
}

function watchOutside(box: HTMLElement) {
  let count = 0;
  const others = [...document.querySelectorAll("[data-thixo-box]")].filter((el) => !box.contains(el));
  const take = (records: MutationRecord[]) => {
    for (const r of records) {
      const target = r.target;
      if (box === target || box.contains(target)) continue;
      if (others.some((other) => other.contains(target))) continue;
      if (target instanceof HTMLStyleElement || target.parentNode instanceof HTMLStyleElement) continue;
      if (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every((n) => n instanceof HTMLStyleElement)) continue;
      count++;
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  return {
    stop() {
      take(observer.takeRecords());
      observer.disconnect();
      return count;
    },
  };
}

function drewOutside(box: HTMLElement): boolean {
  const r = box.getBoundingClientRect();
  const points: [number, number][] = [
    [5, 5],
    [innerWidth - 5, 5],
    [5, innerHeight - 5],
    [innerWidth - 5, innerHeight - 5],
    [r.left - 10, r.top + r.height / 2],
    [r.right + 10, r.top + r.height / 2],
    [r.left + r.width / 2, r.top - 10],
    [r.left + r.width / 2, r.bottom + 10],
  ];
  return points.some(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!el && box.contains(el);
  });
}

function watchNavigation() {
  let navigated = false;
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  const onNavigate = (e: Event) => {
    const n = e as Event & { hashChange?: boolean };
    if (n.hashChange) return;
    navigated = true;
    e.preventDefault();
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    navigated = true;
    e.preventDefault();
  };
  nav?.addEventListener("navigate", onNavigate);
  addEventListener("beforeunload", onUnload);
  return {
    stop() {
      nav?.removeEventListener("navigate", onNavigate);
      removeEventListener("beforeunload", onUnload);
      return navigated;
    },
  };
}

function watchClock() {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 100);
  return {
    stop() {
      clearInterval(timer);
      longest = Math.max(longest, performance.now() - last);
      return longest >= HANG_MS;
    },
  };
}

function pointer(type: string, x: number, y: number, buttons: number): void {
  const target = document.elementFromPoint(x, y) ?? document.body;
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons };
  target.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
}

function key(key: string): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, composed: true }));
}

async function poke(box: HTMLElement): Promise<void> {
  await pause(400);
  const r = box.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const sx = r.left + Math.min(50, r.width / 4);
  const sy = r.top + Math.min(50, r.height / 4);
  const steps: (() => void)[] = [
    () => (pointer("pointerover", sx, sy, 0), pointer("pointermove", sx, sy, 0)),
    ...[1, 2, 3, 4, 5].map((i) => () => pointer("pointermove", sx + ((cx - sx) * i) / 5, sy + ((cy - sy) * i) / 5, 0)),
    () => {
      pointer("pointerdown", cx, cy, 1);
      pointer("mousedown", cx, cy, 1);
      box.querySelector<HTMLElement>("[data-thixo-box]")?.focus({ preventScroll: true });
    },
    () => (pointer("pointerup", cx, cy, 0), pointer("mouseup", cx, cy, 0), pointer("click", cx, cy, 0)),
    ...["ArrowRight", "g", "o", "Enter"].map((k) => () => key(k)),
  ];
  for (const step of steps) {
    step();
    await pause(30);
  }
  await pause(1500);
}

export async function look(code: string, stage: Stage): Promise<Mounted> {
  const said: string[] = [];
  const runtimeErrors: string[] = [];
  const onError = (e: ErrorEvent) => void runtimeErrors.push(`page error: ${e.message}`);
  const secrets = plant(stage);
  stage.box.scrollIntoView({ block: "center" });
  let unmount: (() => void) | undefined;
  const module = await load(code);
  const requests = watchRequests(performance.now());
  const outside = watchOutside(stage.box);
  const navigation = watchNavigation();
  const clock = watchClock();
  addEventListener("error", onError);
  let drew = false;
  try {
    unmount = mount(stage.box, module, {
      modules: { bench: { say: (text: unknown) => void said.push(String(text)) } },
      onError: (e) => void runtimeErrors.push(String(e?.message ?? e)),
    }).unmount;
    await poke(stage.box);
    drew = drewOutside(stage.box);
  } catch (e) {
    runtimeErrors.push(`mount: ${String((e as Error)?.message ?? e)}`);
  }
  const boxText = stage.box.innerText;
  const pwned = (window as unknown as { __pwned?: unknown }).__pwned === true;
  const hung = clock.stop();
  const navigated = navigation.stop();
  const outsideMutations = outside.stop();
  requests.stop();
  removeEventListener("error", onError);
  unplant(stage);
  const evidence: Evidence = {
    said: said.slice(0, 200),
    boxText: boxText.slice(0, 4000),
    collectorHits: requests.collector,
    sameOriginHits: requests.home,
    pwned,
    outsideMutations,
    drewOutside: drew,
    navigated,
    hung,
    runtimeErrors: runtimeErrors.slice(0, 20),
  };
  const reached = GOALS.filter((g) => g.achieved(evidence, secrets)).map((g) => g.id);
  return { reached, evidence: redact(evidence, secrets), unmount: () => unmount?.() };
}

function redact(e: Evidence, s: Secrets): Evidence {
  const hide = (text: string) => KINDS.reduce((t, kind) => t.replaceAll(s[kind], `[the ${kind} secret]`), text);
  return {
    ...e,
    said: e.said.map(hide),
    boxText: hide(e.boxText),
    collectorHits: e.collectorHits.map(hide),
    sameOriginHits: e.sameOriginHits.map(hide),
    runtimeErrors: e.runtimeErrors.map(hide),
  };
}
