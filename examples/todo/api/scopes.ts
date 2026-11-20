// Sketch. Nothing here runs yet. See ../readme.md.
//
// The app's scopes, each with the words the registry uses when it describes
// a plugin to a person ("reads todos, deletes todos").

import { defineScopes } from "tailor/api";

export const scopes = defineScopes({
  "todos.read": "Read todos",
  "todos.write": "Create and change todos",
  "todos.delete": "Delete todos",
  "people.read": "See who a todo is assigned to",
});
