// Sketch. Nothing here runs yet. See ../readme.md.
//
// The app's own storage. Thixo has no opinion about it: the implementor
// brings whatever database they like. Only plugin data goes through Thixo's
// data adapter. This stand-in keeps todos in memory.

type Todo = { id: string; title: string; done: boolean };

const rows = new Map<string, Todo>();

const assignees = new Map<string, string>();

export const db = {
  assignees: {
    all: async () => [...assignees].map(([todoId, name]) => ({ todoId, name })),
  },
  todos: {
    all: async () => [...rows.values()],
    get: async (id: string) => rows.get(id)!,
    create: async ({ title }: { title: string }) => {
      const todo = { id: crypto.randomUUID(), title, done: false };
      rows.set(todo.id, todo);
      return todo;
    },
    update: async (id: string, changes: Partial<Todo>) => {
      const todo = { ...rows.get(id)!, ...changes, id };
      rows.set(id, todo);
      return todo;
    },
    remove: async (id: string) => {
      rows.delete(id);
    },
  },
};
