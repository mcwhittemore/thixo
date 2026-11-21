// Sketch. Nothing here runs yet. See ./readme.md.

import { defineConfig } from "thixo";
import { cloudflare } from "thixo-cloudflare";
import { anthropic } from "thixo-anthropic";
import { readSession } from "./api/session";

export default defineConfig({
  // Thixo does not own login (A8). An identity adapter says who is calling
  // and which scopes they hold. This app writes its own; Thixo also ships
  // adapters for services such as Clerk and Auth0.
  identity: async (request) => {
    const session = await readSession(request);
    return session && { id: session.userId, scopes: session.scopes };
  },

  // Everything provider-specific is here (X4). Moving to Vercel or AWS
  // changes these lines and nothing else.
  adapters: cloudflare({
    code: "PLUGINS", // an R2 bucket
    data: "DB", // a D1 database
  }),

  // Which model runs the authoring agent (U6).
  model: anthropic(),

  // Which default plugins fill which slots for a new user (S9).
  layout: {
    main: "todo-list",
    "todo-detail": "due-dates",
  },
});
