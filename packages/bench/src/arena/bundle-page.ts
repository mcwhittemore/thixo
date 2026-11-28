// Bundles the arena page's script with React and @thixo/react into one browser script. The build runs it once and
// writes `page.bundle.js`; running from source, the arena runs it on start.

export async function bundlePage(entry: string, conditions: string[]): Promise<string> {
  const { build } = await import("esbuild");
  const out = await build({ entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", define: { "process.env.NODE_ENV": '"production"' }, conditions, logLevel: "silent" });
  return out.outputFiles[0].text;
}
