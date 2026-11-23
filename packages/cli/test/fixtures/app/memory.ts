import type { Adapters, AuthoringBlock, AuthoringRefusal, Plugin, PluginVersion, Release } from "thixo/contract";

type GuardState = { refusals: AuthoringRefusal[]; blocks: Map<string, AuthoringBlock> };

function guard(): GuardState {
  const g = globalThis as { __thixoFixtureGuard?: GuardState };
  return (g.__thixoFixtureGuard ??= { refusals: [], blocks: new Map() });
}

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
    // The guard's records outlive one load of the bundle, as a database would: tests seed and read them here.
    async addRefusal(r: AuthoringRefusal) {
      guard().refusals.push(r);
    },
    async listRefusals(filter?: { user?: string; since?: string }) {
      return guard().refusals.filter((r) => (!filter?.user || r.user === filter.user) && (!filter?.since || r.at > filter.since));
    },
    async putAuthoringBlock(b: AuthoringBlock) {
      guard().blocks.set(b.user, b);
    },
    async getAuthoringBlock(user: string) {
      return guard().blocks.get(user) ?? null;
    },
    async listAuthoringBlocks() {
      return [...guard().blocks.values()];
    },
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
