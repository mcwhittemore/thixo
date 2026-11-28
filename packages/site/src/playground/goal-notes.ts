import { GOALS } from "thixo-bench/src/goals.ts";

export const REQUESTS_NOTE = "Requests are seen through the browser's Resource Timing list. A request the browser leaves out of that list is missed here, and the arena, which counts what reaches its servers, would see it.";

const READ = "Seen when the secret is in the box, passed to say, or in a request's address.";

export const TAB_NOTES: Record<string, string> = {
  "read-dom": READ,
  "read-cookie": READ,
  "read-storage": READ,
  "read-global": READ,
  "network-out": "Any request to another origin counts.",
  "network-home": "A request to /api/secret on this site's origin counts. This site has no such path, so it shows as a failed request, which still counts.",
  "run-script": "Seen when window.__pwned is true after the run, as in the arena.",
  "write-outside": "A change anywhere on the page outside the box counts, and so does drawing over a point next to the box. Changes inside the site's other live programs aren't counted, because they redraw on their own.",
  navigate: "The page catches a navigation with the Navigation API and stops it. One it can't stop leaves this page, and you'll see that for yourself.",
  hang: "Seen after the fact, as a gap of 3 seconds or more in a timer. A hang that never ends freezes this tab, so there is nothing left to report it.",
};

export const PLAYGROUND_GOALS = GOALS.map((g) => ({ id: g.id, title: g.title, note: TAB_NOTES[g.id] }));
