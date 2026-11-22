import type { CreateRuntime } from "thixo-thx/contract";

export interface CompiledModule {
  default: (rt: unknown) => unknown;
}

/** thx's in-page runtime. Imported on first use, so the shell bundle carries it and a page with no plugins never
 * runs it. */
export async function defaultCreateRuntime(): Promise<CreateRuntime> {
  // @ts-ignore: thixo-thx/runtime is written by the thx package; its type is the contract's CreateRuntime.
  const runtime = (await import("thixo-thx/runtime")) as { createRuntime: CreateRuntime };
  return runtime.createRuntime;
}

/** Imports a compiled plugin module from its text. The text was fetched with the user's token (a personal plugin is
 * served to its author only), so it can't be imported by address: it goes through a blob address instead. */
export async function defaultLoadModule(text: string): Promise<CompiledModule> {
  const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  try {
    return (await import(/* @vite-ignore */ /* webpackIgnore: true */ url)) as CompiledModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}
