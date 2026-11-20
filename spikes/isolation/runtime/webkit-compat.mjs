// Playwright 1.65 drives a newer WebKit protocol than the frozen macOS 14 WebKit build (2251) it installs here:
// newPage fails with "Unknown setting: PushAPIEnabled". This drops that one call at load time (nothing on disk is
// edited); the Push API is irrelevant to this spike. Import this before playwright.
import Module from "node:module";
const orig = Module._extensions[".js"];
let patched = 0;
Module._extensions[".js"] = function (module, filename) {
  if (filename.endsWith("playwright-core/lib/coreBundle.js")) {
    const fs = Module.createRequire(import.meta.url)("node:fs");
    let src = fs.readFileSync(filename, "utf8");
    src = src.replace(/promises2\.push\(session\.send\("Page\.overrideSetting", \{ setting: "PushAPIEnabled"[^\n]*\n/, () => { patched++; return "\n"; });
    return module._compile(src, filename);
  }
  return orig.call(this, module, filename);
};
export const webkitCompatPatched = () => patched;
