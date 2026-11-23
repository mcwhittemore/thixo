// Copy at build. A plugin's source may write out an outside address that loads something (`<img src="https://...">`).
// The compiler reports it and never fetches. This step fetches each one through the build adapter, stores the bytes
// by content hash with the version, and compiles again so the code loads the app's copy. The page a plugin runs in
// never fetches from an outside host because of something written in plugin source. Every build of a plugin's source
// goes through here: a deploy, the authoring agent's check and submit, `thixo build` and `thixo compile`.

import type { CompileEnv, CompileResult, SourceFiles, ThxError } from "thixo-thx/contract";
import type { AssetLimits, BuildAdapter, CodeAdapter, FetchedAsset } from "../../contract.js";

/** Content types that may be copied, to the extension of the stored file. Images and fonts only. */
export const ASSET_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "font/ttf": "ttf",
  "font/otf": "otf",
};

const TYPE_OF_EXTENSION: Record<string, string> = Object.fromEntries(Object.entries(ASSET_TYPES).map(([type, ext]) => [ext, type]));

/** A stored file's name: its sha256 and the extension of its type. The same shape the runtime accepts. */
export const ASSET_FILE = /^([0-9a-f]{64})\.(png|jpg|gif|webp|avif|svg|woff|woff2|ttf|otf)$/;

/** How much one plugin version may copy. */
export const ASSET_LIMITS = {
  /** The most bytes one file may have: 2 MiB. */
  fileBytes: 2 * 1024 * 1024,
  /** The most bytes all of one version's files may have together: 8 MiB. */
  pluginBytes: 8 * 1024 * 1024,
  /** The most outside addresses one version may load. */
  files: 32,
};

/** A build that copied what it loads. `assets` is each stored file's name to its bytes, for `storeAssets`. */
export type BuiltPlugin = Extract<CompileResult, { ok: true }> & { assets: Record<string, Uint8Array> };
export type BuildOutcome = BuiltPlugin | Extract<CompileResult, { ok: false }>;

/** Copies already made in this process, by address, so `thixo dev` does not fetch a file again on every change. A
 * version is fixed once it is stored (U2), so a copy never needs to be fresher than the process. */
const copies = new WeakMap<object, Map<string, { bytes: Uint8Array; contentType: string }>>();

/** The code adapter key a stored file lives under. */
export function assetKey(file: string): string {
  const m = ASSET_FILE.exec(file);
  if (!m) throw new Error(`"${file}" is not the name of a copied file`);
  return `assets/${m[1]}`;
}

/** The content type a stored file is served with, from its name. */
export function assetType(file: string): string | undefined {
  const m = ASSET_FILE.exec(file);
  return m ? TYPE_OF_EXTENSION[m[2]] : undefined;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Where the address is written, so the error points the agent at the line. */
function whereIn(files: SourceFiles, address: string): { file: string; line: number; column: number } {
  for (const [file, text] of Object.entries(files)) {
    const at = text.indexOf(address);
    if (at < 0) continue;
    const before = text.slice(0, at).split("\n");
    return { file, line: before.length, column: before[before.length - 1].length + 1 };
  }
  return { file: "plugin.thx", line: 0, column: 0 };
}

function copyError(files: SourceFiles, address: string, why: string): ThxError {
  return {
    ...whereIn(files, address),
    code: "build/copy-failed",
    message: `Could not copy ${address} into the app: ${why}`,
    hint: "A plugin's images and fonts are copied into the app when it is built, so the page never loads them from outside. Use an https address that serves an image or a font directly, a `data:` address, or an image the app hands the plugin as a `Url`.",
  };
}

/** SVG served from the app must not run script, even opened on its own: the asset route sends a sandboxing CSP, and
 * this refuses one that tries at all, so the author hears about it at build. */
function scriptedSvg(bytes: Uint8Array): string | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).toLowerCase();
  if (/<script\b/.test(text)) return "the SVG has a <script> in it.";
  if (/<foreignobject\b/.test(text)) return "the SVG has a <foreignObject> in it.";
  if (/\son[a-z]+\s*=/.test(text)) return "the SVG has an event handler attribute in it.";
  if (/javascript:/.test(text)) return "the SVG has a javascript: address in it.";
  return null;
}

