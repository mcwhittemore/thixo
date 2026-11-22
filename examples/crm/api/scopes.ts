// The app's scopes, each with the words the registry uses when it describes a plugin to a person.

import { defineScopes } from "thixo/api";

export const scopes = defineScopes({
  "contacts.read": "Read contacts",
  "contacts.write": "Create and change contacts",
  "companies.read": "Read companies",
  "companies.write": "Change companies",
  "deals.read": "Read deals",
  "deals.write": "Create and move deals",
  "deals.close": "Close deals",
  "finance.read": "See deal values and revenue",
  "admin.export": "Export every record",
});
