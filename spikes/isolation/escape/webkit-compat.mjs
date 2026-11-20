// Playwright 1.65 speaks a newer WebKit protocol than the frozen macOS 14 WebKit build (2251) it installs:
// newPage fails with "Unknown setting: PushAPIEnabled". This drops that one call as the bundle loads (nothing
// on disk changes). The Push API plays no part in these tests. run.mjs imports this before playwright.
import Module from "node:module";
import fs from "node:fs";
const orig = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  if (filename.endsWith("playwright-core/lib/coreBundle.js")) {
    const src = fs.readFileSync(filename, "utf8").replace(/promises2\.push\(session\.send\("Page\.overrideSetting", \{ setting: "PushAPIEnabled"[^\n]*\n/, "\n");
    return module._compile(src, filename);
  }
  return orig.call(this, module, filename);
};
