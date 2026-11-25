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

/**
 * Index = source schema version.
 *
 *  1 → 2 (engine 0.2.0): minds gained the day's temperature accumulators and the cold-spell
 *        counter that seasonal foresight is built on (zero = has not yet sensed anything), and
 *        a per-node memory of the fullest each place has been seen.
 *  2 → 3 (engine 0.3.0): minds record which charters and pact offers they know of and where
 *        their current plan came from. No institution could exist before schema 3.
 */
const MIGRATIONS: Record<number, Migration> = {
  1: (env) => {
    const agents = (env.state as unknown as { agents?: { mind?: Record<string, unknown> }[] }).agents;
    if (Array.isArray(agents)) {
      for (const a of agents) {
        const m = a.mind;
        if (!m) continue;
        if (typeof m.tempSum !== "number") m.tempSum = 0;
        if (typeof m.tempN !== "number") m.tempN = 0;
        if (typeof m.coldRun !== "number") m.coldRun = 0;
        if (!(m.nodeMax instanceof Int16Array) && m.nodeAmt instanceof Int16Array) {
          // the fullest a node is known to have been is, at worst, what is believed of it now
          m.nodeMax = Int16Array.from(m.nodeAmt, (v) => (v > 0 ? v : 0));
        }
      }
    }
    return { ...env, schema: 2 };
  },
  2: (env) => {
    const state = env.state as unknown as { agents?: { mind?: Record<string, unknown> }[]; inst?: { institutions?: Record<string, unknown>[] } };
    for (const a of state.agents ?? []) {
      const m = a.mind;
      if (!m) continue;
      if (!Array.isArray(m.charters)) m.charters = [];
      if (!Array.isArray(m.pacts)) m.pacts = [];
      if (typeof m.src !== "string") m.src = "baseline";
      if (Array.isArray(m.cool)) while (m.cool.length < 11) m.cool.push(0);
    }
    for (const s of (env.state as unknown as { structures?: Record<string, unknown>[] }).structures ?? []) {
      // before builders were told apart from depositors, everyone on record counts as a builder
      if (!Array.isArray(s.builders)) s.builders = Array.from(new Set([s.founder as number, ...((s.contributors as number[]) ?? [])]));
      if (!Array.isArray(s.open)) s.open = (s.inv as number[]).map(() => 0);
    }
    return { ...env, schema: 3 };
  },
};

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
