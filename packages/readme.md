# Packages

There are no packages yet. This is the plan for what will live here once code is accepted. The package names are not claimed yet. See
[open questions](../docs/08-open-questions.md#name).

| Package | What it owns |
| --- | --- |
| `thixo` | The core: the API layer, the shell and slots, the plugin SDK, the registry, the build checks and the plugin route. No provider code. |
| `thixo-cloudflare` | Adapters for Cloudflare. The first to be built. |
| `thixo-vercel` | Adapters for Vercel. |
| `thixo-aws` | Adapters for AWS. |
| `thixo-anthropic` | A model adapter. Others follow the same interface. |
| `create-thixo-app` | Starts a new app from the todo example. |

What the core exposes, as the todo example imports it:

| Import | For |
| --- | --- |
| `thixo` | `defineConfig` |
| `thixo/api` | `endpoint`, `record`, `defineScopes` |
| `thixo/schema` | `t`, the one way to describe a type, used by the API, slots and plugin data |
| `thixo/shell` | `Shell`, `Slot`, `slot`, `AuthoringChat` |
| `thixo/plugin` | `definePlugin` and the React helpers: `useQuery`, `useCan`, `useAnnotation`, `useStore` |
| `thixo/data` | `store`, `annotate` |
| `thixo/ui` | Default components and design tokens |

Generated for each app:

| Import | From |
| --- | --- |
| `@app/sdk` | The endpoints in `api/` that a plugin requires, and the app's records |
| `@app/sdk/optional` | The same endpoints, imported as optional |
| `@app/slots` | The slots in `app/` |

The adapters are described in [portability](../docs/06-portability.md).
