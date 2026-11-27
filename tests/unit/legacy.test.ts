import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGACY_CELLS, runLegacyCell, type LegacyResult } from "../../scripts/legacy-digests";
import { DIGEST_COMPATIBLE_ENGINES, ENGINE_VERSION, createWorld, makeConfig, restoreWorld, serializeWorld, worldDigest, type DecisionRecord, type WorldConfig } from "../../src/engine";
import { STUDIES, runCell } from "../../src/lab/studies";
import { verifyTape } from "../../src/providers/run";

/**
 * A world that leaves crafts and arrivals off is stepped exactly as engine 0.7.0 stepped it
 * (D-055). Three independent records of what 0.7.0 did hold this engine to that:
 *
 *  1. tests/support/legacy-0.7.0.json — eleven worlds across every scenario, both baseline
 *     minds, agreements off and scripted, a mixed population, newcomers brought by the observer
 *     and a crowded island, with the digest of every fifth day; written by 0.7.0 before any of
 *     the new rules existed (`scripts/legacy-digests.ts`). Two longer ones — three and six
 *     years — are checked when LEGACY_FULL=1 and by the script's `--check`.
 *  2. The recording 0.7.0 bundled: fifty mock minds, 400 decisions, the digest after each of
 *     24 epochs (tests/support/recording-0.7.0.json).
 *  3. The published pilot study: the final digest of every cell, in its manifest.
 */
const recorded = JSON.parse(readFileSync("tests/support/legacy-0.7.0.json", "utf8")) as { engine: string; cells: LegacyResult[] };
const full = process.env.LEGACY_FULL === "1";

describe("a world without crafts or arrivals is the world engine 0.7.0 made", () => {
  it("this engine says which engines it reproduces, and the records are theirs", () => {
    expect(DIGEST_COMPATIBLE_ENGINES).toContain(recorded.engine);
    expect(recorded.engine).not.toBe(ENGINE_VERSION);
    expect(recorded.cells.map((c) => c.id)).toEqual(LEGACY_CELLS.map((c) => c.id));
  });

  for (const cell of LEGACY_CELLS) {
    const run = cell.long && !full ? it.skip : it;
    run(
      `${cell.id}: ${cell.days} days end where 0.7.0 ended them, on every fifth day and the last`,
      () => {
        const was = recorded.cells.find((c) => c.id === cell.id)!;
        const now = runLegacyCell(cell);
        expect(now.digests).toEqual(was.digests);
        expect({ alive: now.alive, people: now.people, events: now.events }).toEqual({ alive: was.alive, people: was.people, events: was.events });
      },
      cell.long ? 240_000 : 60_000,
    );
  }

  it("the recording 0.7.0 bundled is reached, epoch by epoch, from its decisions", () => {
    const old = JSON.parse(readFileSync("tests/support/recording-0.7.0.json", "utf8")) as { config: WorldConfig; epochs: { epoch: number; toTick: number; digest: string }[]; tape: DecisionRecord[] };
    // its configuration was written before the new rules: read today it means "none of them"
    const world = createWorld(old.config);
    expect([world.config.crafts, world.config.arrivals, world.config.changesPerSeason]).toEqual([false, false, 0]);
    expect(verifyTape(world, old.tape, old.epochs)).toBe(-1);
    // and the recording made today from the same seed is that one, decision for decision
    const today = JSON.parse(readFileSync("public/recordings/mock-first-light.json", "utf8")) as { epochs: unknown; tape: unknown };
    expect(today.epochs).toEqual(old.epochs);
    expect(today.tape).toEqual(old.tape);
  });

  it("cells of the published pilot study end on their published digests", () => {
    const manifest = JSON.parse(readFileSync("public/studies/pilot/manifest.json", "utf8")) as { engine: string; studies: { id: string; days: number }[]; hashes: { study: string; condition: string; seed: number; digest: string }[] };
    expect(DIGEST_COMPATIBLE_ENGINES).toContain(manifest.engine);
    // one cell of each study, spread over the seeds
    const picked = STUDIES.map((s, i) => manifest.hashes.filter((h) => h.study === s.id)[i * 7]!).filter(Boolean);
    expect(picked.length).toBeGreaterThanOrEqual(5);
    for (const cell of picked) {
      const study = STUDIES.find((s) => s.id === cell.study)!;
      const days = manifest.studies.find((s) => s.id === cell.study)!.days;
      const again = runCell({ ...study, days }, study.conditions.find((c) => c.id === cell.condition)!, cell.seed);
      expect(`${cell.study} ${cell.condition} ${cell.seed} ${again.digest}`).toBe(`${cell.study} ${cell.condition} ${cell.seed} ${cell.digest}`);
    }
  }, 240_000);

  it("a world saved by 0.7.0 opens, is the same world, and goes on as it would have", () => {
    // a schema-6 file is what this engine writes with everything 0.8.0 added taken out again
    const world = createWorld(makeConfig("first_light", 11, {}));
    for (let i = 0; i < 300; i++) stepOnce(world);
    const before = worldDigest(world);
    const env = JSON.parse(serializeWorld(world)) as { schema: number; state: { config: Record<string, unknown>; meta: Record<string, unknown>; agents: Record<string, unknown>[]; structures: Record<string, unknown>[]; metrics: Record<string, unknown> } };
    env.schema = 6;
    env.state.meta.schema = 6;
    env.state.meta.engine = "0.7.0";
    for (const k of ["crafts", "arrivals", "changesPerSeason"]) delete env.state.config[k];
    for (const a of env.state.agents) {
      delete a.lore;
      delete a.since;
    }
    for (const s of env.state.structures) delete s.lore;
    for (const k of ["discoveries", "learned", "inscribed", "fieldHarvests", "milled", "careLaid", "careSpent", "arrivals", "ages"]) delete env.state.metrics[k];
    const opened = restoreWorld(JSON.stringify(env));
    expect(worldDigest(opened)).toBe(before);
    expect([opened.config.crafts, opened.config.arrivals]).toEqual([false, false]);
    for (let i = 0; i < 200; i++) {
      stepOnce(world);
      stepOnce(opened);
    }
    expect(worldDigest(opened)).toBe(worldDigest(world));
  });
});

import { step, type SimEvent, type WorldState } from "../../src/engine";
const sink: SimEvent[] = [];
function stepOnce(world: WorldState): void {
  step(world, sink);
  sink.length = 0;
}
