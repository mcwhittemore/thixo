# thixo

The core of Thixo: the API layer, the schema, the server, the registry, plugin data, the shell and the plugin host.
It has no provider code. Adapters for storage, the build and the model are passed in from outside.

Install it in an app. Its exports are split by what they are for.

## `thixo`

The config an app passes to the server and the build.

```ts
import { defineConfig } from "thixo";
import { local, claudeCode } from "thixo-node";

export default defineConfig({
  adapters: local(),
  model: claudeCode(),
  layout: { main: "todo-list" },
});
```

Also exported: `THIXO_SCOPES` (the scopes Thixo itself defines, such as `thixo.data.read`) and `IMPLEMENTOR`.

## `thixo/api`

Endpoints, records and scopes. Plugins call these endpoints through the generated SDK.

```ts
import { endpoint, defineScopes, HttpError } from "thixo/api";
import { t } from "thixo/schema";

const scopes = defineScopes({ "todos.read": "Read todos" });

export const getTodo = endpoint({
  method: "GET",
  path: "/todos/:id",
  scopes: ["todos.read"],
  input: t.object({ id: t.string() }),
  output: t.object({ id: t.string(), title: t.string() }),
  handler: async ({ input }) => {
    throw new HttpError(404, `No todo ${input.id}`);
  },
});
```

- `endpoint(options)`: one call the app offers. It names its method, path, scopes, input and output.
- `record(name, options)`: a kind of thing plugins can attach fields to. It names the scopes that read it.
- `defineScopes(words)`: the scopes the app uses, with the words the registry shows a person.
- `HttpError(status, message)`: the error an endpoint throws to answer with a status.
- `collectApp`, `BRAND` and `brandOf`: used by the build to find what an app defines.

## `thixo/schema`

Types for endpoints, records and plugin data. `t` builds them.

```ts
import { t } from "thixo/schema";

const todo = t.object({ id: t.string(), done: t.boolean(), dueOn: t.optional(t.date()) });
```

Also exported: `makeSchema`, `isSchema`, `parseJson` and `serializeJson`, which read and write the JSON form a schema
takes in the build.

## `thixo/slots`

Slots: the places in the app where plugins go.

```ts
import { slot } from "thixo/slots";
import { t } from "thixo/schema";

export const todoDetail = slot.panel({
  name: "todo-detail",
  context: t.object({ todoId: t.string() }),
});
```

`slot.page`, `slot.panel` and `slot.widget` set the size. A slot can list child slots, which a plugin in it may place.

## `thixo/server`

The server side. `createThixo` builds the handler from an app and its config. `recordDeleted` tells Thixo that a record
went, so its annotations go too.

```ts
import { recordDeleted } from "thixo/server";

await db.todos.remove(id);
await recordDeleted("todo", id);
```

Also exported: `signToken` and `verifyToken` (the short-lived tokens the shell sends), `generateSdk`, and the
`Route` and `ServerContext` types.

## `thixo/shell`

The React side of the app. `mount` renders the app into `#root`. The rest are components and hooks an app uses.

```tsx
import { mount, Shell, Slot, useThixo } from "thixo/shell";
import { main } from "./slots.js";

function App() {
  return (
    <Shell>
      <Slot is={main} />
    </Shell>
  );
}

mount(App);
```

- `Shell` provides the context the other parts need.
- `Slot` fills one slot with its plugin. Pass `context` and `on` for the slot's contract.
- `useThixo()` returns the signed-in `user`, the load `status` and an `error`.
- `PluginBrowser` lists the plugins and lets a person use, fork or share one. `AuthoringChat` is the chat that asks for
  a new plugin.

## Plugin modules

Plugin code imports `thixo/plugin`, `thixo/ui`, `thixo/data`, `thixo/schema` and `thixo/services`. They are compiled
with the plugin and are not importable from app code. See [thx](../thx/readme.md).

## Tests

`npm test` builds the package and runs its tests with `node --import tsx --test`.
