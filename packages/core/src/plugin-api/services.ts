/** Each name a plugin imports from `thixo/services` is a shell service in its manifest (S8). */
export const SERVICE_NAMES = ["navigate", "openModal", "copyToClipboard", "download", "toast"] as const;

export const SERVICES_DTS = `// thixo/services, for plugins. Each one you import is listed in the plugin's summary, because it asks the shell to
// do something outside the plugin's box (S8).

export {};

/** Where the shell sends the user next: a path inside the app, such as "/todos/42". An outside address can't be built. */
export function navigate(path: string): void;

/** Shows content in a dialog over the app. close() dismisses it. */
export function openModal(content: ThxNode, options?: { title?: string }): { close(): void };

/** Puts text on the clipboard. Rejects if the user's browser refuses. */
export function copyToClipboard(text: string): Promise<void>;

/** Saves a file the plugin made, such as an export. mimeType defaults to text/plain. */
export function download(filename: string, content: string, mimeType?: string): void;

/** A short message that goes away by itself. tone defaults to "info". */
export function toast(message: string, options?: { tone?: "info" | "success" | "warning" | "danger" }): void;
`;
