import { defineConfig } from "thixo";
import { local, claudeCode } from "thixo-node";
import { readSession, scopesOf } from "./api/session.js";

export default defineConfig({
  // Thixo does not own login (A8). An identity adapter says who is calling
  // and which scopes they hold. This app writes its own; Thixo also ships
  // adapters for services such as Clerk and Auth0.
  identity: {
    identify: async (request) => {
      const session = await readSession(request);
      return session && { id: session.userId, scopes: session.scopes, groups: session.groups };
    },
    // What an author may do is checked against what they hold now (P3).
    scopesOf,
  },

  // Everything provider-specific is here (X4). Moving to Vercel or AWS
  // changes these lines and nothing else. `local()` keeps code in files and
  // data in SQLite, under .thixo/.
  adapters: local(),

  // Which model runs the authoring agent (U6). This one runs the local
  // `claude` command and needs no key.
  model: claudeCode(),

  // Which default plugins fill which slots for a new user (S9).
  layout: {
    main: "todo-list",
    // A child slot is named by its path under its parent (S13).
    "main/todo-row": "done-badge",
    "todo-detail": "due-dates",
  },
});
