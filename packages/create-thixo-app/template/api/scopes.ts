// The app's scopes, each with the words the registry uses when it describes a plugin to a person.

import { defineScopes } from "thixo/api";

export const scopes = defineScopes({
  "todos.read": "Read todos",
  "todos.write": "Create and change todos",
  "todos.delete": "Delete todos",
});
