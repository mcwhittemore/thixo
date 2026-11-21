# Data model

The structures on Thixo's side of the API, and the rules that keep plugin data safe across versions and forks.

Types are written with `t` from the schema module, the one way Thixo describes a type. The API, slots and plugin
data use it too.

## What Thixo holds

| Structure | What it is | Where it lives |
| --- | --- | --- |
| Plugin | A plugin and where it stands: personal, shared or default | Registry |
| Version | One immutable snapshot of a plugin's source, with its manifest | Registry, source in object storage (U3) |
| Manifest | What the build derived from a version | Registry |
| Layer | One plugin's place in a lineage of forks | Registry |
| Store record | A plugin's own record, private to one user | Plugin data |
| Annotation | A plugin's fields on one of the app's records | Plugin data |
| Layout | Which plugin versions fill which slots | Default in the implementor's project, a user's changes in Thixo's data |

All of it goes through the adapters ([portability](07-portability.md)). A plugin never changes the database schema.

## Plugins and versions

```ts
const Plugin = t.object({
  id: t.id(),
  name: t.string(),
  description: t.string(),     // written by the agent; search reads it
  author: UserId,
  visibility: t.enum(["personal", "shared", "default"]),   // G3
  forkedFrom: t.optional(VersionRef),                      // the version a fork started from (G4)
  layer: Layer,
});

const Version = t.object({
  plugin: PluginId,
  number: t.number(),          // versions are distinct; there are no branches (U2)
  source: SourceRef,           // where the code storage adapter keeps it
  compiled: CodeRef,           // what the plugin route serves
  manifest: Manifest,
  createdBy: UserId,
  createdAt: t.date(),
});
```

A default plugin is also a folder in the implementor's `plugins/`. A change there publishes a new version, and
promoting a plugin to default opens a change there (G3).

## The manifest

Nobody writes a manifest. The build derives it when it compiles a version (L8).

```ts
const Manifest = t.object({
  slot: SlotName,
  endpoints: t.object({
    required: t.array(EndpointName),   // from the plain SDK path (P2)
    optional: t.array(EndpointName),   // from the optional path
  }),
  annotates: t.array(RecordName),      // each adds the scopes that read it (P2, D12)
  data: DataSchema,
  schemaHash: t.string(),              // D3
  shellServices: t.array(ServiceName),
  addresses: t.array(Url),             // every outside address the source names (L7)
});
```

The manifest records endpoints, not scopes. Scopes are looked up from the endpoints when a call is checked or a
search is filtered, so a change to an endpoint's scopes takes effect without rebuilding any plugin. Context fields
of the slot a plugin fills add their scopes the same way (S13).

## Data schema and fields

Each version declares its data: the stores it uses, the records it annotates, and each field's name and type (D3).

```ts
const Field = t.object({
  name: t.string(),
  type: SchemaType,            // never changes (D8)
  declaredBy: PluginId,        // the layer that added it (D10)
  searchable: t.boolean(),     // whether records can be found by its value
});

const DataSchema = t.object({
  stores: t.record(StoreName, t.array(Field)),
  annotations: t.record(RecordName, t.array(Field)),
});
```

On submission the registry:

1. Extracts the declared fields and types from the source.
2. Puts them in a canonical order and hashes them. This is the version's schema hash.
3. Stores the schema beside the hash. The hash says that something changed. The schemas say what.
4. Compares the schema with the previous version's and reports the difference (D4).

## Lineage and layers

A lineage is a plugin and the forks that descend from it. Each plugin in it is a layer over its parent's data, like
a JavaScript prototype chain (D10).

```ts
const Layer = t.object({
  plugin: PluginId,
  dataParent: t.optional(PluginId),   // whose data this layer reads through to; none if it started empty (D9)
});
```

A layer's **chain** is the list from its own layer up through each `dataParent` to the first. A fork always records
the version it came from (`forkedFrom`), but it reads through to its parent's data only if `dataParent` is set.

- **Reads step up.** Reading a field looks in the fork's layer first, then its parent's, and so on up the chain.
- **Writes stay in the fork.** A fork's writes land in its own layer. The parent never sees them.
- **Two forks can use the same name.** Each fork's `priority` is its own field, so they don't collide.

Reading and writing plugin data are two scopes, held like any other. Within them, a plugin reaches only its own
chain's data. The broker enforces that from the plugin's manifest, so a lineage is not a scope (D11).

## Plugin data records

```ts
const RecordRef = t.object({ record: RecordName, id: t.string() });   // one of the app's records (A10)

const StoreRecord = t.object({
  store: StoreName,
  id: t.id(),
  owner: UserId,               // a store is private to each user (D2)
  layer: PluginId,
  fields: Fields,
});

const Annotation = t.object({
  on: RecordRef,
  layer: PluginId,
  group: GroupKey,             // who sees it, from the record's grouping (A11)
  fields: Fields,
});
```

