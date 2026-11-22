// The app's API. Each endpoint carries its scopes. Thixo generates the SDK that plugins import from this file, one
// function per endpoint.

import { endpoint, record, HttpError } from "thixo/api";
import { recordDeleted } from "thixo/server";
import { t } from "thixo/schema";
import { db } from "./db.js";

// A record is a type of thing in the app that plugins can attach annotations to. It names the scopes needed to read one.
export const Todo = record("todo", {
  read: ["todos.read"],
  fields: {
    id: t.string(),
    title: t.string(),
    done: t.boolean(),
  },
  // Thixo can't see the app's storage, so it asks: does this todo exist, and may this user read it?
  canRead: async (id, user) => user.scopes.includes("todos.read") && (await db.todos.find(id)) !== undefined,
  // An annotation on a todo is shared with the user's team.
  group: (_id, user) => user.groups?.[0] ?? null,
});

export const listTodos = endpoint({
  method: "GET",
  path: "/todos",
  scopes: ["todos.read"],
  output: t.array(Todo),
  handler: async () => db.todos.all(),
});

export const getTodo = endpoint({
  method: "GET",
  path: "/todos/:id",
  scopes: ["todos.read"],
  input: t.object({ id: t.string() }),
  output: Todo,
  handler: async ({ input }) => {
    const todo = await db.todos.find(input.id);
    if (!todo) throw new HttpError(404, `No todo ${input.id}`);
    return todo;
  },
});

export const createTodo = endpoint({
  method: "POST",
  path: "/todos",
  // An endpoint can need more than one scope. The caller must hold them all.
  scopes: ["todos.read", "todos.write"],
  input: t.object({ title: t.string() }),
  output: Todo,
  handler: async ({ input }) => db.todos.create(input),
});

export const updateTodo = endpoint({
  method: "PATCH",
  path: "/todos/:id",
  scopes: ["todos.read", "todos.write"],
  input: t.object({
    id: t.string(),
    title: t.optional(t.string()),
    done: t.optional(t.boolean()),
  }),
  output: Todo,
  handler: async ({ input }) => {
    const { id, ...changes } = input;
    const todo = await db.todos.update(id, changes);
    if (!todo) throw new HttpError(404, `No todo ${id}`);
    return todo;
  },
});

// Only a user who holds todos.delete may call this: ben does, ana does not. The todo list imports it from
// @app/sdk/optional, so ana still gets the list, with Delete grayed out (useCan).
export const deleteTodo = endpoint({
  method: "DELETE",
  path: "/todos/:id",
  scopes: ["todos.read", "todos.delete"],
  input: t.object({ id: t.string() }),
  handler: async ({ input }) => {
    if (!(await db.todos.remove(input.id))) throw new HttpError(404, `No todo ${input.id}`);
    // Thixo can't see the app's storage, so the app says when a record goes: plugin data on it goes with it.
    await recordDeleted("todo", input.id);
  },
});
