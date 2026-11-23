import { defineConfig } from "thixo";
import { local } from "thixo-node";
import { anthropic } from "thixo-anthropic/node";
import { readSession, scopesOf } from "./api/session.js";
import { FORMAT_DTS } from "./lib/format-types.js";

export default defineConfig({
  identity: {
    identify: async (request) => {
      const session = await readSession(request);
      return session && { id: session.userId, scopes: session.scopes, groups: session.groups };
    },
    scopesOf,
  },

  adapters: local(),
  model: anthropic(),

  // A library the implementor chooses to expose (L3). A plugin imports it as `@app/format`; the shell bundle imports
  // the module and hands plugins its exports, wrapped at the boundary.
  libraries: [{ specifier: "@app/format", dts: FORMAT_DTS, module: "./lib/index.tsx" }],

  // Which default plugin fills which slot for a new user (S9). A child slot is named by its path under its parent.
  // plugins/stage-chart is deployed too and is not here: a user can switch to it in the plugin browser.
  layout: {
    contacts: "contacts-list",
    "contact-detail": "contact-detail",
    "contact-detail/contact-notes": "notes",
    companies: "companies-list",
    "company-detail": "account-health",
    deals: "deals-pipeline",
    "deals/deal-card": "lead-score",
    "dashboard-pipeline": "pipeline-totals",
    "dashboard-pinned": "pinned-contacts",
  },
});
