// Sketch. Nothing here runs yet. See ../readme.md.
//
// The app's API. Each endpoint carries its scopes (A2). Tailor generates the
// SDK that plugins import from this file, one function per endpoint (A10).

import { endpoint, record, t } from "tailor/api";
import { db } from "./db";

// A record is a type of thing in the app that plugins can attach annotations
// to. It names the scopes needed to read one, so the annotation endpoints
// can check them.
export const Todo = record("todo", {
  read: ["todos.read"],
  fields: {
    id: t.string(),
    title: t.string(),
    done: t.boolean(),
    // Only present when the caller also holds people.read.
    assignee: t.optional(t.string()),
  },
});

export const listTodos = endpoint({
  method: "GET",
  path: "/todos",
  // Required: every caller needs these. Optional: holding them widens the
  // response (A3).
  scopes: { required: ["todos.read"], optional: ["people.read"] },
  output: t.array(Todo),
  handler: async ({ has }) => {
    const todos = await db.todos.all();
    if (has("people.read")) return todos;
    return todos.map(({ assignee, ...rest }) => rest);
  },
});

export const getTodo = endpoint({
  method: "GET",
  path: "/todos/:id",
  scopes: { required: ["todos.read"], optional: ["people.read"] },
  input: t.object({ id: t.string() }),
  output: Todo,
  handler: async ({ input, has }) => {
    const { assignee, ...rest } = await db.todos.get(input.id);
    return has("people.read") ? { ...rest, assignee } : rest;
  },
});

export const createTodo = endpoint({
  method: "POST",
  path: "/todos",
  // An endpoint can need more than one scope.
  scopes: { required: ["todos.read", "todos.write"] },
  input: t.object({ title: t.string() }),
  output: Todo,
  handler: async ({ input }) => db.todos.create(input),
});

export const updateTodo = endpoint({
  method: "PATCH",
  path: "/todos/:id",
  scopes: { required: ["todos.read", "todos.write"] },
  input: t.object({
    id: t.string(),
    title: t.optional(t.string()),
    done: t.optional(t.boolean()),
  }),
  output: Todo,
  handler: async ({ input }) => db.todos.update(input.id, input),
});

export const deleteTodo = endpoint({
  method: "DELETE",
  path: "/todos/:id",
  scopes: { required: ["todos.read", "todos.delete"] },
  input: t.object({ id: t.string() }),
  handler: async ({ input }) => db.todos.remove(input.id),
});
