// Writes dist/arena/page.bundle.js, the arena page's script, so the published arena needs neither esbuild nor React.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundlePage } from "./dist/arena/bundle-page.js";

const entry = fileURLToPath(new URL("./dist/arena/page.js", import.meta.url));
writeFileSync(new URL("./dist/arena/page.bundle.js", import.meta.url), await bundlePage(entry, []));
