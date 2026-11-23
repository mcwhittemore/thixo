import type { ThixoConfig } from "../../src/contract.js";
import { createThixo, type AuthoringEvent, type Thixo } from "../../src/server/index.js";
import { tokenFor } from "./client.js";
import { USERS, app, fakeBuild, memoryCode, memoryData } from "./registry-doubles.js";

export type AuthoringOptions = Partial<Pick<ThixoConfig, "model" | "agentKey" | "authoring" | "authoringGuard">> & {
  /** Share a data adapter between worlds, as a server restarted on the same database would. */
  data?: ReturnType<typeof memoryData>;
};

/** The registry test world, with the authoring settings a test chooses. */
export function authoringWorld({ data, ...options }: AuthoringOptions = {}) {
  const users = structuredClone(USERS);
  const adapters = { code: memoryCode(), data: data ?? memoryData(), build: fakeBuild() };
  const thixo: Thixo = createThixo(app, {
    identity: { identify: (request) => users[request.headers.get("cookie") ?? ""] ?? null, scopesOf: (id) => users[id]?.scopes ?? null },
    adapters,
    layout: {},
    signingKey: "test-key",
    ...options,
  });
  return { thixo, adapters, users, token: (user: string) => tokenFor(thixo, user) };
}

export async function ndjson(response: Response): Promise<AuthoringEvent[]> {
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as AuthoringEvent);
}
