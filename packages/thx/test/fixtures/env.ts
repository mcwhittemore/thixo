// A CompileEnv for the todo example. The module declarations are this package's own test doubles: core writes the
// real ones.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CompileEnv, SourceFiles } from "../../src/contract.js";

const PLUGIN_DTS = `
export interface SlotRef<C, E> { readonly __slot: never; readonly __context?: C; readonly __emits?: E; }
export interface PluginRef { readonly __plugin: never; }
export type Emit<E> = { readonly [K in keyof E]: (payload: E[K]) => void };
export declare function definePlugin<C, E>(
  slot: SlotRef<C, E>,
  meta: { id?: string; name: string; description?: string },
  component: (props: { context: C; emit: Emit<E> }) => ThxNode,
): PluginRef;
export declare function useState<T>(initial: T): [T, (next: T) => void];
export declare function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
export declare function useEffect(fn: () => void, deps?: readonly unknown[]): void;
export interface Query<O> { readonly data: O | undefined; readonly error: Error | undefined; readonly loading: boolean; readonly refresh: () => void; }
export declare function useQuery<O>(endpoint: () => Promise<O>): Query<O>;
export declare function useQuery<I, O>(endpoint: (input: I) => Promise<O>, input: I): Query<O>;
export declare function useCan(endpoint: (...args: never) => unknown): boolean;
export interface Annotation<F> { readonly __annotation: F; }
export interface Store<F> { readonly __store: F; }
export declare function useAnnotation<F>(decl: Annotation<F>, id: string): [Partial<F> | undefined, (patch: Partial<F>) => void];
export declare function useStore<F>(decl: Store<F>): [Partial<F> | undefined, (patch: Partial<F>) => void];
export declare function css(style: ThxCss): string;
export declare const ChildSlot: Component<{ is: SlotRef<unknown, unknown>; context?: unknown }>;
`;

const DATA_DTS = `
import type { Annotation, Store } from "thixo/plugin";
import type { Field } from "thixo/schema";
import type { RecordRef } from "@app/sdk";
export declare function annotate<R, F>(record: RecordRef<R>, fields: { [K in keyof F]: Field<F[K]> }): Annotation<F>;
export declare function store<F>(name: string, decl: { fields: { [K in keyof F]: Field<F[K]> } }): Store<F>;
`;

const SCHEMA_DTS = `
export interface Field<T> { readonly __field: T; }
export declare const t: {
  string(): Field<string>;
  number(): Field<number>;
  boolean(): Field<boolean>;
  date(): Field<Date>;
  url(): Field<Url>;
  array<T>(of: Field<T>): Field<T[]>;
};
`;

const UI_DTS = `
export declare const Stack: Component<{ direction?: "row" | "column"; children?: ThxNode }>;
export declare const Text: Component<{ tone?: "default" | "warning"; children?: ThxNode }>;
export declare const Button: Component<{ disabled?: boolean; onClick?: () => void; children?: ThxNode }>;
export declare const TextInput: Component<{ value: string; onChange: (value: string) => void; onSubmit?: () => void; placeholder?: string }>;
export declare const NumberInput: Component<{ label?: string; value?: number; onChange: (value: number) => void }>;
export declare const DateInput: Component<{ label?: string; value?: Date; onChange: (value: Date) => void }>;
export declare const Checkbox: Component<{ checked: boolean; onChange: (checked: boolean) => void }>;
export declare const Avatar: Component<{ src: Url; alt: string }>;
export declare const tokens: { readonly space: number; readonly accent: string };
`;

const SERVICES_DTS = `
export declare function toast(text: string): void;
export declare function navigate(route: Url): void;
export declare function copyToClipboard(text: string): Promise<void>;
`;

const SDK_TYPES = `
export interface RecordRef<R> { readonly __record: R; }
export interface Todo { readonly id: string; readonly title: string; readonly done: boolean; }
export declare const Todo: RecordRef<Todo>;
export interface Person { readonly id: string; readonly name: string; readonly avatar: Url; }
export declare const Person: RecordRef<Person>;
`;

const ENDPOINTS = `
export declare function listTodos(): Promise<Todo[]>;
export declare function getTodo(input: { id: string }): Promise<Todo>;
export declare function createTodo(input: { title: string }): Promise<Todo>;
export declare function updateTodo(input: { id: string; title?: string; done?: boolean }): Promise<Todo>;
export declare function deleteTodo(input: { id: string }): Promise<void>;
export declare function listAssignees(): Promise<{ todoId: string; name: string }[]>;
export declare function listPeople(): Promise<Person[]>;
`;

const SLOTS_DTS = `
import type { SlotRef } from "thixo/plugin";
export declare const main: SlotRef<{}, { select: { todoId: string } }>;
export declare const todoDetail: SlotRef<{ todoId: string }, {}>;
export declare const todoRow: SlotRef<{ todoId: string }, {}>;
`;

const CHARTS_DTS = `
export declare const Sparkline: Component<{ values: readonly number[] }>;
export declare function mean(values: readonly number[]): number;
`;

export function todoEnv(overrides: Partial<CompileEnv> = {}): CompileEnv {
  return {
    modules: {
      "thixo/plugin": { dts: PLUGIN_DTS },
      "thixo/ui": { dts: UI_DTS },
      "thixo/data": { dts: DATA_DTS },
      "thixo/schema": { dts: SCHEMA_DTS },
      "thixo/services": { dts: SERVICES_DTS },
      "@app/sdk": { dts: SDK_TYPES + ENDPOINTS },
      "@app/sdk/optional": { dts: `import type { Todo, Person } from "@app/sdk";\n${ENDPOINTS}` },
      "@app/slots": { dts: SLOTS_DTS },
      "@app/charts": { dts: CHARTS_DTS },
      "@app/probe": { dts: "export declare function leak(value: unknown): void;" },
    },
    endpoints: {
      listTodos: { scopes: ["todos.read"] },
      getTodo: { scopes: ["todos.read"] },
      createTodo: { scopes: ["todos.read", "todos.write"] },
      updateTodo: { scopes: ["todos.read", "todos.write"] },
      deleteTodo: { scopes: ["todos.read", "todos.delete"] },
      listAssignees: { scopes: ["todos.read", "people.read"] },
      listPeople: { scopes: ["people.read"] },
    },
    records: { Todo: { name: "todo", read: ["todos.read"] }, Person: { name: "person", read: ["people.read"] } },
    slots: { main: { name: "main" }, todoDetail: { name: "todo-detail" }, todoRow: { name: "todo-row" } },
    services: ["navigate", "openModal", "copyToClipboard", "download", "toast"],
    libraries: ["@app/charts"],
    addressHosts: [],
    ...overrides,
  };
}

export function readPlugin(name: string): SourceFiles {
  const root = join(import.meta.dirname, name);
  const out: SourceFiles = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".thx")) out[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}
