import { endpoint } from "thixo/api";
import { t } from "thixo/schema";

export const hello = endpoint({
  method: "GET",
  path: "/hello",
  scopes: ["hello.read"],
  output: t.object({ message: t.string() }),
  handler: async () => ({ message: "hello from the fixture" }),
});
