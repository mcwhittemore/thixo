export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out(text: string): void;
  err(text: string): void;
  /** Long-running commands (`dev`, `start`) stop when this aborts. */
  signal?: AbortSignal;
}

export function processIo(): Io {
  const controller = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"] as const) process.once(name, () => controller.abort());
  return {
    cwd: process.cwd(),
    env: process.env,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    signal: controller.signal,
  };
}

/** Resolves when the signal aborts. */
export function untilAborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
