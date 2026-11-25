// Host modules for the tests: what a page might hand a program, plus probes that let a test see what got out. The
// built-in "thixo" module is the compiler's own; these sit beside it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { CompileOptions, ModuleDecl, SourceFiles } from "../../src/contract.js";

const HOOKS_DTS = `
export interface Query<O> { readonly data: O | undefined; readonly error: Error | undefined; readonly loading: boolean; readonly refresh: () => void; }
export declare function useQuery<O>(fn: () => Promise<O>): Query<O>;
export declare function useQuery<I, O>(fn: (input: I) => Promise<O>, input: I): Query<O>;
export declare function useCan(fn: (...args: never) => unknown): boolean;
`;

const UI_DTS = `
export declare const Stack: Component<{ direction?: "row" | "column"; children?: ThxNode }>;
export declare const Text: Component<{ tone?: "default" | "warning"; children?: ThxNode }>;
export declare const Button: Component<{ disabled?: boolean; onClick?: () => void; children?: ThxNode }>;
export declare const TextInput: Component<{ value: string; onChange: (value: string) => void; onSubmit?: () => void; placeholder?: string }>;
export declare const Checkbox: Component<{ checked: boolean; onChange: (checked: boolean) => void }>;
export declare const Avatar: Component<{ src: Url; alt: string }>;
export declare const tokens: { readonly space: number; readonly accent: string };
`;

const SERVICES_DTS = `
export declare function toast(text: string): void;
export declare function navigate(route: Url): void;
export declare function copyToClipboard(text: string): Promise<void>;
`;

const SDK_DTS = `
export interface Todo { readonly id: string; readonly title: string; readonly done: boolean; }
export interface Person { readonly id: string; readonly name: string; readonly avatar: Url; }
export declare function listTodos(): Promise<Todo[]>;
export declare function getTodo(input: { id: string }): Promise<Todo>;
export declare function createTodo(input: { title: string }): Promise<Todo>;
export declare function updateTodo(input: { id: string; title?: string; done?: boolean }): Promise<Todo>;
export declare function deleteTodo(input: { id: string }): Promise<void>;
export declare function listAssignees(): Promise<{ todoId: string; name: string }[]>;
export declare function listPeople(): Promise<Person[]>;
`;

const CHARTS_DTS = `
export declare const Sparkline: Component<{ values: readonly number[] }>;
export declare function mean(values: readonly number[]): number;
`;

export function testModules(): Record<string, ModuleDecl> {
  return {
    "@app/hooks": { dts: HOOKS_DTS },
    "@app/ui": { dts: UI_DTS },
    "@app/services": { dts: SERVICES_DTS },
    "@app/sdk": { dts: SDK_DTS },
    "@app/charts": { dts: CHARTS_DTS },
    "@app/probe": { dts: "export declare function leak(value: unknown): void;" },
  };
}

export function testOptions(overrides: CompileOptions = {}): CompileOptions {
  return { modules: testModules(), ...overrides };
}

export function readProgram(name: string): SourceFiles {
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
