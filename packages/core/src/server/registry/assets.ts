// Copy at build. A plugin's source may write out an outside address that loads something (`<img src="https://...">`).
// The compiler reports it and never fetches. This step fetches each one through the build adapter, stores the bytes
// by content hash with the version, and compiles again so the code loads the app's copy. The page a plugin runs in
// never fetches from an outside host because of something written in plugin source. Every build of a plugin's source
// goes through here: a deploy, the authoring agent's check and submit, `thixo build` and `thixo compile`.

import type { CompileEnv, CompileResult, SourceFiles, ThxError } from "thixo-thx/contract";
import type { AssetLimits, BuildAdapter, CodeAdapter, FetchedAsset } from "../../contract.js";
import { svgProblem } from "./svg-check.js";

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
  /** How long one build may spend copying, all its files together: 20 seconds. */
  buildMs: 20_000,
  /** How many files one build fetches at once. */
  concurrency: 4,
};

/** A length of time in words: "20 seconds", "0.3 seconds". */
export function inSeconds(ms: number): string {
  const s = ms / 1000;
  const text = Number.isInteger(s) ? String(s) : s >= 10 ? String(Math.round(s)) : s.toFixed(1).replace(/\.0$/, "");
  return `${text} ${text === "1" ? "second" : "seconds"}`;
}

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

/** Fetches through the adapter and checks what came back against the limits, whatever the adapter promised. */
async function copyOne(build: BuildAdapter, address: string, limits: AssetLimits): Promise<FetchedAsset> {
  const cache = copies.get(build) ?? new Map();
  copies.set(build, cache);
  const cached = cache.get(address);
  if (cached && cached.bytes.byteLength <= limits.maxBytes) return { ok: true, ...cached };
  let got: FetchedAsset;
  try {
    got = await build.fetchAsset!(address, limits);  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!got.ok) return got;
  const contentType = String(got.contentType).split(";")[0].trim().toLowerCase();
  if (!limits.types.includes(contentType)) return { ok: false, message: `it is served as ${contentType || "no type"}, and only images and fonts are copied (${limits.types.join(", ")}).` };
  if (!(got.bytes instanceof Uint8Array)) return { ok: false, message: "the fetch returned no bytes." };
  if (got.bytes.byteLength > limits.maxBytes) return { ok: false, message: `it is larger than the ${limits.maxBytes} bytes a plugin may still copy.` };
  if (got.bytes.byteLength === 0) return { ok: false, message: "it is empty." };
  if (contentType === "image/svg+xml") {
    const why = svgProblem(got.bytes);
    if (why) return { ok: false, message: why };
  }
  cache.set(address, { bytes: got.bytes, contentType });
  return { ok: true, bytes: got.bytes, contentType };
}

/** Options for one build. Tests shorten the deadline. */
export interface CopyOptions {
  /** How long the build may spend copying. Default `ASSET_LIMITS.buildMs`. */
  deadlineMs?: number;
}

/** Resolves to `fallback` when `signal` aborts first, so an adapter that ignores the signal can't hold the build. */
function orWhenAborted<T>(work: Promise<T>, signal: AbortSignal, fallback: () => T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback());
  return new Promise<T>((done) => {
    const stop = () => done(fallback());
    signal.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        done(value);
      },
      (error) => {
        signal.removeEventListener("abort", stop);
        done({ ok: false, message: error instanceof Error ? error.message : String(error) } as T);
      },
    );
  });
}

/** Builds a plugin's source the way the registry stores it: compile, copy every outside load, compile again with the
 * copies. A copy that fails is a build error. The compiled code names no outside address that loads.
 *
 * The copies share one deadline, a few run at once, and the first that fails stops the rest, so one build can't hold
 * the server for long however many slow addresses it names. */
export async function buildWithCopies(build: BuildAdapter, env: CompileEnv, files: SourceFiles, options: CopyOptions = {}): Promise<BuildOutcome> {
  const first = await build.build(files, env);
  if (!first.ok) return first;
  const loads = first.manifest.loads ?? [];
  if (!loads.length) return { ...first, assets: {} };

  if (!build.fetchAsset) {
    return { ok: false, errors: loads.map((address) => copyError(files, address, "this app's build adapter can't fetch files, so a plugin can't load anything from outside the app.")) };
  }
  if (loads.length > ASSET_LIMITS.files) {
    return { ok: false, errors: [copyError(files, loads[ASSET_LIMITS.files], `a plugin may load at most ${ASSET_LIMITS.files} outside files, and this one loads ${loads.length}.`)] };
  }
  const deadlineMs = options.deadlineMs ?? ASSET_LIMITS.buildMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const mapping: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  let total = 0;
  let next = 0;
  let failure: ThxError | null = null;
  const fail = (address: string, why: string) => {
    failure ??= copyError(files, address, why);
    controller.abort();
  };
  const outOfTime = (): FetchedAsset => ({ ok: false, message: `the build may spend ${inSeconds(deadlineMs)} copying all of a plugin's files, and it ran out of time.` });

  async function worker(): Promise<void> {
    while (!failure && next < loads.length) {
      const address = loads[next++];
      const room = ASSET_LIMITS.pluginBytes - total;
      if (room <= 0) return fail(address, `the plugin's files already come to the ${ASSET_LIMITS.pluginBytes} bytes one plugin may copy.`);
      const limits: AssetLimits = { maxBytes: Math.min(ASSET_LIMITS.fileBytes, room), types: Object.keys(ASSET_TYPES), signal: controller.signal };
      const got = await orWhenAborted(copyOne(build, address, limits), controller.signal, outOfTime);
      if (failure) return;
      if (!got.ok) return fail(address, got.message);
      const file = `${await sha256Bytes(got.bytes)}.${ASSET_TYPES[got.contentType]}`;
      mapping[address] = file;
      if (!assets[file]) total += got.bytes.byteLength;
      assets[file] = got.bytes;
      if (total > ASSET_LIMITS.pluginBytes) return fail(address, `it is larger than the ${ASSET_LIMITS.pluginBytes} bytes a plugin may still copy, with the plugin's other files.`);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(ASSET_LIMITS.concurrency, loads.length) }, worker));
  } finally {
    clearTimeout(timer);
  }
  if (failure) return { ok: false, errors: [failure] };

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
