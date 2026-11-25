/**
 * History: saying exactly what a world is, packing it so that it can be checked, and
 * re-running a stretch of it.
 *
 * A world line is its configuration, the interventions logged in it (each with its tick), and
 * — for worlds with minds outside the engine — the tape of their decisions. Given those, any
 * moment of it can be rebuilt bit for bit: from a snapshot taken earlier, by stepping forward
 * and applying each logged intervention at the tick it was applied at. Nothing here consults
 * a provider or a clock.
 */
import { canonicalJson, parseCanonical } from "../core/canonical";
import type { BranchInfo, Intervention, WorldState } from "../model/types";
import type { EventOut } from "../sim/events";
import type { DecisionRecord } from "../mind/external";
import type { WorldConfig } from "../model/config";
import { replayTape } from "../mind/external";
import { applyIntervention } from "../sim/environment";
import { scratchOf } from "../sim/scratch";
import { step } from "../sim/step";
import { TICKS_PER_DAY } from "../model/constants";
import { SnapshotError, restoreWorld, serializeWorld, snapshotHash, worldDigest } from "./snapshot";

/** What a world is and how it came to be: enough to rebuild it, and to tell two worlds apart. */
export interface Manifest {
  format: "tabula-rasa/manifest";
  version: 1;
  engine: string;
  schema: number;
  affordances: string;
  scenario: string;
  seed: number;
  config: WorldConfig;
  configHash: string;
  terrainHash: string;
  tick: number;
  day: number;
  branch: BranchInfo;
  /** Every change made to the world's conditions, with the tick it was applied at and by whom. */
  interventions: Intervention[];
  /** How many decisions each kind of mind has made so far (reflex, planner, mock, live, replay, fallback …). */
  decisionsBySource: Record<string, number>;
  /** The model-driven minds' provenance, when the world had any; null for a world of baselines. */
  minds: { provider: string; model: string; promptVersion: string } | null;
  /** Content address of the canonical snapshot text and its length in UTF-16 code units. */
  snapshot: { sha256: string; length: number };
  /** Fast digest of the dynamic state (the same one replays are checked against). */
  digest: string;
}

export function manifestOf(world: WorldState, snapshotText: string = serializeWorld(world), minds: Manifest["minds"] = null): Manifest {
  return {
    format: "tabula-rasa/manifest",
    version: 1,
    engine: world.meta.engine,
    schema: world.meta.schema,
    affordances: world.meta.affordances,
    scenario: world.config.scenario,
    seed: world.config.seed,
    config: world.config,
    configHash: world.meta.configHash,
    terrainHash: world.terrain.hash,
    tick: world.tick,
    day: Math.floor(world.tick / TICKS_PER_DAY),
    branch: { ...world.meta.branch },
    interventions: world.interventions.map((i) => ({ tick: i.tick, kind: i.kind, params: { ...i.params }, origin: i.origin })),
    decisionsBySource: { ...world.metrics.decisionsBySource },
    minds,
    snapshot: { sha256: snapshotHash(snapshotText), length: snapshotText.length },
    digest: worldDigest(world),
  };
}

/** The ways two worlds differ in what made them — not in what happened in them. */
export function diffManifests(a: Manifest, b: Manifest): string[] {
  const out: string[] = [];
  const say = (what: string, x: unknown, y: unknown): void => {
    if (canonicalJson(x) !== canonicalJson(y)) out.push(`${what}: ${typeof x === "object" ? canonicalJson(x) : String(x)} ≠ ${typeof y === "object" ? canonicalJson(y) : String(y)}`);
  };
  say("engine", a.engine, b.engine);
  say("schema", a.schema, b.schema);
  say("affordances", a.affordances, b.affordances);
  say("scenario", a.scenario, b.scenario);
  say("seed", a.seed, b.seed);
  if (a.configHash !== b.configHash) {
    const keys = new Set([...Object.keys(a.config), ...Object.keys(b.config)]);
    for (const k of [...keys].sort()) {
      if (k === "seed" || k === "scenario") continue;
      say(`config.${k}`, (a.config as unknown as Record<string, unknown>)[k], (b.config as unknown as Record<string, unknown>)[k]);
    }
  }
  say("terrain", a.terrainHash, b.terrainHash);
  say("random numbers after the fork", a.branch.rngEpoch, b.branch.rngEpoch);
  say("interventions", a.interventions, b.interventions);
  say("minds", a.minds, b.minds);
  return out;
}

export interface BundleExtras {
  /** Daily samples, journal pages and anything else the application keeps beside the world; opaque to the engine. */
  [key: string]: unknown;
}

/** A world packed for export: its manifest, its snapshot, its untouched twin if it has one, and the tape of outside minds if any. */
export interface WorldBundle {
  format: "tabula-rasa/bundle";
  version: 1;
  manifest: Manifest;
  snapshot: string;
  control: { snapshot: string; sha256: string } | null;
  tape: DecisionRecord[];
  extras: BundleExtras;
}

/** Hard limit on what will be read back: a bundle is a few megabytes; anything far beyond that is not one of ours. */
export const MAX_BUNDLE_CHARS = 96 * 1024 * 1024;

