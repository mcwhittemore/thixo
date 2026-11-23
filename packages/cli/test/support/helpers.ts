import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompileResult, ThxError } from "thixo-thx/contract";
import { buildCompileEnv, collectApp, createThixo } from "thixo/server";
import type { Deps, NodeApi, ServerApi, ThxApi } from "../../src/deps.js";
import type { Io } from "../../src/io.js";
import type { ProjectPaths } from "../../src/project.js";
import { openProject } from "../../src/project.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(here, "..", "fixtures", "app");
const WORK = join(here, "..", "..", ".test-work");
let counter = 0;

/** A copy of the fixture app inside the repo, so `thixo` and React resolve from the workspace. `thixo/shell` is
 * pointed at a stand-in with a tsconfig, because the real shell is another package. */
export function workdir(): { root: string; paths: ProjectPaths; cleanup(): void } {
  const root = join(WORK, `${process.pid}-${++counter}`);
  mkdirSync(dirname(root), { recursive: true });
  cpSync(FIXTURE, root, { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "thixo/shell": [join(here, "fake-shell.tsx")] } } }),
  );
  return { root, paths: openProject(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export function testIo(cwd: string, env: NodeJS.ProcessEnv = {}): Io & { stdout: string[]; stderr: string[]; controller: AbortController } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const controller = new AbortController();
  return { cwd, env, stdout, stderr, controller, signal: controller.signal, out: (t) => stdout.push(t), err: (t) => stderr.push(t) };
}

export const FAKE_ERROR: ThxError = { file: "plugin.thx", line: 3, column: 7, code: "thx/no-global", message: "window does not exist.", hint: "Plugins cannot reach the page." };

/** Compiles any plugin whose plugin.thx says definePlugin, and fails the rest with a located error. */
export const fakeThx: ThxApi = {
  compile(files): CompileResult {
    const source = files["plugin.thx"] ?? "";
    if (/\bwindow\b/.test(source)) return { ok: false, errors: [FAKE_ERROR] };
    const slot = /definePlugin\(\s*(\w+)/.exec(source)?.[1] ?? "?";
    const id = /id:\s*"([^"]+)"/.exec(source)?.[1];
    return {
      ok: true,
      code: `export default function (rt) { return rt; } // ${slot}`,
      manifest: {
        slot,
        requiredEndpoints: [...source.matchAll(/import \{ (\w+) \} from "@app\/sdk"/g)].map((m) => m[1]),
        optionalEndpoints: [],
        annotates: [],
        data: { stores: {}, annotations: {} },
        schemaHash: "0".repeat(64),
        shellServices: [],
        addresses: [],
        loads: [],
        links: [],
        assets: {},
        libraries: [],
      },
      meta: { id, name: "Fake", description: "fake" },
      sourceHash: `hash-${Object.keys(files).sort().join(",")}-${source.length}`,
    };
  },
  verifyOutput: () => ({ ok: true }),
};

/** Serves a web handler from node:http. `thixo-node`'s `serve` is another package. */
export const fakeNode: NodeApi = {
  async serve(handler, options) {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const response = await handler(new Request(new URL(req.url ?? "/", `http://${req.headers.host}`), { method: req.method, headers, body: body.length ? body : undefined }));
      const out: Record<string, string> = {};
      response.headers.forEach((v, k) => (out[k] = v));
      res.writeHead(response.status, out);
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(options.port, options.hostname ?? "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))) };
  },
};

export interface DeployCall {
  plugins: string[];
  layout: Record<string, string>;
  deployment: string;
}

/** The real core server with a deploy that records its input. The registry's deploy is another package. */
export function fakeDeps(overrides: Partial<Deps> = {}): Deps & { deploys: DeployCall[] } {
  const deploys: DeployCall[] = [];
  const server: ServerApi = {
    collectApp,
    buildCompileEnv,
    createThixo(app, config) {
      const real = createThixo(app, config);
      return {
        fetch: real.fetch,
        services: {
          ...real.services,
          async deploy(input) {
            const call = input as typeof input & { deployment: string };
            deploys.push({ plugins: Object.keys(call.plugins), layout: call.layout, deployment: call.deployment });
            return {
              id: `rel_${deploys.length}`,
              deployment: call.deployment,
              plugins: Object.keys(call.plugins),
              layout: Object.fromEntries(Object.entries(call.layout).map(([slot, name]) => [slot, { plugin: name, number: 1 }])),
              createdAt: new Date().toISOString(),
            };
          },
        },
      };
    },
  };
  return { thx: async () => fakeThx, node: async () => fakeNode, server: async () => server, deploys, ...overrides };
}

export function exists(path: string): boolean {
  return existsSync(path);
}
