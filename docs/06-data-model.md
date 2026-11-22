# Data model

The structures for the data models that Thixo ships.

## What Thixo holds

| Structure | What it is | Who writes it |
| --- | --- | --- |
| Plugin | A plugin and whether it is personal or shared | The registry, when a plugin is submitted, forked, shared or promoted |
| PluginVersion | One immutable snapshot of a plugin's source, with its manifest | The registry, once, on submission. Never changed after (U2) |
| PluginVersionManifest | What the build derived from a version | The build, once, when it compiles the version (L8) |
| PluginRecord | A plugin's own record, private to one user | The plugin, through the SDK, for the current user (D2, D6) |
| PluginAnnotation | A plugin's fields on one of the app's records | The plugin, through the SDK (D6) |
| UserLayout | Which plugin versions fill which slots | The user, through the shell. The default comes from the implementor's project (S9) |
| Release | The default plugins and default layout one deploy published | The deploy, once, from the implementor's project (G3) |

All of it goes through the adapters ([portability](07-portability.md)). A plugin never changes the database schema.

## Plugins and versions

**Plugin**

| Name | Type | Description |
| --- | --- | --- |
| id | `PluginId`, required | Set by the registry. |
| name | `string`, required | |
| description | `string`, required | What the plugin is for. Written by the agent, and read by search. |
| author | `UserId`, required | Who asked the agent for it, or the implementor (P6). |
| visibility | `"personal" \| "shared"`, required, default `"personal"` | Who can find it (G3). |
| forkedFrom | `PluginVersionRef`, optional, default none | The version a fork started from (G4). |
| readsParentData | `boolean`, required, default `true` | Whether a fork reads through to the data of the plugin it was forked from. `false` if it started empty (D9). Ignored when there is no `forkedFrom`. |

**PluginVersion**

| Name | Type | Description |
| --- | --- | --- |
| plugin | `PluginId`, required | |
| number | `number`, required | Counts up from 1. Versions are distinct, and there are no branches (U2). |
| source | `SourceRef`, required | Where the code storage adapter keeps the source. |
| sourceHash | `string`, required | A stable hash of the source. A deploy uses it to find a version it already has. |
| compiled | `CodeRef`, required | What the plugin route serves. |
| manifest | `PluginVersionManifest`, required | |
| createdBy | `UserId`, required | |
| createdAt | `date`, required | |

**PluginVersionRef**

| Name | Type | Description |
| --- | --- | --- |
| plugin | `PluginId`, required | The plugin the version belongs to. |
| number | `number`, required | The version's `number` within that plugin. |

A fork's `forkedFrom` and each slot in a `UserLayout` use it. It always names one fixed version, never "the latest".

### Default plugins and deploys

A default plugin is a folder in the implementor's `plugins/`. The repo and the registry each feed the other one way
only: a deploy carries the repo into the registry, and promotion carries the registry into the repo as a change
someone merges (G3).

1. **A folder names its plugin.** Each folder's metadata holds its `PluginId`, in the literal form the build reads
   (U7). Making a new folder writes one, and a promotion writes the id of the plugin being promoted.
2. **Only a deploy publishes.** A commit publishes nothing. The deploy builds every folder with the same checks as
   any plugin (P6). For each, it looks for a version of that plugin with the same `sourceHash`: if there is one it
   uses it, and if not it stores a new version.
3. **The repo's layout names plugins, not versions.** The registry numbers versions, so a commit can't know the
   number. The deploy resolves each slot to the version it just found or stored, and records the result as a
   release.
4. **A plugin is default while the current release has it.** Promoting version 4 of a shared plugin opens a change
   that writes its source into `plugins/`. When that merges and deploys, the hash matches version 4, so no new
   version is made: version 4 is now the default. Removing the folder ends that at the next deploy. Its versions
   stay (U2).
5. **Each environment has its own registry.** Staging and production deploy into their own, with their own version
   numbers and data. A folder's `PluginId` is the same in each.
6. **Rolling back is a deploy.** Deploying an older commit finds its versions by hash and makes a release from them.
   Nothing new is stored.

**Release**

| Name | Type | Description |
| --- | --- | --- |
| id | `ReleaseId`, required | Set by the deploy. |
| deployment | `string`, required | The implementor's deploy that made it, such as a commit sha. |
| plugins | `PluginId[]`, required | The default plugins: one per folder in `plugins/`. |
| layout | map of `SlotPath` to `PluginVersionRef`, required | The default layout, resolved to versions. |
| createdAt | `date`, required | |

The newest release is the default. A slot a user never changed moves to the new default version on the next deploy.
A slot they changed stays where they put it (S9).

