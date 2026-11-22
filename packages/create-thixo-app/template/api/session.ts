// The app's own login, standing in for whatever you use. It answers one question for Thixo: who is calling, and which
// scopes do they hold? Pick a user with the `thixo-user` cookie: ana or ben.

import { THIXO_SCOPES } from "thixo";

const everything = ["todos.read", "todos.write", ...Object.keys(THIXO_SCOPES)];

type Session = { userId: string; scopes: string[]; groups: string[] };

const users: Record<string, Session> = {
  ana: {
    userId: "ana",
    scopes: ["todos.read", "todos.write", "thixo.data.read", "thixo.data.write", "thixo.plugins.author", "thixo.plugins.share"],
    groups: ["design"],
  },
  ben: { userId: "ben", scopes: everything, groups: ["ops"] },
};

export async function readSession(request: Request): Promise<Session | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const name = /(?:^|;\s*)thixo-user=([^;]+)/.exec(cookie)?.[1];
  return (name && users[decodeURIComponent(name)]) || null;
}

/** What Thixo checks the author cap against: the scopes a user holds now. */
export function scopesOf(userId: string): string[] | null {
  return users[userId]?.scopes ?? null;
}
