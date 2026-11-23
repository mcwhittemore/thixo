import assert from "node:assert/strict";
import { test } from "node:test";
import * as scopesModule from "../../../examples/todo/api/scopes.js";
import * as todosModule from "../../../examples/todo/api/todos.js";
import * as slotsModule from "../../../examples/todo/app/slots.js";
import { collectApp } from "../src/api/index.js";
import { buildCompileEnv } from "../src/server/index.js";
import { typecheck } from "./helpers/typecheck.js";

const app = collectApp([scopesModule, todosModule, slotsModule] as Record<string, unknown>[], {});
const env = buildCompileEnv(app, {});
const modules = Object.fromEntries(Object.entries(env.modules).map(([name, m]) => [name, m.dts]));

const dueData = `
import { annotate, store } from "thixo/data";
import { t } from "thixo/schema";
import { Todo } from "@app/sdk";

export const due = annotate(Todo, { dueOn: t.date() });
export const prefs = store("prefs", { fields: { warnDaysBefore: t.number(), tags: t.array(t.string()), site: t.url() } });
`;

const duePlugin = `
import { definePlugin, useAnnotation, useQuery, useStore } from "thixo/plugin";
import { DateInput, NumberInput, Stack, Text } from "thixo/ui";
import { todoDetail } from "@app/slots";
import { getTodo } from "@app/sdk";
import { due, prefs } from "./data";

export default definePlugin(
  todoDetail,
  { name: "Due dates", description: "Give a todo a due date and see a warning when it is close." },
  function DueDate({ context }) {
    const todo = useQuery(getTodo, { id: context.todoId });
    const [dates, patchDates] = useAnnotation(due, context.todoId);
    const [settings, patchSettings] = useStore(prefs);

    const warnDays = settings?.warnDaysBefore ?? 2;
    const close = dates?.dueOn && daysUntil(dates.dueOn) <= warnDays;

    return (
      <Stack>
        <Text>{todo.data?.title}</Text>
        <DateInput label="Due" value={dates?.dueOn} onChange={(dueOn) => patchDates({ dueOn })} />
        {close && <Text tone="warning">Due soon</Text>}
        <NumberInput
          label="Warn me this many days before"
          value={warnDays}
          onChange={(warnDaysBefore) => patchSettings({ warnDaysBefore })}
        />
      </Stack>
    );
  },
);

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}
`;

const listPlugin = `
import { definePlugin, useCan, useQuery, useState } from "thixo/plugin";
import { Button, Checkbox, Stack, TextInput } from "thixo/ui";
import { main } from "@app/slots";
import { listTodos, createTodo, updateTodo } from "@app/sdk";
import { deleteTodo, listAssignees } from "@app/sdk/optional";

export default definePlugin(
  main,
  { name: "Todo list", description: "Every todo in one list. Add, tick off and delete." },
  function TodoList({ emit }) {
    const todos = useQuery(listTodos);
    const [title, setTitle] = useState("");
    const canDelete = useCan(deleteTodo);
    const assignees = useQuery(listAssignees);
    const assigneeOf = (todoId: string) => assignees.data?.find((a) => a.todoId === todoId)?.name;

    async function add() {
      await createTodo({ title });
      setTitle("");
      todos.refresh();
    }

    return (
      <Stack>
        <TextInput value={title} onChange={setTitle} onSubmit={add} placeholder="Add a todo" />
        {todos.data?.map((todo) => (
          <Stack key={todo.id} direction="row">
            <Checkbox checked={todo.done} onChange={(done) => updateTodo({ id: todo.id, done }).then(todos.refresh)} />
            <button onClick={() => emit.select({ todoId: todo.id })}>{todo.title}</button>
            {assigneeOf(todo.id) && <span>{assigneeOf(todo.id)}</span>}
            <Button disabled={!canDelete} onClick={() => deleteTodo({ id: todo.id }).then(todos.refresh)}>
              Delete
            </Button>
          </Stack>
        ))}
      </Stack>
    );
  },
);
`;

const rowPlugin = `
import { ChildSlot, definePlugin, useState } from "thixo/plugin";
import { Stack, Text } from "thixo/ui";
import { main, todoRow } from "@app/slots";

export default definePlugin(main, { name: "Rows", description: "Places a row slot." }, function Rows({ emit }) {
  const [ids] = useState(["a", "b"]);
  return (
    <Stack>
      {ids.map((id) => (
        <ChildSlot key={id} is={todoRow} context={{ todoId: id }} on={{ select: (e) => emit.select(e) }} />
      ))}
      <Text>{ids.length}</Text>
    </Stack>
  );
});
`;

const check = (files: Record<string, string>) => typecheck({ modules, files });

test("the generated declarations describe the todo app", () => {
  const sdk = env.modules["@app/sdk"].dts;
  assert.match(sdk, /export type Todo = \{ id: string; title: string; done: boolean \};/);
  assert.match(sdk, /export const Todo: RecordHandle<"todo", Todo>;/);
  assert.match(sdk, /export function listTodos\(\): Promise<Todo\[\]>;/);
  assert.match(sdk, /export function getTodo\(input: \{ id: string \}\): Promise<Todo>;/);
  assert.match(sdk, /export function updateTodo\(input: \{ id: string; title\?: string; done\?: boolean \}\): Promise<Todo>;/);
  assert.match(sdk, /export function deleteTodo\(input: \{ id: string \}\): Promise<void>;/);
  assert.match(env.modules["@app/slots"].dts, /export const todoDetail: SlotHandle<\{ todoId: string \}, \{\}>;/);
  assert.match(env.modules["@app/slots"].dts, /export const main: SlotHandle<\{\}, \{ select: \{ todoId: string \} \}>;/);
});

