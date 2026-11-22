import type { Adapters, Plugin, PluginVersion, Release } from "thixo/contract";

export function memoryAdapters(): Adapters & { close(): void; migrations: number } {
  const plugins: Plugin[] = [];
  const versions: PluginVersion[] = [];
  let release: Release | null = null;
  const state = { migrations: 0 };
  const data = {
    async migrate() {
      state.migrations++;
    },
    async listPlugins() {
      return plugins;
    },
    async getPlugin(id: string) {
      return plugins.find((p) => p.id === id) ?? null;
    },
    async listVersions(id: string) {
      return versions.filter((v) => v.plugin === id);
    },
    async latestRelease() {
      return release;
    },
    async recallUser() {
      return null;
    },
    async rememberUser() {},
  };
  return {
    code: { async put() {}, async get() { return null; }, async openChange() { return { where: "" }; } },
    data: data as unknown as Adapters["data"],
    build: { async build() { return { ok: false, errors: [] }; } },
    close() {},
    get migrations() {
      return state.migrations;
    },
  };
}
