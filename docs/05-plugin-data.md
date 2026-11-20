# Plugin data

How plugins keep their own data without changing the app's API or schema, and how that data survives new versions
and forks.

The settled points are D1, D3, D4, D5 and D9. The rules that deliver them (D6 to D8, D10 to D12) are proposed.

## Two fixed resources

The API is a fixed writing surface (A7), so a plugin can't add a table or a column. Tailor adds two resources to
every app's API, the same everywhere:

- **Store:** the plugin's own records. A store is private to one user or shared by everyone using the plugin (D2).
  Example: a user's saved filters.
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

## Three rules that keep data safe

The goal is D5: old and new versions run against the same data, because different users will be on different
versions at the same time. The proposal is to make the storage layer unable to lose data, so no plugin can get it
wrong.

| Rule | What it prevents |
| --- | --- |
| **Writes are patches (D6).** A version can only write the fields it declares. | An older version wiping fields a newer one added. |
| **Versions can't delete (D7).** Dropping a field from the schema hides it from that version. The data stays. | A new version destroying what an old one still uses. |
| **A type change is a new field (D8).** A field is its name and type together. | A version reading a value in a shape it doesn't expect. |

With these rules every change is additive. The submission report changes meaning: it says "this version stops
showing these fields", not "this version loses data".

### Worked example

Version 1 of a due-dates plugin annotates todos with `dueOn`, a string.

| Change in version 2 | What the registry reports | What happens to data |
| --- | --- | --- |
| Adds `remindAt`, a date | One field added | Nothing. Version 1 never sees `remindAt` and can't overwrite it. |
| Removes `dueOn` | One field no longer shown | `dueOn` values stay. Users on version 1 still read and write them. |
| Changes `dueOn` to a date | One field added, one no longer shown | Both exist. Version 2 can copy old values across as it reads them. |

## Forks and lineage

A fork whose schema is compatible with its parent's must be able to read the parent's data (D9). Under the three
rules, every fork is compatible, because nothing a fork does can break the parent's fields.

So the proposal is to attach data to a lineage, not to one plugin (D10):

- A new plugin starts a lineage.
- A fork joins its parent's lineage by default. It sees the parent's data from its first run.
- A fork can opt to start a new lineage with no data.

Several people's variants of one tool then work over the same records. Someone can fork a colleague's plugin to
change how it looks and lose nothing.

### Two details this needs

- **Who introduced a field (D11).** If two forks each add a field called `priority` with different meanings, they
  would collide in a shared lineage. A field is identified by the plugin that introduced it, its name and its type.
  Fields from the parent are inherited and shared. Fields a fork adds are its own unless a later fork inherits them.
- **Lineage access is a scope (D12).** A fork that reads and writes its parent's data says so through the SDK, like
  every other permission. The registry can then show it, and the narrowed token can enforce it.

## Deleting data

Deletion exists and is never a side effect of a new version.

- A user can delete their own private store data.
- Removing a field's data from a lineage is an explicit act by someone with the right to do it.

Who that is, and how data is exported or erased on request, is open. See
[open questions](08-open-questions.md#plugin-data).

## What this asks of the data adapter

Patch writes need an atomic read-modify-write on one record. Every candidate database supports that. See
[portability](06-portability.md#data).

## Held in reserve

Ink & Switch's [Cambria](https://www.inkandswitch.com/cambria/) translates between schema versions in both directions
with lenses. It would allow real renames and type changes. It is left out until the additive rules prove too
limiting.
