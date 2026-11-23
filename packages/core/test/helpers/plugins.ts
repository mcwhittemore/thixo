import type { Manifest } from "thixo-thx/contract";
import type { PluginLoad } from "../../src/contract.js";
import type { FakeModule, FakePluginApi } from "./fake-runtime.js";

export function manifest(partial: Partial<Manifest> & { slot: string }): Manifest {
  return {
    requiredEndpoints: [],
    optionalEndpoints: [],
    annotates: [],
    data: { stores: {}, annotations: {} },
    schemaHash: "0".repeat(64),
    shellServices: [],
    addresses: [],
    loads: [],
    links: [],
    assets: {},
    libraries: [],
    ...partial,
  };
}

export function pluginLoad(id: string, name: string, m: Manifest, extra: Partial<PluginLoad> = {}): PluginLoad {
  const endpoints = [...m.requiredEndpoints, ...m.optionalEndpoints];
  return {
    plugin: { id, name, description: `${name}, for tests`, author: "implementor", visibility: "shared", readsParentData: false },
    version: 1,
    manifest: m,
    code: `/_thixo/plugins/${id}/1.js`,
    assets: { path: `/_thixo/plugins/${id}/1/assets/`, query: "" },
    authorCan: endpoints,
    userCan: endpoints,
    authorData: { read: true, write: true },
    ...extra,
  };
}

/** Stand-ins for compiled plugins, written against the fake runtime's plugin api. They do what the example plugins
 * in examples/todo/plugins do. */
export const modules: Record<string, FakeModule> = {
  "todo-list": {
    default: (api) => {
      const rt = api as FakePluginApi;
      const { definePlugin, useQuery, useCan, useState, ChildSlot } = rt.import("thixo/plugin");
      const { Stack, TextInput, Button, Text } = rt.import("thixo/ui");
      const { main, todoRow } = rt.import("@app/slots");
      const { listTodos, createTodo } = rt.import("@app/sdk");
      const { deleteTodo } = rt.import("@app/sdk/optional");
      const h = rt.h;
      return definePlugin(
        main,
        { id: "plg_todo_list", name: "Todo list", description: "Every todo in one list." },
        rt.fn(function TodoList({ emit }: any) {
          const todos = useQuery(listTodos);
          const [title, setTitle] = useState("");
          const canDelete = useCan(deleteTodo);
          const add = rt.fn(async () => {
            await createTodo({ title });
            setTitle("");
            todos.refresh();
          });
          return h(
            Stack,
            null,
            h(TextInput, { value: title, onChange: rt.fn((v: string) => setTitle(v)), onSubmit: add, placeholder: "Add a todo" }),
            h(Text, { tone: "muted" }, `${todos.data?.length ?? 0} todos`),
            ...(todos.data ?? []).map((todo: any) =>
              h(
                Stack,
                { key: todo.id, direction: "row" },
                h("button", { onClick: rt.fn(() => emit.select({ todoId: todo.id })) }, todo.title),
                h(ChildSlot, { is: todoRow, context: { todoId: todo.id }, on: { select: rt.fn((e: any) => emit.select(e)) } }),
                h(Button, { disabled: !canDelete }, "Delete"),
              ),
            ),
          );
        }),
      );
    },
  },
  "done-badge": {
    default: (api) => {
      const rt = api as FakePluginApi;
      const { definePlugin, useQuery, css } = rt.import("thixo/plugin");
      const { Badge } = rt.import("thixo/ui");
      const { todoRow } = rt.import("@app/slots");
      const { getTodo } = rt.import("@app/sdk");
      return definePlugin(
        todoRow,
        { id: "plg_done_badge", name: "Done badge", description: "Shows whether a todo is done." },
        rt.fn(function DoneBadge({ context }: any) {
          const todo = useQuery(getTodo, { id: context.todoId });
          const className = css({ marginLeft: 4, position: "fixed", backgroundImage: "url(https://evil.test/x.png)" });
          if (!todo.data) return rt.h("span", { className }, "…");
          return rt.h(Badge, { tone: todo.data.done ? "success" : "muted" }, todo.data.done ? "Done" : "Open");
        }),
      );
    },
  },
  "due-dates": {
    default: (api) => {
      const rt = api as FakePluginApi;
      const { definePlugin, useAnnotation, useQuery } = rt.import("thixo/plugin");
      const { annotate } = rt.import("thixo/data");
      const { t } = rt.import("thixo/schema");
      const { DateInput, Stack, Text } = rt.import("thixo/ui");
      const { todoDetail } = rt.import("@app/slots");
      const { getTodo, Todo } = rt.import("@app/sdk");
      const due = annotate(Todo, { dueOn: t.date() });
      return definePlugin(
        todoDetail,
        { id: "plg_due_dates", name: "Due dates", description: "A due date on a todo." },
        rt.fn(function DueDates({ context }: any) {
          const todo = useQuery(getTodo, { id: context.todoId });
          const [dates, patch] = useAnnotation(due, context.todoId);
          return rt.h(
            Stack,
            null,
            rt.h(Text, null, todo.data?.title ?? ""),
            rt.h(DateInput, { label: "Due", value: dates?.dueOn, onChange: rt.fn((dueOn: Date) => patch({ dueOn })) }),
          );
        }),
      );
    },
  },
  broken: {
    default: (api) => {
      const rt = api as FakePluginApi;
      const { definePlugin } = rt.import("thixo/plugin");
      const { todoDetail } = rt.import("@app/slots");
      return definePlugin(
        todoDetail,
        { name: "Broken", description: "Throws while rendering." },
        rt.fn(function Broken() {
          throw new Error("kaboom");
        }),
      );
    },
  },
};
