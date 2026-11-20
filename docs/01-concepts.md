# Concepts

The vocabulary the other docs use. Each word has one meaning here.

## People

| Word | Meaning |
| --- | --- |
| **Implementor** | The developer who builds a product with Thixo. Thixo's direct user. |
| **User** | A person using the implementor's product. |
| **Author** | A user who writes a plugin by asking the authoring agent for it. |

## The app

| Word | Meaning |
| --- | --- |
| **App** | What the implementor builds: an API, a shell and a set of default plugins. |
| **Endpoint** | One operation in the app's API. It carries its scopes. |
| **Record** | A type of thing in the app, such as a todo, that the API names so plugin data can attach to it. |
| **Scope** | A named permission to make certain API calls, such as `todos.write`. Defined by the app's API, held by users, carried in tokens. It says nothing about which data a call returns. |
| **Shell** | The base React app. It provides the always-on functionality and defines the slots. |
| **Slot** | A place in the shell where plugins render. It has a kind, which sets its size, and a contract. |
| **Slot contract** | The context the shell passes to a plugin in a slot, the events the plugin can send back, and the values it can provide up. |
| **Shell service** | Something only the shell can do for a plugin: navigate, open a modal, copy to the clipboard, download a file. |

## Plugins

| Word | Meaning |
| --- | --- |
| **Plugin** | Code that fills a slot. It runs in a sandboxed frame and reaches the app only through the SDK. |
| **Default plugin** | A plugin in the layout every user starts with. |
| **Required endpoint** | An endpoint a plugin can't work without. A user who can't call it isn't offered the plugin. |
| **Optional endpoint** | An endpoint a plugin can work without. It grays out what a user can't do. |
| **SDK** | The module a plugin imports to call endpoints. Generated from the API, one function per endpoint. |
| **Version** | An immutable snapshot of a plugin's source. Versions are distinct; there are no branches. |
| **Fork** | A new plugin started from a version of another plugin. It remembers its parent. |
| **Manifest** | The record the build derives for a version: endpoints used, scopes, data schema, shell services. Nobody writes it by hand. |
| **Layout** | Which plugin versions fill which slots for one user. |

## Plugin data

| Word | Meaning |
| --- | --- |
| **Store** | A plugin's own records, private to one user or shared by everyone using the plugin. |
| **Annotation** | Data a plugin attaches to one of the app's records, such as a due date on a todo. |
| **Schema hash** | A stable hash of the fields and types a version declares for its data. |
| **Lineage** | The line of plugins that descend from one original through forks. Plugin data belongs to a lineage. |

### Two phrases used about data

- **Forward capability:** a version keeps working against data that newer versions have written.
- **Compatible:** a fork is compatible with its parent when nothing it declares changes or removes a field the parent
  uses.

## Server side

| Word | Meaning |
| --- | --- |
| **Registry** | Stores plugin versions and their manifests, builds them, and answers searches. |
| **Authoring agent** | The agent behind the chat interface. It writes plugins and can search the registry. |
| **Narrowed token** | A token the API issues for one user and one plugin version. It is good only for the endpoints in that version's manifest, within the scopes the user and the plugin's author both hold. |
| **Broker** | The part of the shell that carries a plugin's SDK calls to the API. |
| **Adapter** | The piece that connects Thixo to one provider's storage, database, build or model service. |

## Visibility

A plugin moves through three levels:

1. **Personal:** only its author can use it.
2. **Shared:** it is in the registry, and any user with the required scopes can find, use and fork it.
3. **Default:** it is in the layout every user starts with.

A default plugin can come from the app's `plugins/` folder or be promoted from the registry. How the two relate is an
[open question](08-open-questions.md#layout-and-versions).
