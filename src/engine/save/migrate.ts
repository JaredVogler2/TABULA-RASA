/**
 * Snapshot schema migrations.
 *
 * Each entry upgrades an envelope from schema N to N+1. `migrateSnapshot` applies them
 * in order until the envelope reaches the current schema. A snapshot from a NEWER
 * schema is rejected by the caller before this runs.
 */
import { SCHEMA_VERSION } from "../version";
import type { SnapshotEnvelope } from "./snapshot";

type Migration = (env: SnapshotEnvelope) => SnapshotEnvelope;

/** Index = source schema version. Schema 1 is the first released format, so there is nothing below it. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrateSnapshot(env: SnapshotEnvelope): SnapshotEnvelope {
  let cur = env;
  let guard = 0;
  while (cur.schema < SCHEMA_VERSION) {
    const m = MIGRATIONS[cur.schema];
    if (!m) throw new Error(`no migration from snapshot schema ${cur.schema}`);
    cur = m(cur);
    if (++guard > 64) throw new Error("snapshot migration did not terminate");
  }
  return cur;
}

export function registerMigrationForTests(from: number, fn: Migration): () => void {
  MIGRATIONS[from] = fn;
  return () => {
    delete MIGRATIONS[from];
  };
}
