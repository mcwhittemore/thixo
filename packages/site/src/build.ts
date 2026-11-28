import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export async function buildSite(outdir: string = here("../dist")): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  await build({
    entryPoints: [here("./main.tsx")],
    outfile: `${outdir}/assets/main.js`,
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    conditions: ["thixo-source"],
    jsx: "automatic",
    loader: { ".thx": "text" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  copyFileSync(here("./index.html"), `${outdir}/index.html`);
  copyFileSync(here("./site.css"), `${outdir}/assets/site.css`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
