// The app's API. Each endpoint carries its scopes (A2). Thixo generates the
// SDK that plugins import from this file, one function per endpoint (A9).

import { endpoint, record, HttpError } from "thixo/api";
import { t } from "thixo/schema";
import { db } from "./db.js";

// A record is a type of thing in the app that plugins can attach annotations
// to (A10). It names the scopes needed to read one.
export const Todo = record("todo", {
  read: ["todos.read"],
  fields: {
    id: t.string(),
    title: t.string(),
    done: t.boolean(),
  },
  // Thixo can't see the app's storage, so it asks (A13): does this todo
  // exist, and may this user read it?
  canRead: async (id, user) => user.scopes.includes("todos.read") && (await db.todos.find(id)) !== undefined,
  // An annotation on a todo is shared with the user's team (A11).
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

// Scopes are about which calls can be made, not which data comes back (A12).
// Who a todo is assigned to needs another scope, so it is another endpoint.
export const listAssignees = endpoint({
  method: "GET",
  path: "/assignees",
  scopes: ["todos.read", "people.read"],
  output: t.array(t.object({ todoId: t.string(), name: t.string() })),
  handler: async () => db.assignees.all(),
});

export const createTodo = endpoint({
  method: "POST",
  path: "/todos",
  // An endpoint can need more than one scope. The caller must hold them all
  // (A3).
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

export const deleteTodo = endpoint({
  method: "DELETE",
  path: "/todos/:id",
  scopes: ["todos.read", "todos.delete"],
  input: t.object({ id: t.string() }),
  handler: async ({ input }) => db.todos.remove(input.id),
});
