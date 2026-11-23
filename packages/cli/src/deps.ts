import type { CompileEnv, CompileResult, SourceFiles } from "thixo-thx/contract";
import type { Thixo } from "thixo/server";
import type { AppDefinition, BuildAdapter, ThixoConfig } from "thixo/contract";
import { CliError, messageOf } from "./errors.js";

/** What the CLI uses from `thixo-thx`. */
export interface ThxApi {
  compile(files: SourceFiles, env: CompileEnv): CompileResult;
  verifyOutput(code: string): { ok: true } | { ok: false; errors: string[] };
}

export interface Served {
  url: string;
  close(): Promise<void>;
}

/** What the CLI uses from `thixo-node`. */
export interface NodeApi {
  serve(handler: (request: Request) => Promise<Response>, options: { port: number; hostname?: string }): Promise<Served>;
}

/** What the CLI uses from `thixo/server`. */
export interface ServerApi {
  createThixo(app: AppDefinition, config: ThixoConfig): Thixo;
  collectApp(modules: Record<string, unknown>[], config: Pick<ThixoConfig, "libraries">): AppDefinition;
  buildCompileEnv(app: AppDefinition, config: ThixoConfig): CompileEnv;
  /** Copy at build: the build step every plugin goes through, which fetches what the source loads from outside and
   * compiles again with the copies. Optional so a fake server can leave it out; then the CLI compiles directly. */
  buildWithCopies?(build: BuildAdapter, env: CompileEnv, files: SourceFiles): Promise<CompileResult & { assets?: Record<string, Uint8Array> }>;
  /** Every slot path a layout can name. Optional so a fake server can leave it out. */
  slotPaths?(slots: AppDefinition["slots"]): string[];
  /** What the registry tells a user about a manifest: its summary and scopes. Optional, as above. */
  describeManifest?(
    app: AppDefinition,
    manifest: import("thixo-thx/contract").Manifest,
  ): { summary: string[]; requiredScopes: string[]; optionalScopes: string[]; scopeLabels?: Record<string, string> };
}

/** The three packages the CLI calls into. Each is loaded when first needed, so a command that does not need one
 * works without it, and tests pass fakes. */
export interface Deps {
  thx(): Promise<ThxApi>;
  node(): Promise<NodeApi>;
  server(): Promise<ServerApi>;
}

async function load<T>(specifier: string, why: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch (error) {
    throw new CliError(`Could not load ${specifier}, which ${why}: ${messageOf(error)}\nRun \`npm install\` and \`npm run build\` in the Thixo checkout.`);
  }
}

export const realDeps: Deps = {
  thx: () => load<ThxApi>("thixo-thx", "compiles plugins"),
  node: () => load<NodeApi>("thixo-node", "serves the app"),
  server: () => load<ServerApi>("thixo/server", "runs the app"),
};