test("the compile env carries what the manifest needs", () => {
  assert.deepEqual(Object.keys(env.modules).sort(), [
    "@app/sdk", "@app/sdk/optional", "@app/slots", "thixo/data", "thixo/plugin", "thixo/schema", "thixo/services", "thixo/ui",
  ]);
  assert.deepEqual(env.endpoints.createTodo, { scopes: ["todos.read", "todos.write"] });
  assert.deepEqual(env.records, { Todo: { name: "todo", read: ["todos.read"] } });
  assert.deepEqual(env.slots.todoDetail, { name: "todo-detail" });
  assert.deepEqual(env.services, ["navigate", "openModal", "copyToClipboard", "download", "toast"]);
  assert.equal("addressHosts" in env, false, "there are no host lists: a written-out load is copied at build");
  assert.equal("linkHosts" in env, false);
  assert.equal(env.assets, undefined, "the build step adds the copies, not the app");
});

test("every fixed module and the generated ones are valid declarations on their own", () => {
  assert.deepEqual(check({ "/probe.ts": Object.keys(modules).map((m, i) => `import * as m${i} from "${m}";\nvoid m${i};`).join("\n") }), []);
});

test("the two example plugins type-check", () => {
  assert.deepEqual(check({ "/due/plugin.tsx": duePlugin, "/due/data.ts": dueData }), []);
  assert.deepEqual(check({ "/list/plugin.tsx": listPlugin }), []);
  assert.deepEqual(check({ "/rows/plugin.tsx": rowPlugin }), []);
});

test("a slot's context and emits, an endpoint's output and a declaration's fields are all typed", () => {
  const bad = (body: string, expected: RegExp) => {
    const errors = check({ "/p/plugin.tsx": duePrelude + body, "/p/data.ts": dueData });
    assert.ok(errors.some((e) => expected.test(e)), `expected ${expected} in:\n${errors.join("\n") || "(no errors)"}`);
  };
  const duePrelude = `
import { definePlugin, useAnnotation, useQuery, useStore, useAnnotations, useStoreList } from "thixo/plugin";
import { Stack } from "thixo/ui";
import { todoDetail, main } from "@app/slots";
import { getTodo, listTodos } from "@app/sdk";
import { due, prefs } from "./data";
`;
  bad(`definePlugin(todoDetail, { name: "a", description: "b" }, ({ context }) => { context.nope; return <Stack />; });`, /nope/);
  bad(`definePlugin(todoDetail, { name: "a", description: "b" }, ({ context, emit }) => { emit.select({}); return <Stack />; });`, /select/);
  bad(`definePlugin(main, { name: "a", description: "b" }, ({ emit }) => { emit.select({ todoId: 1 }); return <Stack />; });`, /number/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { const q = useQuery(listTodos); q.data?.[0].nope; return <Stack />; });`, /nope/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { useQuery(getTodo); return <Stack />; });`, /No overload|Expected/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { useQuery(getTodo, { id: 5 }); return <Stack />; });`, /number|No overload/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { const [d, patch] = useAnnotation(due, "x"); patch({ dueOn: "soon" }); return <Stack />; });`, /string|Date/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { const [d] = useAnnotation(due, "x"); d?.missing; return <Stack />; });`, /missing/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { const [p] = useStore(prefs); const n: number = p.warnDaysBefore; return <Stack />; });`, /undefined/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { const m = useAnnotations(due, ["a"]); const d: Date = m.get("a")!.dueOn; return <Stack />; });`, /undefined/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => { const s = useStoreList(prefs); s.create({ warnDaysBefore: "x" }); return <Stack />; });`, /string/);
  bad(`definePlugin(main, { name: "a" }, () => <Stack />);`, /description/);
  bad(`definePlugin(main, { name: "a", description: "b" }, () => <Stack direction="diagonal" />);`, /diagonal/);
});

test("the wall in the types: no react, no app-side schema", () => {
  const react = check({ "/p/plugin.tsx": `import { useState } from "react";\nvoid useState;` });
  assert.ok(react.some((e) => /react/.test(e)), react.join("\n"));
  const object = check({ "/p/plugin.tsx": `import { t } from "thixo/schema";\nt.object({});` });
  assert.ok(object.some((e) => /object/.test(e)), object.join("\n"));
  const unknownScope = check({ "/p/plugin.tsx": `import { nothing } from "@app/sdk";\nvoid nothing;` });
  assert.ok(unknownScope.some((e) => /nothing/.test(e)));
});

test("services are typed", () => {
  const ok = check({
    "/p/plugin.tsx": `import { navigate, openModal, copyToClipboard, download, toast } from "thixo/services";
navigate("/todos/1"); const m = openModal(<span>hi</span>, { title: "x" }); m.close(); copyToClipboard("a").then(() => 1); download("a.txt", "x"); toast("done", { tone: "success" });`,
  });
  assert.deepEqual(ok, []);
});

