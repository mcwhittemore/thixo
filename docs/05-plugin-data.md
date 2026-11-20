# Plugin data

How plugins keep their own data without changing the app's API or schema, and how that data survives new versions
and forks.

The settled points are D1, D3, D4, D5 and D9. The rules that deliver them (D6 to D8, D10 to D12) are proposed.

## Two fixed resources

The API is a fixed writing surface (A7), so a plugin can't add a table or a column. Thixo adds two resources to
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
| **A field's type never changes (D8).** A different type needs a new field with a new name. | A version reading a value in a shape it doesn't expect. |

With these rules every change is additive. That changes what D4 means. No version can lose data, so the submission
report says "this version stops showing these fields" in place of "this version loses data".

### Worked example

Version 1 of a due-dates plugin annotates todos with `dueOn`, a string.

| Change in version 2 | What the registry reports | What happens to data |
| --- | --- | --- |
| Adds `remindAt`, a date | One field added | Nothing. Version 1 never sees `remindAt` and can't overwrite it. |
| Removes `dueOn` | One field no longer shown | `dueOn` values stay. Users on version 1 still read and write them. |
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

These are in [open questions](08-open-questions.md#plugin-data).

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
  every other permission. The registry can then show it, and the broker can enforce it.

### What lineage doesn't solve

- **Two different plugins can't share a field.** Lineage follows forks. The todo list is not a fork of due-dates, so
  it can never show a due date. This is the first thing a user will ask for, and it is the second of the
  [questions to answer first](08-open-questions.md#2-how-do-two-plugins-share-data).
- **Fields flow down only.** A parent can't pick up a field its fork added without becoming a fork of that fork.
- **The source doesn't say whose a field is.** A declaration reads the same whether the field is inherited or new.
  How the registry decides, and what happens when a parent and a fork each add the same name after forking, is
  undefined.
- **"Lineage scope" is not a scope as the concepts define one.** It isn't defined by the app's API and no user holds
  it. D12 needs its own name and its own enforcement.

## Records the app owns

An annotation attaches to a record that lives in the implementor's own storage, which Thixo can't see. Thixo
therefore can't tell whether a record exists, whether this user may read that particular one, or whether it has been
deleted. The record definition (A11) will need to give Thixo a way to ask, and a signal when a record is removed.
This is open.

## Reading many records

The example reads one record's annotation at a time. A list of fifty todos would make fifty calls. Reading
annotations for many records at once, and finding records by an annotation's value ("todos due this week"), are not
designed.

## Deleting data

Deletion exists and is never a side effect of a new version.

- A user can delete their own private store data.
- Removing a field's data from a lineage is an explicit act by someone with the right to do it.

Who that is, and how data is exported or erased on request, is open. See
[open questions](08-open-questions.md#plugin-data).

## What this asks of the data adapter

Patch writes need an atomic read-modify-write on one record. See [portability](06-portability.md#data).

## Held in reserve

Ink & Switch's [Cambria](https://www.inkandswitch.com/cambria/) translates between schema versions in both directions
with lenses. It would allow real renames and type changes. It is left out until the additive rules prove too
limiting.
