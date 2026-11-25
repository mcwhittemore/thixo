import { compile, envOf } from "./compiler/compile.js";
import { sourceHash } from "./compiler/hash.js";
import { verifyOutput } from "./verify/verify-output.js";
import { WARM_UP_FILES, WARM_UP_OPTIONS } from "./compiler/warm-up.js";

// One compile while the module loads, so the engine has compiled the compiler before a host's first request. An edge
// worker runs this at startup, outside any request's time limit.
const warm = compile(WARM_UP_FILES, WARM_UP_OPTIONS);
if (!warm.ok) throw new Error(`the warm-up program does not compile: ${warm.errors.map((e) => e.message).join("; ")}`);

export { compile, envOf, verifyOutput, sourceHash };
export { LIB_THX_DTS } from "./compiler/lib-dts.js";
export { THIXO_DTS } from "./compiler/thixo-dts.js";
export { checkAddress } from "./compiler/emit.js";
export type * from "./contract.js";
