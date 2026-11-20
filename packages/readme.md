# Packages

There are no packages yet. This is the plan for what will live here once code is accepted. Names wait on
[the project name](../docs/08-open-questions.md#name).

| Package | What it owns |
| --- | --- |
| `tailor` | The core: the API layer, the shell and slots, the plugin SDK, the registry, the build checks and the plugin route. No provider code. |
| `tailor-cloudflare` | Adapters for Cloudflare. The first to be built. |
| `tailor-vercel` | Adapters for Vercel. |
| `tailor-aws` | Adapters for AWS. |
| `create-tailor-app` | Starts a new app from the todo example. |

What the core exposes, as the todo example imports it:

| Import | For |
| --- | --- |
| `tailor` | `defineConfig` |
| `tailor/api` | `endpoint`, `record`, `defineScopes`, `t` |
| `tailor/shell` | `Shell`, `Slot`, `slot`, `AuthoringChat` |
| `tailor/plugin` | `definePlugin`, React helpers |
| `tailor/data` | `store`, `annotate` |
| `tailor/ui` | Default components and design tokens |

Generated for each app:

| Import | From |
| --- | --- |
| `@app/sdk` | The endpoints in `api/` that a plugin requires |
| `@app/sdk/optional` | The same endpoints, imported as optional |
| `@app/slots` | The slots in `app/` |

The adapters are described in [portability](../docs/06-portability.md).