export function packBundle(world: WorldState, control: WorldState | null, extras: BundleExtras = {}, minds: Manifest["minds"] = null, tape: DecisionRecord[] = []): string {
  const snapshot = serializeWorld(world);
  const controlText = control ? serializeWorld(control) : null;
  const bundle: WorldBundle = {
    format: "tabula-rasa/bundle",
    version: 1,
    manifest: manifestOf(world, snapshot, minds),
    snapshot,
    control: controlText === null ? null : { snapshot: controlText, sha256: snapshotHash(controlText) },
    tape,
    extras,
  };
  return canonicalJson(bundle);
}

export interface OpenedBundle {
  world: WorldState;
  control: WorldState | null;
  manifest: Manifest;
  snapshot: string;
  controlSnapshot: string | null;
  tape: DecisionRecord[];
  extras: BundleExtras;
}

/**
 * Read a bundle back, refusing anything that is not exactly what was packed: wrong format,
 * a snapshot whose content does not hash to the address in the manifest, a manifest that
 * does not describe the world in the snapshot, a twin that is not a twin.
 */
export function openBundle(text: string): OpenedBundle {
  if (typeof text !== "string" || text.length === 0) throw new SnapshotError("format", "the file is empty");
  if (text.length > MAX_BUNDLE_CHARS) throw new SnapshotError("format", "the file is too large to be a world");
  let b: WorldBundle;
  try {
    b = parseCanonical<WorldBundle>(text);
  } catch (err) {
    throw new SnapshotError("corrupt", `the file is not valid: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!b || typeof b !== "object" || b.format !== "tabula-rasa/bundle") throw new SnapshotError("format", "this is not a TABULA RASA world file");
  if (b.version !== 1) throw new SnapshotError("schema", `world file version ${String(b.version)} is not one this version can read`);
  const m = b.manifest;
  if (!m || typeof m !== "object" || m.format !== "tabula-rasa/manifest" || typeof b.snapshot !== "string" || !m.snapshot) throw new SnapshotError("corrupt", "the file is missing its manifest or its snapshot");
  if (snapshotHash(b.snapshot) !== m.snapshot.sha256 || b.snapshot.length !== m.snapshot.length) {
    throw new SnapshotError("corrupt", "the world in this file is not the one its manifest describes (content hash mismatch): it was damaged or altered");
  }
  const world = restoreWorld(b.snapshot);
  // the manifest must describe this very world, not merely carry a matching hash
  if (world.tick !== m.tick || world.config.seed !== m.seed || world.meta.configHash !== m.configHash || world.terrain.hash !== m.terrainHash || worldDigest(world) !== m.digest) {
    throw new SnapshotError("corrupt", "the manifest does not describe the world in this file");
  }
  let control: WorldState | null = null;
  let controlSnapshot: string | null = null;
  if (b.control !== null && b.control !== undefined) {
    if (typeof b.control.snapshot !== "string" || snapshotHash(b.control.snapshot) !== b.control.sha256) throw new SnapshotError("corrupt", "the untouched twin in this file was damaged or altered (content hash mismatch)");
    control = restoreWorld(b.control.snapshot);
    controlSnapshot = b.control.snapshot;
    if (control.meta.configHash !== world.meta.configHash || control.tick !== world.tick) throw new SnapshotError("corrupt", "the untouched twin in this file belongs to a different world or a different moment");
  }
  if (!Array.isArray(b.tape)) throw new SnapshotError("corrupt", "the file's tape of decisions is malformed");
  return { world, control, manifest: m, snapshot: b.snapshot, controlSnapshot, tape: b.tape, extras: b.extras && typeof b.extras === "object" ? b.extras : {} };
}

/**
 * Re-run history: step `world` forward to `untilTick`, applying each intervention that an
 * observer or a treatment made at the tick it was made, and offering each recorded decision
 * of an outside mind at the tick it was taken. `interventions` is the log of the world line
 * being re-run; the world must be an earlier moment of that same line, so the ones it
 * already carries are a prefix of the log. Shocks scheduled by the scenario are not in
 * question: the engine applies those itself, from the configuration. Returns the cursor
 * into the tape.
 */
export function replayTo(world: WorldState, untilTick: number, interventions: readonly Intervention[], out: EventOut, tape: readonly DecisionRecord[] = [], cursor = 0): number {
  const sc = scratchOf(world);
  const made = interventions.filter((i) => i.origin !== "scenario");
  let next = world.interventions.filter((i) => i.origin !== "scenario").length;
  // an intervention is made between ticks: after the step that brought the world to its tick, before the next one
  const applyDue = (): void => {
    while (next < made.length && (made[next] as Intervention).tick <= world.tick) {
      const iv = made[next] as Intervention;
      if (iv.tick === world.tick) applyIntervention(world, sc, out, { tick: world.tick, kind: iv.kind, params: { ...iv.params }, origin: iv.origin });
      next++;
    }
  };
  let c = cursor;
  while (world.tick < untilTick) {
    applyDue();
    if (tape.length) c = replayTape(world, tape, c, out);
    step(world, out);
  }
  applyDue();
  return c;
}
