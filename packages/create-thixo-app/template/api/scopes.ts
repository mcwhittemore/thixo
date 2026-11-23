// The app's scopes, each with the words the registry uses when it describes a plugin to a person.

import { defineScopes } from "thixo/api";

export const scopes = defineScopes({
  "hello.read": "Read the hello message",
});
