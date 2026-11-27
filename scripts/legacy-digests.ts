/**
 * Worlds of a fixed cohort, run to a horizon and reduced to their state digests.
 *
 *   pnpm exec tsx scripts/legacy-digests.ts            print the table for this engine
 *   pnpm exec tsx scripts/legacy-digests.ts --write    write tests/support/legacy-0.7.0.json
 *   pnpm exec tsx scripts/legacy-digests.ts --check    compare this engine with that file
 *
 * The file was written once, by engine 0.7.0 at commit 71d4418, before births and crafts
 * existed. Every engine since must reproduce it with those two switches off: that is what
 * lets the registered studies, the bundled recording and every older save keep meaning what
 * they meant (D-055). `--write` is therefore only for an engine that is meant to change what
 * a fixed cohort does, and that is a new registration, not a refresh.
 *
 * Development seeds only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ENGINE_VERSION, TICKS_PER_DAY, applyIntervention, createWorld, makeConfig, scratchOf, step, worldDigest, type SimEvent, type WorldConfig } from "../src/engine";

export interface LegacyCell {
  id: string;
  scenario: string;
  seed: number;
  days: number;
  overrides: Partial<WorldConfig>;
  /** An observer's intervention made on the morning of a given day, if any. */
  intervention?: { day: number; kind: string; params: Record<string, number> };
  /** Cells marked long are checked by `--check` and by the test suite only when LEGACY_FULL=1. */
  long?: boolean;
}

export interface LegacyResult extends LegacyCell {
  /** The digest on the last tick of each fifth day, and of the last day. */
  digests: string[];
  alive: number;
  people: number;
  events: number;
}

export const LEGACY_CELLS: readonly LegacyCell[] = [
  { id: "first-light-planner-1", scenario: "first_light", seed: 1, days: 30, overrides: {} },
  { id: "first-light-planner-2", scenario: "first_light", seed: 2, days: 30, overrides: {} },
  { id: "first-light-reflex-3", scenario: "first_light", seed: 3, days: 20, overrides: { policy: "reflex" } },
  { id: "first-light-no-agreements-5", scenario: "first_light", seed: 5, days: 20, overrides: { institutions: "off" } },
  { id: "long-winter-scripted-1", scenario: "long_winter", seed: 1, days: 30, overrides: { institutions: "scripted_control" } },
  { id: "thin-commons-2", scenario: "thin_commons", seed: 2, days: 20, overrides: {} },
  { id: "two-shores-1", scenario: "two_shores", seed: 1, days: 20, overrides: {} },
  { id: "dry-year-4", scenario: "dry_year", seed: 4, days: 25, overrides: {} },
  { id: "first-light-mixed-6", scenario: "first_light", seed: 6, days: 15, overrides: { plannerShare: 500, planEvery: 24 } },
  { id: "newcomers-7", scenario: "first_light", seed: 7, days: 15, overrides: {}, intervention: { day: 3, kind: "newcomers", params: { count: 8 } } },
  { id: "crowded-8", scenario: "thin_commons", seed: 8, days: 12, overrides: { population: 120 } },
  // three years on the seed whose commons give out in the third: the long way round every rule
  { id: "first-light-three-years-2", scenario: "first_light", seed: 2, days: 124, overrides: {}, long: true },
  { id: "first-light-six-years-1", scenario: "first_light", seed: 1, days: 240, overrides: {}, long: true },
];

export function runLegacyCell(cell: LegacyCell): LegacyResult {
  const world = createWorld(makeConfig(cell.scenario, cell.seed, cell.overrides));
  const out: SimEvent[] = [];
  const digests: string[] = [];
  let events = 0;
  for (let day = 0; day < cell.days; day++) {
    if (cell.intervention && cell.intervention.day === day) {
      applyIntervention(world, scratchOf(world), out, { tick: world.tick, kind: cell.intervention.kind, params: cell.intervention.params, origin: "observer" });
    }
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      step(world, out);
      events += out.length;
      out.length = 0;
    }
    if ((day + 1) % 5 === 0 || day === cell.days - 1) digests.push(worldDigest(world));
  }
  return { ...cell, digests, alive: world.agents.filter((a) => a.alive).length, people: world.agents.length, events };
}

const FILE = "tests/support/legacy-0.7.0.json";

function main(): void {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const only = process.argv.includes("--short") ? LEGACY_CELLS.filter((c) => !c.long) : LEGACY_CELLS;
  const recorded = check ? (JSON.parse(readFileSync(FILE, "utf8")) as { engine: string; cells: LegacyResult[] }) : null;
  const results: LegacyResult[] = [];
  let different = 0;
  for (const cell of only) {
    const started = Date.now();
    const r = runLegacyCell(cell);
    results.push(r);
    let verdict = "";
    if (recorded) {
      const was = recorded.cells.find((c) => c.id === cell.id);
      const same = !!was && was.digests.join() === r.digests.join() && was.alive === r.alive && was.events === r.events && was.people === r.people;
      if (!same) different++;
      verdict = same ? "  same" : "  DIFFERENT";
    }
    console.log(`${cell.id.padEnd(30)} ${String(cell.days).padStart(3)} days  alive ${String(r.alive).padStart(3)} of ${String(r.people).padStart(3)}  events ${String(r.events).padStart(7)}  ${r.digests[r.digests.length - 1]}  ${((Date.now() - started) / 1000).toFixed(1)} s${verdict}`);
  }
  if (write) {
    writeFileSync(FILE, `${JSON.stringify({ engine: ENGINE_VERSION, note: "Written once by engine 0.7.0 (commit 71d4418). Do not regenerate: see scripts/legacy-digests.ts.", cells: results }, null, 1)}\n`);
    console.log(`wrote ${FILE}`);
  }
  if (recorded) {
    console.log(different === 0 ? `engine ${ENGINE_VERSION} reproduces all ${results.length} worlds recorded by engine ${recorded.engine}` : `${different} of ${results.length} worlds differ from what engine ${recorded.engine} recorded`);
    if (different > 0) process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("legacy-digests.ts")) main();
