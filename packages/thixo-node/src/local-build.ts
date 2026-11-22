import { compile, verifyOutput } from "thixo-thx";
import type { Compiler } from "thixo-thx/contract";
import type { BuildAdapter } from "thixo/contract";

/** Compiles in this process, then checks the emitted code a second time before anything stores or serves it (P6). A
 * compiler can be passed for tests. */
export function localBuild(compiler: Pick<Compiler, "compile" | "verifyOutput"> = { compile, verifyOutput }): BuildAdapter {
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
  };
}