A Thixo upgrade recompiles unchanged source. Whether that makes a new version or a new `compiled` on the same one is
[open](09-open-questions.md#plugin-data).

## The manifest

Nobody writes a manifest. The build derives it when it compiles a version (L8).

**PluginVersionManifest**

| Name | Type | Description |
| --- | --- | --- |
| slot | `SlotName`, required | The slot the plugin fills. |
| requiredEndpoints | `EndpointName[]`, required, default `[]` | From the plain SDK path (P2). |
| optionalEndpoints | `EndpointName[]`, required, default `[]` | From the optional path. |
| annotates | `RecordName[]`, required, default `[]` | Each adds the scopes that read it (P2, D12). |
| data | `DataSchema`, required | |
| schemaHash | `string`, required | A stable hash of `data` (D3). |
| shellServices | `ServiceName[]`, required, default `[]` | |
| addresses | `Url[]`, required, default `[]` | Every outside address the source names (L7). |

The manifest records endpoints, not scopes. Scopes are looked up from the endpoints when a call is checked or a
search is filtered, so a change to an endpoint's scopes takes effect without rebuilding any plugin. Context fields of
the slot a plugin fills add their scopes the same way (S13).

## Data schema and fields

Each version declares its data: the stores it uses, the records it annotates, and each field's name and type (D3).

**Field**

| Name | Type | Description |
| --- | --- | --- |
| name | `string`, required | |
| type | `SchemaType`, required | Never changes (D8). |
| declaredBy | `PluginId`, required | The plugin in the chain that added it (D10). |

**DataSchema**

| Name | Type | Description |
| --- | --- | --- |
| stores | map of `StoreName` to `Field[]`, required, default empty | The stores the version uses. |
| annotations | map of `RecordName` to `Field[]`, required, default empty | The fields it adds to each of the app's records. |

On submission the registry:

1. Extracts the declared fields and types from the source.
2. Puts them in a canonical order and hashes them. This is the version's schema hash.
3. Stores the schema beside the hash. The hash says that something changed. The schemas say what.
4. Compares the schema with the previous version's and reports the difference (D4).

## Lineage and layers

A lineage is a plugin and the forks that descend from it. Each plugin in it is a layer over its parent's data, like a
JavaScript prototype chain (D10).

A plugin's **chain** is the list from the plugin up through each fork's parent to the first, stopping at a fork whose
`readsParentData` is `false`. A fork always records the version it came from (`forkedFrom`), and reads through to
that plugin's data unless it started empty.

- **Reads step up.** Reading a field looks in the fork's layer first, then its parent's, and so on up the chain.
- **Writes stay in the fork.** A fork's writes land in its own layer. The parent never sees them.
- **Two forks can use the same name.** Each fork's `priority` is its own field, so they don't collide.

Reading and writing plugin data are two scopes, held like any other. Within them, a plugin reaches only its own
chain's data. The broker enforces that from the plugin's manifest, so a lineage is not a scope (D11).

## Plugin data records

**RecordRef**

| Name | Type | Description |
| --- | --- | --- |
| record | `RecordName`, required | One of the app's records (A10). |
| id | `string`, required | The record's id in the app. |

**PluginRecord**

| Name | Type | Description |
| --- | --- | --- |
| store | `StoreName`, required | |
| id | `string`, required | Set by Thixo when the record is created. |
| owner | `UserId`, required | A store is private to each user (D2). |
| plugin | `PluginId`, required | The plugin in the chain that wrote it. |
| fields | `Fields`, required, default empty | |

**PluginAnnotation**

| Name | Type | Description |
| --- | --- | --- |
| on | `RecordRef`, required | |
| plugin | `PluginId`, required | The plugin in the chain that wrote it. |
| group | `GroupKey`, optional, default none | Who sees it, from the record's grouping (A11). None means everyone. |
| fields | `Fields`, required, default empty | |

`Fields` maps a field's name to its value. Every field is optional, so a value can always be missing (D5).

`GroupKey` comes from the grouping the implementor set for that kind of record (A11): a user's id when each user sees
only their own, a group's id such as a team's, or none when everyone sees it.

## Layouts

**UserLayout**

| Name | Type | Description |
| --- | --- | --- |
| user | `UserId`, required | |
| changes | map of `SlotPath` to `PluginVersionRef`, required, default empty | Only the slots this user changed. |

The default layout lives in the implementor's project, beside the default plugins (S9, G3). The shell reads a user's
changes over the default, the way a fork reads over its parent. A `SlotPath` names a slot inside its parents, such as
`main/todo-row`, so a child slot can be filled differently from the default too (S13).

## What Thixo's API serves

The other side of A1: the endpoints every app gets.

| Area | Endpoints |
| --- | --- |
| Registry | Search, get a plugin, list its versions, submit a version, fork, share, promote |
| Plugin data | Read through a chain, read many, patch, delete a field's data |
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
