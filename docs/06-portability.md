# Portability

An implementor must not be locked into a cloud provider (X1). The first proof of concept runs on Cloudflare (X3).
Vercel and AWS must be supported (X4).

Those three points are decided. How to meet them is proposed below.

## The approach

1. **One core on web standards (X5).** Every server part of Thixo is a function from a `Request` to a `Response`.
   Cloudflare Workers and Vercel Functions run that shape directly. AWS Lambda runs it behind a thin wrapper.
2. **Adapters for everything provider-specific (X6).** The core never imports a provider's SDK.
3. **The smallest interface that works on all three (X7).** If one provider can't support an adapter method, the
   method doesn't exist.

## The adapters

| Adapter | What it does | Why it is pluggable |
| --- | --- | --- |
| **Code** | Stores and reads plugin source and built bundles. | Required by X2. Each provider has its own object storage. |
| **Data** | Holds registry records, layouts, stores and annotations. | Each provider has a different database. |
| **Build** | Turns stored source into a checked bundle and a manifest. | Bundling has limits that differ by runtime. |
| **Model** | Runs the authoring agent's model calls. | The implementor chooses the model (U10). |

Identity is not an adapter. It is a function the implementor writes (A9).

The interfaces below show the intended size of each adapter. They are not complete.

### Code

Versions are immutable (U2), so the interface is small:

```ts
interface CodeAdapter {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}
```

Keys are derived from the content, so a version can't be overwritten. Listing versions is a registry query against
the data adapter, not an object-storage listing.

### Data

The interface is a document store, not SQL, so key-value and relational databases both fit:

```ts
interface DataAdapter {
  get(collection: string, id: string): Promise<Doc | null>;
  patch(collection: string, id: string, fields: Partial<Doc>): Promise<Doc>;
  query(collection: string, filter: Filter): Promise<Doc[]>;
  remove(collection: string, id: string): Promise<void>;
}
```

`patch` must be atomic on one record. That is what the [plugin data](05-plugin-data.md) rules rest on.

Known to be missing: creating a record, clearing a field, writes that depend on the current value, paging and
ordering, and what a filter can express. An open-ended filter is a full scan on a key-value database, so the filter
has to be limited to what all three targets can index. Record size limits differ by database and matter because
plugin data is never deleted.

Registry search needs more than `query` if it is to rank results by meaning. Whether search is its own adapter is
open.

### Build

The build parses source, runs the checks in the [security model](04-security-model.md#at-build), bundles, and
derives the manifest. Parsing and checking are plain JavaScript and run anywhere. Bundling is the part with limits:
a serverless function has little CPU time and no child processes.

```ts
interface BuildAdapter {
  build(source: SourceFiles): Promise<{ bundle: Uint8Array; manifest: Manifest } | BuildErrors>;
}
```

Whether the default build runs inside the serverless function or hands off to a build service is the largest open
portability question. See [open questions](08-open-questions.md#build).

### Model

```ts
interface ModelAdapter {
  run(request: AgentTurn): AsyncIterable<AgentEvent>;
}
```

The agent's tools (search the registry, read a plugin, write files, run the build) are Thixo's and are the same on
every provider.

An agent that takes several turns, calls tools and runs builds does not fit inside one short request. That is in
tension with "each request stands alone" below. Where the loop runs, and how it keeps its place between requests, is
open.

## What each target would use

Candidates, not commitments. None of these has been tested.

| | Cloudflare (first) | Vercel | AWS |
| --- | --- | --- | --- |
| Runtime | Workers | Functions | Lambda |
| Code | R2 | Blob | S3 |
| Data | D1 | Postgres | DynamoDB or Postgres |
| Build | Open | Open | Open |

## What portability rules out

- **A second domain for plugins (X8).** Isolation uses a sandboxed frame on the app's own domain, so an implementor
  needs only one. [The browser spike](04-security-model.md#the-spike) found nothing a second domain would fix in
  every browser.
- **Provider features in the core.** Durable Objects, edge config, queues and the like stay out unless all three
  targets have an equivalent behind an adapter.
- **Long-lived server processes.** The core assumes each request stands alone.

## What an implementor sees

```ts
// thixo.config.ts
import { defineConfig } from "thixo";
import { cloudflare } from "thixo-cloudflare";
import { anthropic } from "thixo-anthropic";

export default defineConfig({
  adapters: cloudflare({ code: "PLUGINS", data: "DB" }),
  model: anthropic(),
});
```

Moving to another provider changes this file and copies the data. It does not change the API, the shell or any
plugin.
