// Q5 (vi): an ESM entry that statically imports a shared React chunk produced by esbuild code splitting.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
const el = document.createElement("div");
document.body.appendChild(el);
flushSync(() => createRoot(el).render(<b>esm react {React.version}</b>));
window.__r("loaded", el.textContent);
