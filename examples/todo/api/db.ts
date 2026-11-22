// The app's own storage. Thixo has no opinion about it: the implementor
// brings whatever database they like. Only plugin data goes through Thixo's
// data adapter. This stand-in keeps todos in memory.

export type Todo = { id: string; title: string; done: boolean };

const rows = new Map<string, Todo>([
  ["todo-1", { id: "todo-1", title: "Write the quarterly report", done: false }],
  ["todo-2", { id: "todo-2", title: "Book flights for the offsite", done: true }],
  ["todo-3", { id: "todo-3", title: "Review the pull request", done: false }],
]);

const assignees = new Map<string, string>([
  ["todo-1", "Ana"],
  ["todo-3", "Ben"],
]);

export const db = {
  assignees: {
    all: async () => [...assignees].map(([todoId, name]) => ({ todoId, name })),
  },
  todos: {
    all: async () => [...rows.values()],
    find: async (id: string) => rows.get(id),
    create: async ({ title }: { title: string }) => {
      const todo = { id: crypto.randomUUID(), title, done: false };
      rows.set(todo.id, todo);
      return todo;
    },
    update: async (id: string, changes: Partial<Omit<Todo, "id">>) => {
      const current = rows.get(id);
      if (!current) return undefined;
      const todo = { ...current, ...changes, id };
      rows.set(id, todo);
      return todo;
    },
    remove: async (id: string) => {
      rows.delete(id);
      assignees.delete(id);
    },
  },
};
