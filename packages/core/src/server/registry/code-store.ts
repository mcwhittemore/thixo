import type { SourceFiles } from "thixo-thx/contract";
import type { ServerContext } from "../context.js";
import { canonicalJson, sha256Hex } from "./hash.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Source and compiled code are stored under keys made from their own content, so equal content is stored once and
 * a stored object that was changed afterwards no longer matches its key. */
export async function storeSource(ctx: ServerContext, files: SourceFiles): Promise<string> {
  const text = canonicalJson(files);
  const key = `source/${await sha256Hex(text)}`;
  await ctx.adapters.code.put(key, encoder.encode(text));
  return key;
}

export async function storeCompiled(ctx: ServerContext, code: string): Promise<string> {
  const key = `compiled/${await sha256Hex(code)}`;
  await ctx.adapters.code.put(key, encoder.encode(code));
  return key;
}

async function readChecked(ctx: ServerContext, key: string): Promise<string> {
  const bytes = await ctx.adapters.code.get(key);
  if (!bytes) throw new Error(`The code adapter has nothing under "${key}"`);
  const text = decoder.decode(bytes);
  const expected = key.slice(key.indexOf("/") + 1);
  if ((await sha256Hex(text)) !== expected) throw new Error(`What the code adapter holds under "${key}" is not what was stored`);
  return text;
}

export async function readSource(ctx: ServerContext, key: string): Promise<SourceFiles> {
  return JSON.parse(await readChecked(ctx, key)) as SourceFiles;
}

/** Compiled code is only returned when it still matches its key and, where the build adapter can say, still passes
 * the output check. Nothing that did not come from `build` is stored under a compiled key (P7). */
export async function readCompiled(ctx: ServerContext, key: string): Promise<string> {
  const code = await readChecked(ctx, key);
  const verdict = await ctx.adapters.build.verify?.(code);
  if (verdict && !verdict.ok) throw new Error(`Stored code "${key}" failed verifyOutput: ${verdict.errors.join("; ")}`);
  return code;
}
