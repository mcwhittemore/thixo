# Packages

An npm workspace. `npm run build` at the root builds them in dependency order (`tsc -b`), and `npm test` runs each
one's tests. [docs/10](../docs/10-implementation.md) is the build spec; `thx/src/contract.ts` and
`core/src/contract.ts` are the contract between packages.

| Folder | npm name | What it owns | State |
| --- | --- | --- | --- |
| `thx` | `thixo-thx` | The plugin language, thx: compiler, output verifier, in-page runtime. The wall. | Built |
| `core` | `thixo` | `thixo`, `thixo/api`, `thixo/schema`, `thixo/slots`, `thixo/server` (API, token, registry, plugin data, layouts, deploy, authoring agent), `thixo/shell` (shell, slots, broker, plugin host, `thixo/ui`). No provider code. | Built |
| `thixo-sql` | `thixo-sql` | The data adapter, on a small SQL driver interface. See [its readme](thixo-sql/readme.md). | Built, run on SQLite only |
| `thixo-node` | `thixo-node` | Local adapters: `local()` (files for code, `node:sqlite` for data, an in-process build), `serve()`, and `claudeCode()`, a model adapter on the local `claude` command. | Built |
| `thixo-anthropic` | `thixo-anthropic` | The model adapter for the Claude API. | Built, tested against a local fake of the API |
| `cli` | `thixo-cli` | The `thixo` command: dev, build, start, compile, new plugin, agent, registry list, release, authoring. | Built |
| `create-thixo-app` | `create-thixo-app` | Starts a new app from the todo example. | Not written |
| `thixo-cloudflare`, `thixo-vercel`, `thixo-aws` | | Adapters for each cloud. | Not written |

What the core exposes, as the todo example imports it:

| Import | For |
| --- | --- |
| `thixo` | `defineConfig` |
| `thixo/api` | `endpoint`, `record`, `defineScopes` |
| `thixo/schema` | `t`, the one way to describe a type, used by the API, slots and plugin data |
| `thixo/shell` | `Shell`, `Slot`, `slot`, `AuthoringChat`, `PluginBrowser`, `useThixo`, `mount` |
| `thixo/plugin` | `definePlugin`, the hooks (`useState`, `useMemo`, `useEffect`, `useQuery`, `useCan`, `useAnnotation`, `useAnnotations`, `useStore`, `useStoreList`), `ChildSlot`, `css`. For plugins, which are written in thx |
| `thixo/data` | `store`, `annotate` (plugins) |
| `thixo/services` | `navigate`, `openModal`, `copyToClipboard`, `download`, `toast` (plugins) |
| `thixo/ui` | Default components and design tokens (plugins) |

Generated for each app:

| Import | From |
| --- | --- |
| `@app/sdk` | The endpoints in `api/` that a plugin requires, and the app's records |
| `@app/sdk/optional` | The same endpoints, imported as optional |
| `@app/slots` | The slots in `app/` |

The adapters are described in [portability](../docs/07-portability.md).
