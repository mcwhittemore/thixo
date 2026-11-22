import type { Release, SlotPath } from "../contract.js";
import type { SourceFiles } from "thixo-thx/contract";
import type { ServerContext } from "./context.js";

/** What a deploy takes: each default plugin's folder name and files, and the layout from the config. */
export interface DeployInput {
  plugins: Record<string, SourceFiles>;
  layout: Record<SlotPath, string>;
}

export type DeployResult = Release;

// Stub. Filled by the registry agent: build each folder, find or store a version by sourceHash, write a release.
export async function deploy(_ctx: ServerContext, _input: DeployInput): Promise<DeployResult> {
  throw new Error("deploy is not implemented yet");
}
