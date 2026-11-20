# Todo example

A basic todo app written the way a Tailor app should read.

> **This is a sketch. It does not run.** The `tailor` packages it imports don't exist. The example is here to test
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
tailor.config.ts   identity, adapters and the default layout
```

## What each file shows

| File | Shows | Requirements |
| --- | --- | --- |
| [api/todos.ts](api/todos.ts) | Endpoints with required and optional scopes. One endpoint needing two scopes. A response that widens with an optional scope. | A2, A3 |
| [app/slots.ts](app/slots.ts) | Two slots with contracts: context in, events out. | S2, S5 |
| [app/shell.tsx](app/shell.tsx) | An ordinary React app. No frame or message code. | S1, S7 |
| [plugins/todo-list/plugin.tsx](plugins/todo-list/plugin.tsx) | Scopes derived from imports. A required and an optional endpoint. A grayed-out action. | P2, P4, P5 |
| [plugins/due-dates/data.ts](plugins/due-dates/data.ts) | An annotation and a private store, declared as types. | D1, D2, D3 |
| [plugins/due-dates/plugin.tsx](plugins/due-dates/plugin.tsx) | Reading and patching plugin data. | D6 |
| [tailor.config.ts](tailor.config.ts) | The implementor's identity function. Adapters in one place. | A9, X6, S10 |

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
| Optional scopes | `people.read` |
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
8. **Plugins need React helpers.** `useQuery` and `due.use` are assumed here. Which helpers Tailor ships, and how
   they handle loading and errors, is not designed.
