// The app's own storage. Thixo has no opinion about it: bring whatever database you like. Only plugin data goes
// through Thixo's data adapter. This stand-in keeps todos in memory.

export type Todo = { id: string; title: string; done: boolean };

const rows = new Map<string, Todo>([
  ["todo-1", { id: "todo-1", title: "Write the first page", done: false }],
  ["todo-2", { id: "todo-2", title: "Try the todo list", done: true }],
]);

export const db = {
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
  },
};
