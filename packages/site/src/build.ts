import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { GALLERY } from "./gallery-entries.ts";
import { PROGRAMS_DIR, readProgram } from "./programs.ts";

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const gallery: Plugin = {
  name: "thixo-gallery",
  setup(b) {
    b.onResolve({ filter: /^thixo:gallery$/ }, () => ({ path: "gallery", namespace: "thixo-gallery" }));
    b.onLoad({ filter: /.*/, namespace: "thixo-gallery" }, () => ({
      contents: JSON.stringify(GALLERY.map((entry) => ({ ...entry, files: readProgram(entry.id) }))),
      loader: "json",
      watchDirs: [PROGRAMS_DIR],
    }));
  },
};

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
    plugins: [gallery],
    logLevel: "warning",
  });
  copyFileSync(here("./index.html"), `${outdir}/index.html`);
  copyFileSync(here("./site.css"), `${outdir}/assets/site.css`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
