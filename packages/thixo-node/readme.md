# thixo-node

The local adapters for Thixo. They run on a developer's machine: code is kept in files, data in SQLite, the build runs
in the same process, and the server is a Node HTTP server. An app uses them through `local()` and `claudeCode()` in
its `thixo.config.ts`. The other exports are the parts `local()` is made from.

## `local(options?)`

The adapters an app uses on a developer's machine. Everything is kept under `<project>/.thixo`.

```ts
import { defineConfig } from "thixo";
import { local } from "thixo-node";

export default defineConfig({
  adapters: local(),
});
```

`projectDir` is the app's folder. It defaults to `THIXO_PROJECT_DIR`, or the current folder. `fetchAsset` replaces
the fetch that copies a plugin's outside images at build (default `guardedFetch()`). The result also has a `close()`
that closes the database.

`driver` keeps the data in another database than `.thixo/data.sqlite`. It is any `thixo-sql` driver, so the same app
can run its data on Postgres. Code, the build and the state folder stay local.

```ts
import { postgresDriver } from "thixo-postgres";

adapters: local({ driver: postgresDriver(process.env.DATABASE_URL!) }),
```

## `claudeCode(options?)`

The model for the authoring chat. It runs the local `claude` command, so it needs no API key. It is the same code as `claudeCode` in `thixo-anthropic/node`, re-exported here. Most apps use `anthropic()` from `thixo-anthropic/node` instead, which picks this when there is no key.

```ts
import { claudeCode } from "thixo-node";

model: claudeCode({ model: "sonnet" }),
```

Options: `model` (default `sonnet`), `command` (default `claude`), `timeoutMs` (default 300000) and `extraArgs`.

## `serve(handler, options)`

Serves a web-standard handler on Node. The handler takes a `Request` and returns a `Response`.

```ts
import { serve } from "thixo-node";

const served = await serve((request) => thixo.fetch(request), { port: 3000 });
console.log(served.url);
await served.close();
```

`staticDir` and `staticPrefix` serve a folder of files before the handler is asked. Hostname defaults to `127.0.0.1`.

## Other exports

- `fileCodeAdapter({ dir, projectDir })`: stores plugin code as files. Writes are atomic, and a path outside the
  folder is refused.
- `sqliteDriver(file)`: a driver on `node:sqlite`, for `thixo-sql`.
- `localBuild(compiler?, { fetchAsset? })`: compiles and checks plugins in this process, and fetches the outside files a
  plugin's source loads, for copy at build.
- `guardedFetch(options?)`: that fetch. https on port 443 only; a host that resolves to a loopback, private,
  link-local or metadata address is refused, after every redirect too (at most 3); the connection goes to the address
  that was checked; 10 seconds over every step, the host lookup too, and it stops early when the build's signal
  (`limits.signal`) aborts; at most 4 lookups at once (`maxLookups`); the size and type limits it is given. `resolve`
  and `get` can be replaced, so tests never touch the network. `isPublicAddress(ip)` is its address check.
- `parseClaudeOutput`, `parseReply` and `renderPrompt`: the parts of `claudeCode()` that turn a turn into a prompt and
  the reply back into events.

## Tests

`npm test` runs the suites in `test/` with `node --import tsx --test`.
