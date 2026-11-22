import type { Manifest } from "thixo-thx/contract";
import { SERVICE_NAMES } from "../plugin-api/services.js";
import { ThixoRefused } from "./refused.js";

export type Tone = "info" | "success" | "warning" | "danger";

/** What the shell does on a plugin's behalf (S8). Each call has already been checked against the manifest. */
export interface ShellServiceHost {
  /** The app's origin, such as `https://app.example.com`. */
  origin: string;
  navigate(path: string): void;
  /** Shows `content` in a shell-owned dialog. Returns what closes it. */
  openModal(content: unknown, options: { title?: string; pluginName: string; scopeClass: string }): () => void;
  copyToClipboard(text: string): Promise<void>;
  download(file: { name: string; content: string; mimeType: string }): void;
  toast(message: string, tone: Tone): void;
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** A path inside the app, or a refusal: same origin, path only, never a scheme or another host (P8, S8). Returns the
 * path, query and hash as the URL parser normalises them. */
export function safeAppPath(path: unknown, origin: string): string {
  if (typeof path !== "string") throw new ThixoRefused("navigate", "the path must be a string");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || CONTROL.test(path)) {
    throw new ThixoRefused("navigate", `only a path inside the app, starting with a single "/", is allowed: ${JSON.stringify(path.slice(0, 80))}`);
  }
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    throw new ThixoRefused("navigate", "the path does not parse");
  }
  if (url.origin !== new URL(origin).origin) throw new ThixoRefused("navigate", "the path leaves the app");
  return url.pathname + url.search + url.hash;
}

const MIME_TYPES = new Set(["text/plain", "text/csv", "text/markdown", "application/json"]);

/** A download's type: one of a few that a browser never runs or renders as a page. Anything else is text/plain. */
export function safeMimeType(mimeType: unknown): string {
  const base = typeof mimeType === "string" ? mimeType.split(";")[0].trim().toLowerCase() : "";
  return `${MIME_TYPES.has(base) ? base : "text/plain"};charset=utf-8`;
}

/** A file name with no path, no control or reserved characters, no leading dots, and at most 100 characters. */
export function safeFileName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*%]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 100);
  return cleaned || "download.txt";
}

export interface ServiceOptions {
  manifest: Manifest;
  host: ShellServiceHost;
  pluginName: string;
  scopeClass: string;
  signal: AbortSignal;
}

/** The functions of `thixo/services`, unwrapped. Every one refuses unless the manifest lists it (S8), and every one
 * refuses once the plugin has stopped (P7). */
export function createServices(options: ServiceOptions) {
  const { manifest, host, pluginName, scopeClass, signal } = options;
  const listed = new Set(manifest.shellServices);
  const check = (name: (typeof SERVICE_NAMES)[number]) => {
    if (signal.aborted) throw new ThixoRefused(name, "the plugin has stopped");
    if (!listed.has(name)) throw new ThixoRefused(name, "it is not in the plugin version's manifest");
  };
  const closers = new Set<() => void>();
  signal.addEventListener("abort", () => {
    for (const close of closers) close();
    closers.clear();
  });
  return {
    navigate(path: unknown): void {
      check("navigate");
      host.navigate(safeAppPath(path, host.origin));
    },
    openModal(content: unknown, options?: { title?: unknown }): { close(): void } {
      check("openModal");
      const title = typeof options?.title === "string" ? options.title.slice(0, 200) : undefined;
      const closeModal = host.openModal(content, { title, pluginName, scopeClass });
      const close = () => {
        if (closers.delete(close)) closeModal();
      };
      closers.add(close);
      return { close };
    },
    async copyToClipboard(text: unknown): Promise<void> {
      check("copyToClipboard");
      if (typeof text !== "string") throw new ThixoRefused("copyToClipboard", "the text must be a string");
      await host.copyToClipboard(text);
    },
    download(filename: unknown, content: unknown, mimeType?: unknown): void {
      check("download");
      if (typeof content !== "string") throw new ThixoRefused("download", "the content must be a string");
      host.download({ name: safeFileName(filename), content, mimeType: safeMimeType(mimeType) });
    },
    toast(message: unknown, options?: { tone?: unknown }): void {
      check("toast");
      const tone: Tone = options?.tone === "success" || options?.tone === "warning" || options?.tone === "danger" ? options.tone : "info";
      host.toast(String(message).slice(0, 500), tone);
    },
  };
}
