# Concepts

The vocabulary the other docs use. Each word has one meaning here.

## People

| Word | Meaning |
| --- | --- |
| **Implementor** | The developer who builds a product with Tailor. Tailor's direct user. |
| **User** | A person using the implementor's product. |
| **Author** | A user who writes a plugin, usually by asking the authoring agent for it. |

The first implementor is the framework's own author. Everything is designed for a developer setting up an app for a
team, where the team members are the users and some of them become authors.

## The app

| Word | Meaning |
| --- | --- |
| **App** | What the implementor builds: an API, a shell and a set of default plugins. |
| **Endpoint** | One operation in the app's API. It carries its scopes. |
| **Record** | A type of thing in the app, such as a todo, that the API names so plugin data can attach to it. |
| **Scope** | A named permission, such as `todos.write`. Defined by the app's API, held by users, carried in tokens. |
| **Shell** | The base React app. It provides the always-on functionality and defines the slots. |
| **Slot** | A place in the shell where plugins render. Its contract says what a plugin there receives. |
| **Shell service** | Something only the shell can do for a plugin: navigate, open a modal, copy to the clipboard, download a file. |

## Plugins

| Word | Meaning |
| --- | --- |
| **Plugin** | Code that fills a slot. It runs in a sandboxed frame and reaches the app only through the SDK. |
| **Default plugin** | A plugin the implementor ships with the app. Every user has it. |
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

## Server side

| Word | Meaning |
| --- | --- |
| **Registry** | Stores plugin versions and their manifests, builds them, and answers searches. |
| **Authoring agent** | The agent behind the chat interface. It writes plugins and can search the registry. |
| **Narrowed token** | A token the API issues for one user and one plugin version, limited to the scopes both have. |
| **Broker** | The part of the shell that carries a plugin's SDK calls to the API. |
| **Adapter** | The piece that connects Tailor to one provider's storage, database, build or model service. |

## Visibility

A plugin moves through three levels:

1. **Personal:** only its author can use it.
2. **Shared:** it is in the registry, and any user with the required scopes can find, use and fork it.
3. **Default:** the implementor ships it with the app.
