// Sketch. Nothing here runs yet. See ./readme.md.

import { defineConfig } from "tailor";
import { cloudflare } from "tailor-cloudflare";
import { readSession } from "./api/session";

export default defineConfig({
  // Tailor does not own login (A9). The implementor says who is calling and
  // which scopes they hold.
  identity: async (request) => {
    const session = await readSession(request);
    return session && { id: session.userId, scopes: session.scopes };
  },

  // Everything provider-specific is here (X6). Moving to Vercel or AWS
  // changes these lines and nothing else.
  adapters: cloudflare({
    code: "PLUGINS", // an R2 bucket
    data: "DB", // a D1 database
  }),

  // Which default plugins fill which slots for a new user (S10).
  layout: {
    main: "todo-list",
    "todo-detail": ["due-dates"],
  },
});
