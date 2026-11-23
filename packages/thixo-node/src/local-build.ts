import { compile, verifyOutput } from "thixo-thx";
import type { Compiler } from "thixo-thx/contract";
import type { BuildAdapter } from "thixo/contract";
import { guardedFetch, type AssetFetch } from "./guarded-fetch.js";

export interface LocalBuildOptions {
  /** Copy at build: fetches an outside file a plugin's source loads. Default `guardedFetch()`, which refuses https
   * that leads inside the network. Tests pass a fake, so they never touch the network. */
  fetchAsset?: AssetFetch;
}

/** Compiles in this process, then checks the emitted code a second time before anything stores or serves it (P6). A
 * compiler can be passed for tests. Thixo's copy step calls `fetchAsset` for each outside file a plugin loads. */
export function localBuild(compiler: Pick<Compiler, "compile" | "verifyOutput"> = { compile, verifyOutput }, options: LocalBuildOptions = {}): BuildAdapter {
  const fetchAsset = options.fetchAsset ?? guardedFetch();
  return {
    async build(files, env) {
      const result = compiler.compile(files, env);
      if (!result.ok) return result;
      const verified = compiler.verifyOutput(result.code);
      if (verified.ok) return result;
      return {
        ok: false,
        errors: verified.errors.map((message) => ({
          file: "(output)",
          line: 0,
          column: 0,
          code: "thx/output-rejected",
          message,
        })),
      };
    },
    verify(code) {
      const verified = compiler.verifyOutput(code);
      return verified.ok ? { ok: true } : { ok: false, errors: verified.errors };
    },
    fetchAsset: (address, limits) => fetchAsset(address, limits),
  };
}
