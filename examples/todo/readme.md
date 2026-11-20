# Todo example

A basic todo app written the way a Thixo app should read.

> **This is a sketch. It does not run.** The `thixo` packages it imports don't exist. The example is here to test
> the [requirements](../../docs/02-requirements.md): if something is awkward to write here, the requirement behind it
> is wrong. Every name in it is open to change.

## The files

```
api/
  scopes.ts        the app's scopes, in words
  todos.ts         the endpoints, each with its scopes
  session.ts       the app's own login (stand-in)
  db.ts            the app's own storage (stand-in)
app/
  slots.ts         where plugins go
  shell.tsx        the base app
plugins/
  todo-list/       a default plugin: the list itself
  due-dates/       a plugin of the kind a user would ask for
thixo.config.ts   identity, adapters and the default layout
```

## What each file shows

| File | Shows | Requirements |
| --- | --- | --- |
| [api/todos.ts](api/todos.ts) | Endpoints with their scopes. Endpoints needing two scopes. A record. Data that needs another scope as its own endpoint. | A2, A3, A11, A12 |
| [app/slots.ts](app/slots.ts) | Two slots with contracts: context in, events out. One holds a single plugin, one holds many. | S5, S11, S12 |
| [app/shell.tsx](app/shell.tsx) | An ordinary React app. No frame or message code. | S1, S7 |
| [plugins/todo-list/plugin.tsx](plugins/todo-list/plugin.tsx) | Scopes derived from imports. Required and optional endpoints. A grayed-out action. | P2, P4, P5, P13 |
| [plugins/due-dates/data.ts](plugins/due-dates/data.ts) | An annotation and a private store, declared as literals. | D1, D2, D3, U11 |
| [plugins/due-dates/plugin.tsx](plugins/due-dates/plugin.tsx) | Reading and patching plugin data. | D6 |
| [thixo.config.ts](thixo.config.ts) | The implementor's identity function. Adapters in one place. | A9, X6, U10, S10 |

## What the build would derive

Nobody writes these. They are what the registry would record for each plugin.

**todo-list**

| | |
| --- | --- |
| Slot | `main` |
| Required scopes | `todos.read`, `todos.write` |
| Optional scopes | `todos.delete`, `people.read` |
| Data | none |
| Summary | Reads todos. Creates and changes todos. Can delete todos and show who they're assigned to, if you're allowed. |

**due-dates**

| | |
| --- | --- |
| Slot | `todo-detail` |
| Required scopes | `todos.read` |
| Optional scopes | none |
| Data | Annotation on `todo`: `dueOn` (date). Private store `prefs`: `warnDaysBefore` (number). |
| Summary | Reads todos. Adds a due date to todos. Keeps a private setting. |

The stand-in login gives a user `todos.read`, `todos.write` and `people.read`. That user is offered both plugins, and
sees the Delete button grayed out.

## A walk through a fork

What should happen when a user changes someone else's plugin. No code for this exists in the example.

1. Ana uses due-dates, which Ben wrote and shared. She asks the chat: "also let me set a reminder time".
2. The agent searches the registry, finds due-dates and forks its current version.
3. It adds `remindAt` to the annotation in `data.ts` and a field to the panel.
4. The build passes. The registry reports: one field added, nothing hidden. Scopes unchanged.
5. Ana's fork joins the lineage of Ben's plugin. Every due date already set is there.
6. Ben, still on his own version, never sees `remindAt` and can't overwrite it.
7. Ana shares her fork. Ben can switch to it and lose nothing.

## What writing this surfaced

Things the example needed that the requirements had not said. Each is now a proposed requirement or an open
question.

1. **Slots need events out.** The list has to tell the shell which todo was picked so the panel can open. A slot's
   contract is context in and events out, and the shell passes information between plugins. (S11)
2. **The API has to name its records.** An annotation attaches to "a todo", so the app must say what a todo is and
   which scopes read one. (A11, D13)
3. **Data declarations carry scopes too.** Annotating a todo requires being able to read todos, so the build derives
   scopes from `data.ts` as well as from endpoint imports.
4. **Plugins import the slot definitions.** A plugin gets its typed context from `@app/slots`, so that module is
   generated and allowed like the SDK. (U5)
5. **A slot holds one plugin or many.** The main area has one. The detail panel has any number, each in its own
   frame.
6. **One thing is still written by hand: the description.** Search needs words about what a plugin is for. The agent
   can write them, and the build can't derive them.
7. **Scopes need words.** The plain summary shown at submission comes from a description on each scope.
8. **Plugins need React helpers.** `useQuery`, `useCan`, `useAnnotation` and `useStore` are assumed here. Which
   helpers Thixo ships, and how they report loading and errors, is not designed.
9. **Scopes are about calls, not data.** An earlier draft had each handler strip `assignee` for callers without
   `people.read`, and two of the five forgot. Field-level permission is not Thixo's job. Assignees are now their own
   endpoint with their own scope. (A12)

## What a second test surfaced

A separate attempt to write a third plugin from the docs alone: "put tags on todos, show them in the list, filter by
tag". It could be written only as a fork of the whole todo list, and it exposed the limits below. They are now the
[second question to answer first](../../docs/08-open-questions.md#2-how-do-two-plugins-share-data).

1. **A tags editor in the panel and tags in the list can't be two plugins.** They could not share the `tags` field.
2. **Adding anything to a row means forking the list.** The fork then stops getting the implementor's updates.
3. **Annotations are read one record at a time.** Fifty todos means fifty calls.
4. **Filtering happens in the frame.** The API knows nothing about annotations, so the plugin loads everything and
   hides rows.
5. **A fork is not expressed anywhere in the source.** Nor is switching a user's layout to the new fork.
6. **A patch replaces a whole list.** Two people tagging the same todo can overwrite each other.
