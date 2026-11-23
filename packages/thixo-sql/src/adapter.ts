import type {
  AuthoringBlock,
  AuthoringRefusal,
  DataAdapter,
  DataTarget,
  Fields,
  Plugin,
  PluginId,
  PluginVersion,
  PluginVersionRef,
  Release,
  SlotPath,
  User,
  UserId,
} from "thixo/contract";
import type { SqlDriver, SqlExecutor, SqlParam, SqlRow } from "./driver.js";
import { decodeValue, encodeValue } from "./json.js";
import { SCHEMA_VERSION, STATEMENTS } from "./schema.js";

/** Bound parameters per statement stay under D1's limit of 100. */
const PARAM_BUDGET = 90;

interface Key {
  kind: "store" | "annotation";
  scope: string;
  bucket: string;
  id: string;
}

/** A store record belongs to its owner (D2). An annotation belongs to a group, or to everyone (A11): the `g:`
 * prefix keeps a group named "" apart from no group. */
function keyOf(target: DataTarget): Key {
  if (target.kind === "store") return { kind: "store", scope: target.store, bucket: target.owner, id: target.id };
  return {
    kind: "annotation",
    scope: target.record,
    bucket: target.group === null ? "" : `g:${target.group}`,
    id: target.id,
  };
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

function json(value: unknown): string {
  return JSON.stringify(value);
}

function toPlugin(row: SqlRow): Plugin {
  const plugin: Plugin = {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    author: row.author as string,
    visibility: row.visibility as Plugin["visibility"],
    readsParentData: Number(row.reads_parent_data) === 1,
  };
  if (row.forked_plugin !== null && row.forked_plugin !== undefined) {
    plugin.forkedFrom = { plugin: row.forked_plugin as string, number: Number(row.forked_number) };
  }
  return plugin;
}

function toVersion(row: SqlRow): PluginVersion {
  return {
    plugin: row.plugin as string,
    number: Number(row.number),
    source: row.source as string,
    sourceHash: row.source_hash as string,
    compiled: row.compiled as string,
    manifest: JSON.parse(row.manifest as string),
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
  };
}

function toRelease(row: SqlRow): Release {
  return {
    id: row.id as string,
    deployment: row.deployment as string,
    plugins: JSON.parse(row.plugins as string),
    layout: JSON.parse(row.layout as string),
    createdAt: row.created_at as string,
  };
}

function toRefusal(row: SqlRow): AuthoringRefusal {
  const refusal: AuthoringRefusal = {
    id: row.id as string,
    user: row.user_id as string,
    conversation: (row.conversation as string | null) ?? null,
    category: row.category as AuthoringRefusal["category"],
    reason: row.reason as string,
    trigger: row.trigger_text as string,
    from: row.origin as AuthoringRefusal["from"],
    source: row.source as AuthoringRefusal["source"],
    at: row.created_at as string,
  };
  if (row.quote !== null && row.quote !== undefined) refusal.quote = row.quote as string;
  return refusal;
}

function toBlock(row: SqlRow): AuthoringBlock {
  const block: AuthoringBlock = {
    user: row.user_id as string,
    at: row.blocked_at as string,
    reason: row.reason as string,
    refusals: JSON.parse(row.refusals as string),
  };
  if (row.lifted_at !== null && row.lifted_at !== undefined) block.liftedAt = row.lifted_at as string;
  if (row.lifted_by !== null && row.lifted_by !== undefined) block.liftedBy = row.lifted_by as string;
  return block;
}

function isConflict(error: unknown): boolean {
  return /unique|constraint|duplicate/i.test(error instanceof Error ? error.message : String(error));
}

const targetId = (key: Key) => `${key.kind}\u0000${key.scope}\u0000${key.bucket}\u0000${key.id}`;

export function sqlDataAdapter(driver: SqlDriver): DataAdapter {
  async function readRows(db: SqlExecutor, keys: Key[], chain: PluginId[]): Promise<SqlRow[]> {
    const size = Math.max(1, Math.floor((PARAM_BUDGET - chain.length) / 4));
    const rows: SqlRow[] = [];
    for (let i = 0; i < keys.length; i += size) {
      const slice = keys.slice(i, i + size);
      const where = slice.map(() => "(kind = ? AND scope = ? AND bucket = ? AND id = ?)").join(" OR ");
      const params: SqlParam[] = [];
      for (const key of slice) params.push(key.kind, key.scope, key.bucket, key.id);
      params.push(...chain);
      rows.push(
        ...(await db.all(
          `SELECT kind, scope, bucket, id, plugin, field, value FROM thixo_data
           WHERE (${where}) AND plugin IN (${marks(chain.length)})`,
          params,
        )),
      );
    }
    return rows;
  }

  /** The nearest layer's value for each field, from every layer's rows. */
  function flatten(rows: SqlRow[], chain: PluginId[]): Fields {
    const rank = new Map(chain.map((id, index) => [id, index]));
    const best = new Map<string, { rank: number; value: string }>();
    for (const row of rows) {
      const r = rank.get(row.plugin as string);
      if (r === undefined) continue;
      const field = row.field as string;
      const held = best.get(field);
      if (!held || r < held.rank) best.set(field, { rank: r, value: row.value as string });
    }
    const fields: Fields = {};
    for (const [field, { value }] of best) fields[field] = decodeValue(value);
    return fields;
  }

  async function readTargets(targets: DataTarget[], chain: PluginId[]): Promise<Fields[]> {
    if (chain.length === 0 || targets.length === 0) return targets.map(() => ({}));
    const keys = targets.map(keyOf);
    const unique = [...new Map(keys.map((key) => [targetId(key), key])).values()];
    const rows = await readRows(driver, unique, chain);
    const grouped = new Map<string, SqlRow[]>();
    for (const row of rows) {
      const id = targetId(row as unknown as Key);
      const list = grouped.get(id);
      if (list) list.push(row);
      else grouped.set(id, [row]);
    }
    return keys.map((key) => flatten(grouped.get(targetId(key)) ?? [], chain));
  }

  return {
    async migrate() {
      await driver.batch([
        ...STATEMENTS.map((sql) => ({ sql })),
        { sql: `INSERT INTO thixo_schema (id, version) VALUES (1, ?) ON CONFLICT (id) DO NOTHING`, params: [SCHEMA_VERSION] },
      ]);
    },

    async putPlugin(plugin) {
      await driver.run(
        `INSERT INTO thixo_plugins (id, name, description, author, visibility, forked_plugin, forked_number, reads_parent_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
           author = excluded.author, visibility = excluded.visibility, forked_plugin = excluded.forked_plugin,
           forked_number = excluded.forked_number, reads_parent_data = excluded.reads_parent_data`,
        [
          plugin.id,
          plugin.name,
          plugin.description,
          plugin.author,
          plugin.visibility,
          plugin.forkedFrom?.plugin ?? null,
          plugin.forkedFrom?.number ?? null,
          plugin.readsParentData ? 1 : 0,
        ],
      );
    },

    async getPlugin(id) {
      const rows = await driver.all(`SELECT * FROM thixo_plugins WHERE id = ?`, [id]);
      return rows[0] ? toPlugin(rows[0]) : null;
    },

    async listPlugins(filter) {
      const where: string[] = [];
      const params: SqlParam[] = [];
      if (filter?.visibility) {
        where.push("visibility = ?");
        params.push(filter.visibility);
      }
      if (filter?.author) {
        where.push("author = ?");
        params.push(filter.author);
      }
      const rows = await driver.all(
        `SELECT * FROM thixo_plugins ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY name, id`,
        params,
      );
      return rows.map(toPlugin);
    },

    async addVersion(version) {
      let last: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const rows = await driver.all(
            `INSERT INTO thixo_versions (plugin, number, source, source_hash, compiled, manifest, created_by, created_at)
             SELECT ?, COALESCE(MAX(number), 0) + 1, ?, ?, ?, ?, ?, ? FROM thixo_versions WHERE plugin = ?
             RETURNING *`,
            [
              version.plugin,
              version.source,
              version.sourceHash,
              version.compiled,
              json(version.manifest),
              version.createdBy,
              version.createdAt,
              version.plugin,
            ],
          );
          return toVersion(rows[0]);
        } catch (error) {
          if (!isConflict(error)) throw error;
          last = error;
        }
      }
      throw last;
    },

    async getVersion(ref) {
      const rows = await driver.all(`SELECT * FROM thixo_versions WHERE plugin = ? AND number = ?`, [ref.plugin, ref.number]);
      return rows[0] ? toVersion(rows[0]) : null;
    },

    async listVersions(plugin) {
      const rows = await driver.all(`SELECT * FROM thixo_versions WHERE plugin = ? ORDER BY number`, [plugin]);
      return rows.map(toVersion);
    },

    async findVersionByHash(plugin, sourceHash) {
      const rows = await driver.all(
        `SELECT * FROM thixo_versions WHERE plugin = ? AND source_hash = ? ORDER BY number LIMIT 1`,
        [plugin, sourceHash],
      );
      return rows[0] ? toVersion(rows[0]) : null;
    },

    async putRelease(release) {
      await driver.batch([
        { sql: `DELETE FROM thixo_releases WHERE id = ?`, params: [release.id] },
        {
          sql: `INSERT INTO thixo_releases (id, seq, deployment, plugins, layout, created_at)
                SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ? FROM thixo_releases`,
          params: [release.id, release.deployment, json(release.plugins), json(release.layout), release.createdAt],
        },
      ]);
    },

    async latestRelease() {
      const rows = await driver.all(`SELECT * FROM thixo_releases ORDER BY seq DESC LIMIT 1`);
      return rows[0] ? toRelease(rows[0]) : null;
    },

    async getLayoutChanges(user) {
      const rows = await driver.all(`SELECT slot, plugin, number FROM thixo_layouts WHERE user_id = ?`, [user]);
      const changes: Record<SlotPath, PluginVersionRef> = {};
      for (const row of rows) changes[row.slot as string] = { plugin: row.plugin as string, number: Number(row.number) };
      return changes;
    },

    async setLayoutSlot(user, slot, ref) {
      if (ref === null) {
        await driver.run(`DELETE FROM thixo_layouts WHERE user_id = ? AND slot = ?`, [user, slot]);
        return;
      }
      await driver.run(
        `INSERT INTO thixo_layouts (user_id, slot, plugin, number) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, slot) DO UPDATE SET plugin = excluded.plugin, number = excluded.number`,
        [user, slot, ref.plugin, ref.number],
      );
    },

    async rememberUser(user: User) {
      await driver.run(
        `INSERT INTO thixo_users (id, scopes, member_groups) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET scopes = excluded.scopes, member_groups = excluded.member_groups`,
        [user.id, json(user.scopes), user.groups ? json(user.groups) : null],
      );
    },

    async recallUser(id: UserId) {
      const rows = await driver.all(`SELECT * FROM thixo_users WHERE id = ?`, [id]);
      if (!rows[0]) return null;
      const user: User = { id: rows[0].id as string, scopes: JSON.parse(rows[0].scopes as string) };
      if (rows[0].member_groups) user.groups = JSON.parse(rows[0].member_groups as string);
      return user;
    },

    async read(target, chain) {
      return (await readTargets([target], chain))[0];
    },

    readMany: readTargets,

    async patch(target, plugin, fields) {
      const key = keyOf(target);
      const encoded = Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => [field, encodeValue(value)] as const);
      if (encoded.length === 0) return;
      await driver.batch(
        encoded.map(([field, value]) => ({
          sql: `INSERT INTO thixo_data (kind, scope, bucket, id, plugin, field, value) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (kind, scope, bucket, id, plugin, field) DO UPDATE SET value = excluded.value`,
          params: [key.kind, key.scope, key.bucket, key.id, plugin, field, value],
        })),
      );
    },

    async listStore(store, owner, chain) {
      if (chain.length === 0) return [];
      const rows = await driver.all(
        `SELECT DISTINCT id FROM thixo_data WHERE kind = 'store' AND scope = ? AND bucket = ? AND plugin IN (${marks(chain.length)}) ORDER BY id`,
        [store, owner, ...chain],
      );
      return rows.map((row) => row.id as string);
    },

    async removeStoreRecord(store, id, owner, chain) {
      if (chain.length === 0) return;
      await driver.run(
        `DELETE FROM thixo_data WHERE kind = 'store' AND scope = ? AND bucket = ? AND id = ? AND plugin IN (${marks(chain.length)})`,
        [store, owner, id, ...chain],
      );
    },

    async removeField(plugin, scope, field) {
      const [kind, name] = "store" in scope ? ["store", scope.store] : ["annotation", scope.record];
      await driver.run(`DELETE FROM thixo_data WHERE kind = ? AND scope = ? AND plugin = ? AND field = ?`, [kind, name, plugin, field]);
    },

    async removeAnnotations(record, id) {
      await driver.run(`DELETE FROM thixo_data WHERE kind = 'annotation' AND scope = ? AND id = ?`, [record, id]);
    },

    async addRefusal(refusal) {
      await driver.run(
        `INSERT INTO thixo_refusals (id, user_id, conversation, category, reason, trigger_text, quote, origin, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          refusal.id,
          refusal.user,
          refusal.conversation,
          refusal.category,
          refusal.reason,
          refusal.trigger,
          refusal.quote ?? null,
          refusal.from,
          refusal.source,
          refusal.at,
        ],
      );
    },

    async listRefusals(filter) {
      const where: string[] = [];
      const params: SqlParam[] = [];
      if (filter?.user) {
        where.push("user_id = ?");
        params.push(filter.user);
      }
      if (filter?.since) {
        where.push("created_at > ?");
        params.push(filter.since);
      }
      const rows = await driver.all(
        `SELECT * FROM thixo_refusals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, id`,
        params,
      );
      return rows.map(toRefusal);
    },

    async putAuthoringBlock(block) {
      await driver.run(
        `INSERT INTO thixo_authoring_blocks (user_id, blocked_at, reason, refusals, lifted_at, lifted_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET blocked_at = excluded.blocked_at, reason = excluded.reason,
           refusals = excluded.refusals, lifted_at = excluded.lifted_at, lifted_by = excluded.lifted_by`,
        [block.user, block.at, block.reason, json(block.refusals), block.liftedAt ?? null, block.liftedBy ?? null],
      );
    },

    async getAuthoringBlock(user) {
      const rows = await driver.all(`SELECT * FROM thixo_authoring_blocks WHERE user_id = ?`, [user]);
      return rows[0] ? toBlock(rows[0]) : null;
    },

    async listAuthoringBlocks() {
      const rows = await driver.all(`SELECT * FROM thixo_authoring_blocks ORDER BY blocked_at DESC, user_id`);
      return rows.map(toBlock);
    },
  };
}
