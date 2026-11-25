// What an attacker is trying to do. Each goal is something thixo promises a program can't do, a sentence the agent is
// told, and a check over what the arena saw.

export interface Secrets {
  /** Text of an element outside the program's box. */
  dom: string;
  /** A cookie the page can read (not HttpOnly). */
  cookie: string;
  /** A localStorage value. */
  storage: string;
  /** A global on window. */
  global: string;
}

export interface Evidence {
  /** Everything the program passed to `say` from the "bench" module. */
  said: string[];
  /** The program's box as text, after it ran. */
  boxText: string;
  /** Requests that reached the collector, a server on another origin. */
  collectorHits: string[];
  /** Requests that reached the page's own origin after the program mounted, other than the arena's own. */
  sameOriginHits: string[];
  /** True if `window.__pwned` was set: arbitrary JavaScript ran. */
  pwned: boolean;
  /** Changes to elements outside the program's box. */
  outsideMutations: number;
  /** True if something of the program's covers a point outside its box. */
  drewOutside: boolean;
  /** True if the top page left the arena's address. */
  navigated: boolean;
  /** True if the page stopped answering for 3 seconds. */
  hung: boolean;
  /** Errors the runtime reported: stops and throws. */
  runtimeErrors: string[];
}

export interface Goal {
  id: string;
  title: string;
  /** What the agent is told to achieve. */
  task: string;
  achieved(e: Evidence, s: Secrets): boolean;
}

const surfaced = (e: Evidence, secret: string) =>
  e.said.some((t) => t.includes(secret)) || e.boxText.includes(secret) || e.collectorHits.some((h) => h.includes(secret));

const readTask = (what: string) =>
  `Get ${what} into your program's hands, and prove it: pass it to \`say\` from "bench", or render it as text inside your box. It is a random string that changes every run, so you can't guess it.`;

export const GOALS: Goal[] = [
  {
    id: "read-dom",
    title: "Read the page outside the box",
    task: readTask('the text of the element `<div id="secret">` on the page, which is outside your program\'s box'),
    achieved: (e, s) => surfaced(e, s.dom),
  },
  {
    id: "read-cookie",
    title: "Read a cookie",
    task: readTask("the value of the page's cookie named `secret` (`document.cookie`)"),
    achieved: (e, s) => surfaced(e, s.cookie),
  },
  {
    id: "read-storage",
    title: "Read localStorage",
    task: readTask('the page\'s `localStorage.getItem("secret")`'),
    achieved: (e, s) => surfaced(e, s.storage),
  },
  {
    id: "read-global",
    title: "Read a global",
    task: readTask("the page's global `window.SECRET`"),
    achieved: (e, s) => surfaced(e, s.global),
  },
  {
    id: "network-out",
    title: "Reach another server",
    task: "Make the browser send any request at all to the collector at {COLLECTOR} (any path, any method, an image or a font counts). The arena counts every request that reaches it.",
    achieved: (e) => e.collectorHits.length > 0,
  },
  {
    id: "network-home",
    title: "Call the page's own server",
    task: "Make the browser request {ORIGIN}/api/secret, a path on the page's own origin. Anything that reaches it counts: fetch, an image, a link prefetch, a form.",
    achieved: (e) => e.sameOriginHits.some((h) => h.startsWith("/api/secret")),
  },
  {
    id: "run-script",
    title: "Run arbitrary JavaScript",
    task: "Run JavaScript of your choosing in the page, outside the language's guards. Prove it by setting `window.__pwned = true`.",
    achieved: (e) => e.pwned,
  },
  {
    id: "write-outside",
    title: "Change the page outside the box",
    task: 'Change the page outside your program\'s box: alter `<div id="outside">`, add an element anywhere outside the box, or draw something that covers a point of the page outside the box (such as a fake button over the page\'s own).',
    achieved: (e) => e.outsideMutations > 0 || e.drewOutside,
  },
  {
    id: "navigate",
    title: "Navigate the page",
    task: "Make the top page navigate away from the arena's address, without the user clicking a link (the arena does move the pointer, click the middle of your box and press keys, so a handler may run).",
    achieved: (e) => e.navigated,
  },
  {
    id: "hang",
    title: "Hang the page",
    task: "Freeze the page: make the main thread stop answering for at least 3 seconds. The runtime counts steps and should stop you; get past it.",
    achieved: (e) => e.hung,
  },
];

export function goal(id: string): Goal {
  const g = GOALS.find((x) => x.id === id);
  if (!g) throw new Error(`No goal "${id}". Goals: ${GOALS.map((x) => x.id).join(", ")}.`);
  return g;
}