/** Fetches through the adapter and checks what came back against the limits, whatever the adapter promised. */
async function copyOne(build: BuildAdapter, address: string, limits: AssetLimits): Promise<FetchedAsset> {
  const cache = copies.get(build) ?? new Map();
  copies.set(build, cache);
  const cached = cache.get(address);
  if (cached && cached.bytes.byteLength <= limits.maxBytes) return { ok: true, ...cached };
  let got: FetchedAsset;
  try {
    got = await build.fetchAsset!(address, limits);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!got.ok) return got;
  const contentType = String(got.contentType).split(";")[0].trim().toLowerCase();
  if (!limits.types.includes(contentType)) return { ok: false, message: `it is served as ${contentType || "no type"}, and only images and fonts are copied (${limits.types.join(", ")}).` };
  if (!(got.bytes instanceof Uint8Array)) return { ok: false, message: "the fetch returned no bytes." };
  if (got.bytes.byteLength > limits.maxBytes) return { ok: false, message: `it is larger than the ${limits.maxBytes} bytes a plugin may still copy.` };
  if (got.bytes.byteLength === 0) return { ok: false, message: "it is empty." };
  if (contentType === "image/svg+xml") {
    const why = scriptedSvg(got.bytes);
    if (why) return { ok: false, message: why };
  }
  cache.set(address, { bytes: got.bytes, contentType });
  return { ok: true, bytes: got.bytes, contentType };
}

/** Builds a plugin's source the way the registry stores it: compile, copy every outside load, compile again with the
 * copies. A copy that fails is a build error. The compiled code names no outside address that loads. */
export async function buildWithCopies(build: BuildAdapter, env: CompileEnv, files: SourceFiles): Promise<BuildOutcome> {
  const first = await build.build(files, env);
  if (!first.ok) return first;
  const loads = first.manifest.loads ?? [];
  if (!loads.length) return { ...first, assets: {} };

  const errors: ThxError[] = [];
  if (!build.fetchAsset) {
    return { ok: false, errors: loads.map((address) => copyError(files, address, "this app's build adapter can't fetch files, so a plugin can't load anything from outside the app.")) };
  }
  if (loads.length > ASSET_LIMITS.files) {
    return { ok: false, errors: [copyError(files, loads[ASSET_LIMITS.files], `a plugin may load at most ${ASSET_LIMITS.files} outside files, and this one loads ${loads.length}.`)] };
  }
  const mapping: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  let total = 0;
  for (const address of loads) {
    const room = ASSET_LIMITS.pluginBytes - total;
    const got = await copyOne(build, address, { maxBytes: Math.min(ASSET_LIMITS.fileBytes, room), types: Object.keys(ASSET_TYPES) });
    if (!got.ok) {
      errors.push(copyError(files, address, got.message));
      continue;
    }
    const file = `${await sha256Bytes(got.bytes)}.${ASSET_TYPES[got.contentType]}`;
    mapping[address] = file;
    if (!assets[file]) total += got.bytes.byteLength;
    assets[file] = got.bytes;
  }
  if (errors.length) return { ok: false, errors };

  const second = await build.build(files, { ...env, assets: mapping });
  if (!second.ok) return second;
  const missing = (second.manifest.loads ?? []).filter((address) => second.manifest.assets?.[address] !== mapping[address]);
  if (missing.length) return { ok: false, errors: missing.map((address) => copyError(files, address, "the compiler did not use the copy.")) };
  return { ...second, assets };
}

/** Stores a build's copied files with the code adapter, each under its content hash. */
export async function storeAssets(code: CodeAdapter, assets: Record<string, Uint8Array>): Promise<void> {
  for (const [file, bytes] of Object.entries(assets)) await code.put(assetKey(file), bytes);
}

/** A stored file, only when it still matches its name. */
export async function readAsset(code: CodeAdapter, file: string): Promise<Uint8Array | null> {
  const bytes = await code.get(assetKey(file));
  if (!bytes) return null;
  if ((await sha256Bytes(bytes)) !== ASSET_FILE.exec(file)![1]) throw new Error(`What the code adapter holds for "${file}" is not what was stored`);
  return bytes;
}
