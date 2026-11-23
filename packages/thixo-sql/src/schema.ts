export const SCHEMA_VERSION = 1;

/** Portable across SQLite, D1 and Postgres: TEXT and INTEGER columns, composite primary keys, `IF NOT EXISTS`.
 * `thixo_data` is the one table for plugin data: a row per target, plugin (layer) and field. A target is a `kind`
 * (`store` or `annotation`), a `scope` (the store's or the record's name), a `bucket` (a store's owner, or an
 * annotation's group) and an `id`. */
export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS thixo_schema (
    id INTEGER PRIMARY KEY,
    version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS thixo_plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    visibility TEXT NOT NULL,
    forked_plugin TEXT,
    forked_number INTEGER,
    reads_parent_data INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS thixo_versions (
    plugin TEXT NOT NULL,
    number INTEGER NOT NULL,
    source TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    compiled TEXT NOT NULL,
    manifest TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (plugin, number)
  )`,
  `CREATE INDEX IF NOT EXISTS thixo_versions_hash ON thixo_versions (plugin, source_hash)`,
  `CREATE TABLE IF NOT EXISTS thixo_releases (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    deployment TEXT NOT NULL,
    plugins TEXT NOT NULL,
    layout TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS thixo_layouts (
    user_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    plugin TEXT NOT NULL,
    number INTEGER NOT NULL,
    PRIMARY KEY (user_id, slot)
  )`,
  `CREATE TABLE IF NOT EXISTS thixo_users (
    id TEXT PRIMARY KEY,
    scopes TEXT NOT NULL,
    member_groups TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS thixo_data (
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    bucket TEXT NOT NULL,
    id TEXT NOT NULL,
    plugin TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (kind, scope, bucket, id, plugin, field)
  )`,
  `CREATE INDEX IF NOT EXISTS thixo_data_plugin ON thixo_data (kind, scope, plugin, field)`,
  `CREATE INDEX IF NOT EXISTS thixo_data_record ON thixo_data (kind, scope, id)`,
  // The authoring guard: each refusal, and one block row per user. Times are ISO strings, which sort as text.
  `CREATE TABLE IF NOT EXISTS thixo_refusals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation TEXT,
    category TEXT NOT NULL,
    reason TEXT NOT NULL,
    trigger_text TEXT NOT NULL,
    quote TEXT,
    origin TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS thixo_refusals_user ON thixo_refusals (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS thixo_authoring_blocks (
    user_id TEXT PRIMARY KEY,
    blocked_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    refusals TEXT NOT NULL,
    lifted_at TEXT,
    lifted_by TEXT
  )`,
];
