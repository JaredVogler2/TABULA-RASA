/**
 * Snapshots: canonical serialization, content hashes, fast digests, cloning and forking.
 *
 * Terrain is never stored: it is regenerated from the config and checked against the
 * stored terrain hash, so a snapshot can only be restored by an engine that generates
 * the same world (a guard against silent generator drift).
 */
import { canonicalJson, deepClone, parseCanonical } from "../core/canonical";
import { StateHasher, sha256Text } from "../core/hash";
import { Stream, hash3 } from "../core/rng";
import { validateConfig } from "../model/config";
import { ITEM_COUNT } from "../model/constants";
import type { BranchInfo, WorldState } from "../model/types";
import { SCHEMA_VERSION } from "../version";
import { generateTerrain } from "../world/terrain";
import { migrateSnapshot } from "./migrate";

export interface SnapshotEnvelope {
  /** Format marker. */
  kind: "tabula-rasa/world";
  schema: number;
  terrainHash: string;
  /** World state without terrain and without the derived tile→node index. */
  state: Omit<WorldState, "terrain">;
}

export class SnapshotError extends Error {
  constructor(
    public readonly code: "format" | "schema" | "terrain_drift" | "config" | "corrupt",
    message: string,
  ) {
    super(message);
    this.name = "SnapshotError";
  }
}

/** Canonical text of a world. Equal worlds produce byte-identical text. */
export function serializeWorld(world: WorldState): string {
  const { terrain, ...rest } = world;
  const state = { ...rest, nodes: { ...world.nodes, atTile: new Int16Array(0) } };
  const env: SnapshotEnvelope = { kind: "tabula-rasa/world", schema: SCHEMA_VERSION, terrainHash: terrain.hash, state };
  return canonicalJson(env);
}

/** SHA-256 content address of a serialized snapshot. */
export function snapshotHash(text: string): string {
  return sha256Text(text);
}

export function restoreWorld(text: string): WorldState {
  let env: SnapshotEnvelope;
  try {
    env = parseCanonical<SnapshotEnvelope>(text);
  } catch (err) {
    throw new SnapshotError("corrupt", `snapshot is not valid canonical JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!env || typeof env !== "object" || env.kind !== "tabula-rasa/world") {
    throw new SnapshotError("format", "not a TABULA RASA world snapshot");
  }
  if (!Number.isInteger(env.schema) || env.schema > SCHEMA_VERSION) {
    throw new SnapshotError("schema", `snapshot schema ${String(env.schema)} is newer than this engine supports (${SCHEMA_VERSION})`);
  }
  const migrated = migrateSnapshot(env);
  const state = migrated.state;
  if (!state || typeof state !== "object" || !state.config || !Array.isArray(state.agents) || !state.nodes) {
    throw new SnapshotError("corrupt", "snapshot is missing required sections");
  }
  let cfg;
  try {
    cfg = validateConfig(state.config);
  } catch (err) {
    throw new SnapshotError("config", err instanceof Error ? err.message : String(err));
  }
  const { terrain } = generateTerrain(cfg);
  if (terrain.hash !== migrated.terrainHash) {
    throw new SnapshotError(
      "terrain_drift",
      "the world generator in this engine does not reproduce the snapshot's terrain; it was saved by an incompatible engine version",
    );
  }
  const nodes = state.nodes;
  const n = terrain.w * terrain.h;
  if (!(nodes.x instanceof Uint8Array) || !(nodes.y instanceof Uint8Array) || nodes.x.length !== nodes.count) {
    throw new SnapshotError("corrupt", "snapshot node arrays are malformed");
  }
  const atTile = new Int16Array(n).fill(-1);
  for (let k = 0; k < nodes.count; k++) atTile[(nodes.y[k] as number) * terrain.w + (nodes.x[k] as number)] = k;
  nodes.atTile = atTile;
  for (const a of state.agents) {
    if (!Array.isArray(a.inv) || a.inv.length !== ITEM_COUNT) throw new SnapshotError("corrupt", "agent inventory malformed");
  }
  return { ...state, config: cfg, terrain, nodes } as WorldState;
}

/**
 * Fast 64-bit digest of the dynamic state. Used to compare worlds tick by tick during
 * replay and to verify a client replica against a server. Not a security hash.
 */
export function worldDigest(world: WorldState): string {
  const h = new StateHasher();
  h.int(world.tick).int(world.nextEvent).int(world.nextUtterance).int(world.structures.length);
  const c = world.climate;
  h.int(c.weather).int(c.weatherUntil).int(c.temp).int(c.wet).int(c.snow).int(c.light);
  h.int(c.droughtUntil).int(c.coldUntil).int(c.coldDelta).int(c.rainUntil).int(c.hushUntil).int(c.hushRadius);
  h.ints(world.nodes.amount);
  for (const a of world.agents) {
    h.int(a.id).int(a.x).int(a.y).bool(a.alive).int(a.energy).int(a.hydration).int(a.rest).int(a.warmth).int(a.health);
    h.int(a.ill).bool(a.asleep).int(a.shelter).ints(a.inv).ints(a.toolUses).ints(a.skills);
    h.int(a.queue.length).int(a.progress);
    if (a.act) h.str(a.act.k).int(a.act.t).int(a.act.x).int(a.act.y);
    else h.int(-1);
    const m = a.mind;
    h.int(m.lastDecision).int(m.decisionEvent).int(m.mem.length).int(m.structs.length).int(m.inbox.length).str(m.goal);
    h.ints(m.nodeAmt).ints(m.trust).ints(m.gave);
    h.int(a.stats.distance).int(a.stats.decisions).int(a.stats.welfareSum);
  }
  for (const s of world.structures) {
    h.int(s.id).int(s.kind).int(s.x).int(s.y).bool(s.complete).bool(s.removed).int(s.laborDone).int(s.fuel);
    h.int(s.ripeTick).int(s.occupants).int(s.bound).int(s.integrity).ints(s.inv).ints(s.missing);
  }
  for (const p of world.piles) h.int(p.x).int(p.y).ints(p.inv);
  h.ints(world.traffic);
  h.int(world.speech.length);
  h.str(canonicalJson(world.inst));
  return h.digest();
}

/** Independent deep copy sharing only the immutable terrain. */
export function cloneWorld(world: WorldState): WorldState {
  const { terrain, ...rest } = world;
  const copy = deepClone(rest) as Omit<WorldState, "terrain">;
  return { ...copy, terrain };
}

/**
 * Fork a world into a new branch at its current tick.
 *
 * `commonRandomNumbers = true` keeps the parent's RNG epoch, so exogenous randomness
 * (weather, regrowth, arbitration) stays identical and only the intervention differs —
 * the right choice for matched comparisons. `false` re-keys the branch for an
 * independent stochastic continuation.
 */
export function forkWorld(world: WorldState, branchId: string, commonRandomNumbers: boolean): WorldState {
  const copy = cloneWorld(world);
  const parent = world.meta.branch;
  const branch: BranchInfo = {
    id: branchId,
    parent: parent.id,
    forkTick: world.tick,
    rngEpoch: commonRandomNumbers ? parent.rngEpoch : hash3(world.config.seed, Stream.Lab, hash3(world.tick, parent.rngEpoch, branchId.length)) || 1,
  };
  copy.meta = { ...copy.meta, branch };
  return copy;
}
