import type { Route } from "./context.js";

interface Compiled {
  route: Route;
  regex: RegExp;
  names: string[];
  weight: number;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(route: Route): Compiled {
  const names: string[] = [];
  let weight = 0;
  const segments = route.path.split("/").map((segment) => {
    if (!segment.includes(":")) return escape(segment);
    weight++;
    let out = "";
    let last = 0;
    for (const m of segment.matchAll(/:([A-Za-z_]\w*)/g)) {
      out += escape(segment.slice(last, m.index)) + "([^/]+?)";
      names.push(m[1]);
      last = m.index + m[0].length;
    }
    return out + escape(segment.slice(last));
  });
  return { route, regex: new RegExp(`^${segments.join("/")}$`), names, weight };
}

export interface Match {
  route: Route;
  params: Record<string, string>;
}

export interface Router {
  match(method: string, pathname: string): Match | null;
}

/** Routes with fewer `:params` win over ones with more, so `/todos/recent` beats `/todos/:id`. Within that, the
 * order given wins. A segment may carry a suffix: `/plugins/:id/:n.js`. */
export function createRouter(routes: Route[]): Router {
  const compiled = routes.map(compile).sort((a, b) => a.weight - b.weight);
  return {
    match(method, pathname) {
      const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
      for (const c of compiled) {
        if (c.route.method !== "ALL" && c.route.method !== method) continue;
        const m = c.regex.exec(path);
        if (!m) continue;
        const params: Record<string, string> = {};
        c.names.forEach((name, i) => {
          try {
            params[name] = decodeURIComponent(m[i + 1]);
          } catch {
            params[name] = m[i + 1];
          }
        });
        return { route: c.route, params };
      }
      return null;
    },
  };
}
