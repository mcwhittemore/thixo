import { defineConfig } from "thixo";
import { local } from "thixo-node";
import { anthropic } from "thixo-anthropic/node";
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

  // The authoring chat's model. With ANTHROPIC_API_KEY it calls the Claude API; with no key, in development, it uses
  // the local `claude` login. In production it needs the key.
  model: anthropic(),

  // Which default plugin fills which slot for a new user.
  layout: {
    main: "hello",
  },
});
