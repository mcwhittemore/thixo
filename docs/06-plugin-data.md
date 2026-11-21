# Plugin data

How plugins keep their own data without changing the app's API or schema, and how that data survives new versions
and forks.

The requirements are D1 to D12.

## Two fixed resources

The API is a fixed writing surface (A6), so a plugin can't add a table or a column. Thixo adds two resources to
every app's API, the same everywhere:

- **Store:** the plugin's own records. A store is private to each user (D2). Sharing a store across users is left
  for later. Example: a user's saved filters.
- **Annotations:** fields a plugin attaches to one of the app's records. Example: a due date on a todo. Most "I need
  a new field" requests are this.

The implementor never changes the API for a plugin.

## Schema and hash

Each plugin version declares its data: the stores it uses, the records it annotates, and each field's name and type
(D3).

On submission the registry:

1. Extracts the declared fields and types from the source.
2. Puts them in a canonical order and hashes them. This is the version's schema hash.
3. Stores the schema beside the hash. The hash says that something changed. The schemas say what.
4. Compares the schema with the previous version's and reports the difference (D4).

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
  D5 is met on paper and not in practice. Moving people between versions is open.
- **Lists and concurrent edits.** A patch replaces a whole field. Adding one tag to a list writes the full list, and
  two people tagging the same todo can overwrite each other.
- **Clearing a value.** Whether setting a field to nothing counts as a delete under D7 is undefined.
- **Size.** Data that is never deleted grows. There are no quotas yet.

These are in [open questions](09-open-questions.md#plugin-data).

## Forks and lineage

Plugin data belongs to a lineage: a plugin and the forks that descend from it. Each fork is a layer over its
parent's data, like a JavaScript prototype chain (D10):

- **Reads step up.** Reading a field looks in the fork's layer first, then its parent's, and so on up the line.
- **Writes stay in the fork.** A fork's writes land in its own layer. The parent never sees them.
- **Two forks can use the same name.** Each fork's `priority` is its own field, so they don't collide.

A fork reads through to its parent's data by default, and can start empty instead (D9). Someone can fork a
colleague's plugin to change how it looks and lose nothing.

Reading and writing plugin data are two scopes, held like any other. Within them, a plugin reaches only its own
lineage's data. The broker enforces that from the plugin's manifest, so a lineage is not a scope (D11).

### What lineage doesn't solve

- **Two different plugins can't share a field.** Lineage follows forks. The todo list is not a fork of due-dates, so
  it can never show a due date. This is the first thing a user will ask for, and it is the second of the
  [questions to answer first](09-open-questions.md#2-how-do-two-plugins-share-data).
- **Fields flow down only.** A parent can't pick up a field its fork added without becoming a fork of that fork.
- **A fork's edit shadows its parent's value.** A user who moves from the parent to a fork brings their data. What
  they then write stays in the fork, so if they go back, those edits aren't there.

## Records the app owns

An annotation attaches to a record that lives in the implementor's own storage, which Thixo can't see. Thixo
therefore can't tell whether a record exists, whether this user may read that particular one, or whether it has been
deleted. The record definition (A10) will need to give Thixo a way to ask, and a signal when a record is removed.
This is open.

## Reading many records

The example reads one record's annotation at a time. A list of fifty todos would make fifty calls. Reading
annotations for many records at once, and finding records by an annotation's value ("todos due this week"), are not
designed.

## Deleting data

Deletion exists and is never a side effect of a new version.

- A user can delete their own private store data.
- Removing a field's data from a lineage is an explicit act, separate from publishing a version (D7), by someone
  with the right to do it.

Who that is, and how data is exported or erased on request, is open. See
[open questions](09-open-questions.md#plugin-data).

## What this asks of the data adapter

Patch writes need an atomic read-modify-write on one record. See [portability](07-portability.md#data).

## Held in reserve

Ink & Switch's [Cambria](https://www.inkandswitch.com/cambria/) translates between schema versions in both directions
with lenses. It would allow real renames and type changes. It is left out until the additive rules prove too
limiting.
