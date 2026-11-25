import { compile, envOf } from "./compiler/compile.js";
import { sourceHash } from "./compiler/hash.js";
import { verifyOutput } from "./verify/verify-output.js";

// One small compile while the module loads, so the engine has compiled the compiler before a host's first request.
// An edge worker runs this at startup, outside any request's time limit.
compile({
  "main.thx": 'import { useState, useFrame } from "thixo";\nexport default function W() {\n  const [t, setT] = useState(0);\n  useFrame((time) => setT(time));\n  return <svg width="10"><rect x={t} fill="red" transform={`rotate(${t})`} /></svg>;\n}\n',
});

export { compile, envOf, verifyOutput, sourceHash };
export { LIB_THX_DTS } from "./compiler/lib-dts.js";
export { THIXO_DTS } from "./compiler/thixo-dts.js";
export { checkAddress } from "./compiler/emit.js";
export type * from "./contract.js";
