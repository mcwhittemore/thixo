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
| **App** | What the implementor builds: their side of the API, a shell and a set of default plugins. Thixo adds its own side of the API. |
| **Endpoint** | One operation in the app's API. It carries its scopes. |
| **Record** | A type of thing in the app, such as a todo, that the API names so plugin data can attach to it. |
| **Scope** | A named permission to make certain API calls, such as `todos.write`. Defined by the app's API, held by users, carried in tokens. It says nothing about which data a call returns. |
| **Shell** | The base React app. It provides the always-on functionality and defines the slots. |
| **Slot** | A place in the shell that one plugin fills. The implementor defines it, including its size and its contract. |
| **Slot contract** | The context the shell passes to a plugin in a slot and the events the plugin can send back, which the shell routes. |
| **Shell service** | Something only the shell can do for a plugin: navigate, open a modal, copy to the clipboard, download a file. |

## Plugins

| Word | Meaning |
| --- | --- |
| **Plugin** | Code that fills a slot. It is written in the plugin language, compiled to JavaScript that runs in the app's page, and reaches the app only through the plugin SDK. |
| **Plugin language** | Thixo's own language for plugins. It looks a lot like TypeScript and React, and it decides what plugin code can reach. |
| **Default plugin** | A plugin in the layout every user starts with. It lives in the implementor's project. |
| **Required endpoint** | An endpoint a plugin can't work without. A user who can't call it isn't offered the plugin. |
| **Optional endpoint** | An endpoint a plugin can work without. It grays out what a user can't do. |
| **API SDK** | The module the base app imports to call the API. Generated from the API, one function per endpoint, and served from a route in the deployment. |
| **Plugin SDK** | The module a plugin imports to talk with the app. It is generated from the API, with one function per endpoint. Each function hands the call to the shell's broker and waits for the reply. The plugin itself never reaches the network or holds a token. |
| **Version** | An immutable snapshot of a plugin's source. Versions are distinct; there are no branches. |
| **Fork** | A new plugin started from a version of another plugin. It remembers its parent. |
| **Manifest** | The record the build derives for a version: endpoints used, scopes, data schema, shell services. Nobody writes it by hand. |
| **Layout** | Which plugin versions fill which slots for one user. |

## Plugin data

| Word | Meaning |
| --- | --- |
| **Store** | A plugin's own records, private to each user. |
| **Annotation** | Data a plugin attaches to one of the app's records, such as a due date on a todo. |
| **Schema hash** | A stable hash of the fields and types a version declares for its data. |
| **Lineage** | The line of plugins that descend from one original through forks. Plugin data belongs to a lineage, and each fork is a layer over its parent's data. |

### Two phrases used about data

- **Forward capability:** a version keeps working against data that newer versions have written.
- **Compatible:** a fork is compatible with its parent when nothing it declares changes or removes a field the parent
  uses.

## Server side

| Word | Meaning |
| --- | --- |
| **Registry** | Stores plugin versions and their manifests, builds them, and answers searches. |
| **Authoring agent** | The agent behind the chat interface. It writes plugins and can search the registry. |
| **Broker** | The part of the shell that carries a plugin's SDK calls to the API. It refuses a call to any endpoint outside the version's manifest or past what the plugin's author can do, and sends the rest with the user's token. |
| **Adapter** | A piece the implementor swaps to change how Thixo does something: a provider's storage, database, build or model, identity, the authoring flow, or who can promote. What the implementor changes is an adapter. What a user changes is a plugin. |

## Visibility

A plugin moves through three levels:

1. **Personal:** only its author can use it.
2. **Shared:** it is in the registry, and any user with the required scopes can find, use and fork it.
3. **Default:** it is in the layout every user starts with.

A default plugin lives in the implementor's project. Promoting one opens a change there, and a change there publishes
a new version to the registry.
