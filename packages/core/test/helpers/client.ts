import type { Thixo } from "../../src/server/index.js";

export const ORIGIN = "http://thixo.test";

export async function tokenFor(thixo: Thixo, cookie: string): Promise<string> {
  const response = await thixo.fetch(new Request(`${ORIGIN}/_thixo/token`, { method: "POST", headers: { cookie } }));
  assert(response.status === 200, `token for ${cookie} failed with ${response.status}`);
  return ((await response.json()) as { token: string }).token;
}

export async function call(thixo: Thixo, method: string, path: string, options: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await thixo.fetch(
    new Request(`${ORIGIN}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined, response };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Imports SDK text as a module. */
export async function loadSdk(text: string): Promise<Record<string, (input?: unknown, options?: unknown) => Promise<any>>> {
  return import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
}
