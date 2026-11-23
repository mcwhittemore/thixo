// The app's own login, standing in for whatever the implementor uses. The `thixo-user` cookie names one of:
// rita and ravi (sales reps, east and west), mia (sales manager, east), sam (support agent), ada (admin).

import { THIXO_SCOPES } from "thixo";

const data = ["thixo.data.read", "thixo.data.write"];
const author = ["thixo.plugins.author", "thixo.plugins.share"];
const rep = ["contacts.read", "contacts.write", "companies.read", "companies.write", "deals.read", "deals.write", ...data, ...author];

type Session = { userId: string; scopes: string[]; groups: string[] };

const users: Record<string, Session> = {
  rita: { userId: "rita", scopes: rep, groups: ["east"] },
  ravi: { userId: "ravi", scopes: rep, groups: ["west"] },
  mia: { userId: "mia", scopes: [...rep, "deals.close", "finance.read", "thixo.plugins.promote"], groups: ["east"] },
  sam: { userId: "sam", scopes: ["contacts.read", "companies.read", "thixo.data.read"], groups: ["east"] },
  ada: {
    userId: "ada",
    scopes: [...rep, "deals.close", "finance.read", "admin.export", ...Object.keys(THIXO_SCOPES)].filter((s, i, all) => all.indexOf(s) === i),
    groups: ["west"],
  },
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
