// The app's own login, standing in for whatever the implementor uses. It
// answers one question for Thixo: who is calling, and which scopes do they
// hold? Pick a user with the `thixo-user` cookie: ana, ben or cy.

import { THIXO_SCOPES } from "thixo";

const everything = [
  "todos.read",
  "todos.write",
  "todos.delete",
  "people.read",
  ...Object.keys(THIXO_SCOPES),
];

type Session = { userId: string; scopes: string[]; groups: string[] };

const users: Record<string, Session> = {
  ana: {
    userId: "ana",
    scopes: [
      "todos.read",
      "todos.write",
      "people.read",
      "thixo.data.read",
      "thixo.data.write",
      "thixo.plugins.author",
      "thixo.plugins.share",
    ],
    groups: ["design"],
  },
  ben: { userId: "ben", scopes: everything, groups: ["design"] },
  cy: { userId: "cy", scopes: ["todos.read", "thixo.data.read"], groups: ["ops"] },
};

export async function readSession(request: Request): Promise<Session | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const name = /(?:^|;\s*)thixo-user=([^;]+)/.exec(cookie)?.[1];
  return (name && users[decodeURIComponent(name)]) || null;
}

/** What Thixo checks the author cap against (P3): the scopes a user holds now. */
export function scopesOf(userId: string): string[] | null {
  return users[userId]?.scopes ?? null;
}
