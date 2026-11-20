// Second entry so esbuild splits React into a shared chunk.
import React from "react";
import { createRoot } from "react-dom/client";
createRoot(document.body).render(<i>b {React.version}</i>);
