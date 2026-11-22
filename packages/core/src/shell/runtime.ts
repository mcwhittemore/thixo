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

/** Imports a compiled plugin module by its address. The load reply's `code` carries a short-lived ticket for this
 * user and version (a personal plugin is served to its author only), so no token goes in the request and the page's
 * CSP can stay `script-src 'self'`. */
export async function importByAddress(url: string): Promise<CompiledModule> {
  return (await import(/* @vite-ignore */ /* webpackIgnore: true */ url)) as CompiledModule;
}