`Fields` maps a field's name to its value. Every field is optional, so a value can always be missing (D5).

`GroupKey` comes from the grouping the implementor set for that kind of record (A11): a user's id when each user
sees only their own, a group's id such as a team's, or none when everyone sees it.

## Layouts

```ts
const Layout = t.record(SlotPath, VersionRef);

const UserLayout = t.object({
  user: UserId,
  changes: Layout,             // only the slots this user changed
});
```

The default layout lives in the implementor's project, beside the default plugins (S9, G3). The shell reads a
user's changes over the default, the way a fork reads over its parent. A `SlotPath` names a slot inside its parents,
such as `main/todo-row`, so a child slot can be filled differently from the default too (S13).

## What Thixo's API serves

The other side of A1: the endpoints every app gets.

| Area | Endpoints |
| --- | --- |
| Registry | Search, get a plugin, list its versions, submit a version, fork, share, promote |
| Plugin data | Read through a chain, read many, find by a searchable field, patch, delete a field's data |
| Layouts | Get the current user's layout, set a slot, reset a slot to the default |
| Authoring | Start and continue a chat with the authoring agent |
| Tokens | Trade the user's session for a token (A4) |

Promoting goes through the promotion adapter, which says who may (W2). Plugin data needs the read and write scopes
(D11).

## Four rules that keep data safe

Versions of one plugin in use at the same time share the same records (D5), because different users will be on
different versions at once. The rules make the storage layer unable to lose data, so no plugin can get it wrong.

| Rule | What it prevents |
| --- | --- |
| **Writes are patches (D6).** A version can only write the fields it declares. | An older version wiping fields a newer one added. |
| **Every field is optional (D5).** Each version works when a field is missing. | A version that stopped using a field breaking an older one that still reads it. |
| **Deleting is its own act (D7).** A version that stops declaring a field stops seeing it. The data stays until someone deletes it on purpose. | A new version destroying what an old one still uses. |
| **A field's type never changes (D8).** A different type needs a new field with a new name. | A version reading a value in a shape it doesn't expect. |

With these rules every change is additive. That changes what D4 means. No version can lose data, so the submission
report says "this version stops showing these fields" in place of "this version loses data".

### Worked example

Version 1 of a due-dates plugin annotates todos with `dueOn`, a string.

| Change in version 2 | What the registry reports | What happens to data |
| --- | --- | --- |
| Adds `remindAt`, a date | One field added | Nothing. Version 1 never sees `remindAt` and can't overwrite it. |
| Removes `dueOn` | One field no longer shown | `dueOn` values stay. Users on version 1 still read and write them, and treat it as missing on todos version 2 created. |
| Declares `dueOn` as a date | Rejected | Nothing. The type of `dueOn` can't change. |
| Adds `dueDate`, a date, and keeps `dueOn` | One field added | Version 2 reads both and can copy old values across. |

### What the rules don't solve

- **Two versions, two truths.** After the last change above, users on version 1 still write `dueOn` and users on
  version 2 write `dueDate`. The same todo can show different due dates to different people until everyone moves.
- **Lists and concurrent edits.** A patch replaces a whole field. Adding one tag to a list writes the full list, and
  two people tagging the same todo can overwrite each other.
- **Clearing a value.** Whether setting a field to nothing counts as a delete under D7 is undefined.
- **Size.** Data that is never deleted grows. There are no quotas yet.

These are in [open questions](09-open-questions.md#plugin-data).

### What lineage doesn't solve

- **Two different plugins can't share a field.** Lineage follows forks. The todo list is not a fork of due-dates, so
  it can't read a due date. A child slot lets due-dates show one in each row instead (S13). See the
  [question on sharing data](09-open-questions.md#2-how-do-two-plugins-share-data).
- **Fields flow down only.** A parent can't pick up a field its fork added without becoming a fork of that fork.
- **A fork's edit shadows its parent's value.** A user who moves from the parent to a fork brings their data. What
  they then write stays in the fork, so if they go back, those edits aren't there.

## Records the app owns

An annotation attaches to a record that lives in the implementor's own storage, which Thixo can't see. Thixo
therefore can't tell whether a record exists, whether this user may read that particular one, or whether it has
been deleted. The record definition (A10) has to give Thixo a way to ask, and a signal when a record is removed.

## Deleting data

Deletion exists and is never a side effect of a new version.

- A user can delete their own store records.
- Removing a field's data from a lineage is an explicit act, separate from publishing a version (D7), by someone
  with the right to do it.

## Held in reserve

Ink & Switch's [Cambria](https://www.inkandswitch.com/cambria/) translates between schema versions in both directions
with lenses. It would allow real renames and type changes. It is left out until the additive rules prove too
limiting.
