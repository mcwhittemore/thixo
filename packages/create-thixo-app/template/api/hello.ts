// The app's API. Each endpoint carries its scopes. Thixo generates the SDK that plugins import from this file, one
// function per endpoint. This starter has one. Add yours here: every file in `api/` is collected.

import { endpoint } from "thixo/api";
import { t } from "thixo/schema";

export const hello = endpoint({
  method: "GET",
  path: "/hello",
  scopes: ["hello.read"],
  output: t.object({ message: t.string(), user: t.string(), at: t.string() }),
  handler: async ({ user }) => ({ message: "Hello from the app's API.", user: user.id, at: new Date().toISOString() }),
});
