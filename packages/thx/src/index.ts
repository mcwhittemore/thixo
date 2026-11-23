import type { Compiler } from "./contract.js";
import { compile } from "./compiler/compile.js";
import { schemaHash, sourceHash } from "./compiler/hash.js";
import { verifyOutput } from "./verify/verify-output.js";

export { compile, verifyOutput, sourceHash, schemaHash };
export { LIB_THX_DTS } from "./compiler/lib-dts.js";
export { checkAddress } from "./compiler/emit.js";
export { ASSET_FILE } from "./runtime/allowlist.js";
export type * from "./contract.js";

export const compiler: Compiler = { compile, verifyOutput, sourceHash, schemaHash };
