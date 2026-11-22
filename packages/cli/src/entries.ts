export interface ServerEntryInput {
  configFile: string;
  apiFiles: string[];
  slotsFile: string | null;
}

export interface ClientEntryInput {
  shellFile: string;
  libraries: { specifier: string; module: string }[];
}

const spec = (path: string) => JSON.stringify(path.split("\\").join("/"));

/** The module the server bundle is built from. It exports the config, the api modules and the slots module, and
 * `modules`, which is what `collectApp` takes. */
export function serverEntry(input: ServerEntryInput): string {
  const lines = [`import config from ${spec(input.configFile)};`];
  input.apiFiles.forEach((file, i) => lines.push(`import * as api${i} from ${spec(file)};`));
  if (input.slotsFile) lines.push(`import * as slotsModule from ${spec(input.slotsFile)};`);
  const api = `[${input.apiFiles.map((_, i) => `api${i}`).join(", ")}]`;
  lines.push(
    "export { config };",
    `export const api = ${api};`,
    `export const slots = ${input.slotsFile ? "slotsModule" : "{}"};`,
    `export const modules = ${input.slotsFile ? `[...api, slotsModule]` : "api"};`,
  );
  return `${lines.join("\n")}\n`;
}

/** The module the browser bundle is built from: the implementor's shell, mounted by Thixo's. Exposed libraries are
 * imported and handed to `mount` by specifier, so the shell can wrap them at the boundary (L3). */
export function clientEntry(input: ClientEntryInput): string {
  const lines = [`import App from ${spec(input.shellFile)};`, `import { mount } from "thixo/shell";`];
  input.libraries.forEach((lib, i) => lines.push(`import * as lib${i} from ${spec(lib.module)};`));
  if (input.libraries.length) {
    const entries = input.libraries.map((lib, i) => `${JSON.stringify(lib.specifier)}: lib${i}`).join(", ");
    lines.push(`mount(App, { libraries: { ${entries} } });`);
  } else {
    lines.push("mount(App);");
  }
  return `${lines.join("\n")}\n`;
}

export function indexHtml(options: { title: string; script: string; css?: string }): string {
  const css = options.css ? `\n    <link rel="stylesheet" href="${options.css}" />` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>${css}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${options.script}"></script>
  </body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
