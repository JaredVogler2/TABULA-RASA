/**
 * The aims on the scenario cards, counted in worlds nobody touches.
 *
 *   pnpm exec tsx scripts/aims.ts [--seeds 1-10] [--policies planner,reflex] [--first-written]
 *
 * For every scenario, each seed and each kind of baseline mind: the world is lived for one year
 * and a day with no intervention, and the aim is read as the game reads it (`src/worker/aims.ts`).
 * This is how the aims were chosen to be ones that can go either way (D-049), and it is a check
 * that the reading gives the same answer at the end as on the day it was decided. Development
 * seeds only.
 *
 * With --first-written it also counts what two of the aims asked for before they were reworded:
 * people lost to cold or hunger before spring ("lose no one"), and the first morning on which
 * any grove or fishing water stood below its collapse threshold ("keep every commons above").
 */
import { NODE_SPECS, NodeKind, SCENARIOS, TICKS_PER_DAY, calendarAt, commonsHealthPermille, createWorld, giniPermille, makeConfig, step, worthOf, yearLength, type PolicyKind, type SimEvent, type WorldState } from "../src/engine";
import { firstWinterEnd, readAim } from "../src/worker/aims";
import type { DaySample } from "../src/worker/protocol";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

const firstWritten = process.argv.includes("--first-written");

/** Groves and fishing waters below their collapse threshold at this moment (groves are not read in winter, when they die back by themselves). */
function commonsBelowThreshold(world: WorldState): number {
  const cfg = world.config;
  const winter = calendarAt(cfg, world.tick).season === 3;
  let low = 0;
  for (let n = 0; n < world.nodes.count; n++) {
    const kind = world.nodes.kind[n] as number;
    const spec = NODE_SPECS[kind]!;
    if (!(spec.collapseBelow > 0 && cfg.collapse > 0)) continue;
    if (kind === NodeKind.berry_bush && winter) continue;
    // the same threshold the engine slows regrowth below (sim/environment.ts)
    if ((world.nodes.amount[n] as number) < ((world.nodes.cap[n] as number) * spec.collapseBelow * cfg.collapse) / 1_000_000) low++;
  }
  return low;
}

const [from, to] = arg("seeds", "1-10").split("-").map(Number) as [number, number];
const policies = arg("policies", "planner,reflex").split(",") as PolicyKind[];
if (!(from >= 1 && (to ?? from) <= 999)) {
  console.error("development seeds only (1-999)");
  process.exit(1);
}

for (const scenario of SCENARIOS) {
  for (const policy of policies) {
    const tally: Record<string, number> = {};
    const rows: string[] = [];
    for (let seed = from; seed <= (to ?? from); seed++) {
      const world = createWorld(makeConfig(scenario.id, seed, { policy }));
      const out: SimEvent[] = [];
      const series: DaySample[] = [];
      const days = yearLength(world.config) + 1;
      let decided = "";
      let firstLow = 0;
      for (let t = 0; t < days * TICKS_PER_DAY; t++) {
        step(world, out);
        out.length = 0;
        if (world.tick % TICKS_PER_DAY === 0) {
          if (firstWritten && !firstLow && commonsBelowThreshold(world) > 0) firstLow = world.tick / TICKS_PER_DAY;
          const alive = world.agents.filter((a) => a.alive);
          series.push({ day: world.tick / TICKS_PER_DAY, alive: alive.length, welfare: 0, food: 0, wild: 0, commons: commonsHealthPermille(world), gini: giniPermille(alive.map((a) => worthOf(a.inv))), structures: 0 });
          const aim = readAim(world, series);
          if (aim && !decided && (aim.state === "met" || aim.state === "lost")) decided = `${aim.state} on day ${aim.decidedDay}`;
        }
      }
      const aim = readAim(world, series);
      if (!aim) continue;
      const end = aim.state === "met" || aim.state === "lost" ? `${aim.state} on day ${aim.decidedDay}` : aim.state;
      if (decided && decided !== end) throw new Error(`${scenario.id} seed ${seed}: decided "${decided}" on the day, read "${end}" at the end`);
      tally[aim.state] = (tally[aim.state] ?? 0) + 1;
      const spring = firstWinterEnd(world);
      const coldOrHunger = world.agents.filter((a) => a.diedTick >= 0 && a.diedTick < spring && (a.deathCause === "cold" || a.deathCause === "hunger")).length;
      const was = firstWritten ? `  | lost to cold or hunger before spring: ${String(coldOrHunger).padStart(2)}; a commons first below its threshold on morning ${firstLow || "—"}` : "";
      rows.push(`  seed ${String(seed).padStart(2)}  ${end.padEnd(16)} ${aim.figure.padEnd(28)} ${firstWritten ? "" : aim.lines[0]}${was}`);
    }
    console.log(`\n${scenario.title} — "${scenario.objective.text}" — ${policy} minds, nobody intervening: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const r of rows) console.log(r);
  }
}
