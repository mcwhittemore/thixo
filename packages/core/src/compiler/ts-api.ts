// The only place the compiler reaches for TypeScript's JS API. Everything else in packages/thx imports `ts` from here.
// The package is an npm alias for the newest release that still ships the JS API (6.x); TypeScript 7 does not.
// Moving to the 7.x API later means changing this file and the call sites' small API differences, not the imports.

import ts from "typescript-js-api";

export default ts;
export type {
  CompilerOptions, Program, TypeChecker, SourceFile, Node, Diagnostic, CompilerHost,
} from "typescript-js-api";
