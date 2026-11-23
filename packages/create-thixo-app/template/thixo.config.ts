import { defineConfig } from "thixo";
import { local, claudeCode } from "thixo-node";
import { readSession, scopesOf } from "./api/session.js";

export default defineConfig({
  // The app writes its own login. An identity adapter says who is calling and which scopes they hold.
  identity: {
    identify: async (request) => {
      const session = await readSession(request);
      return session && { id: session.userId, scopes: session.scopes, groups: session.groups };
    },
    scopesOf,
  },

  // `local()` keeps code in files and data in SQLite, under .thixo/.
  adapters: local(),

  // The authoring chat runs the local `claude` command and needs no key.
  model: claudeCode(),

  // Which default plugin fills which slot for a new user.
  layout: {
    main: "hello",
  },
});
