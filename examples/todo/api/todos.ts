// Sketch. Nothing here runs yet. See ../readme.md.
//
// The app's API. Each endpoint carries its scopes (A2). Tailor generates the
// SDK that plugins import from this file, one function per endpoint (A10).

import { endpoint, record } from "tailor/api";
import { t } from "tailor/schema";
import { db } from "./db";

// A record is a type of thing in the app that plugins can attach annotations
// to (A11). It names the scopes needed to read one.
export const Todo = record("todo", {
  read: ["todos.read"],
  fields: {
    id: t.string(),
    title: t.string(),
    done: t.boolean(),
    // A field scope (A12). Tailor leaves this field out of every response to
    // a caller without people.read. No handler below filters it by hand.
    assignee: t.optional(t.string()).needs("people.read"),
  },
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
  handler: async ({ input }) => db.todos.get(input.id),
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
  handler: async ({ input }) => db.todos.update(input.id, input),
});

export const deleteTodo = endpoint({
  method: "DELETE",
  path: "/todos/:id",
  scopes: ["todos.read", "todos.delete"],
  input: t.object({ id: t.string() }),
  handler: async ({ input }) => db.todos.remove(input.id),
});
