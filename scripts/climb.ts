/**
 * How far do islands climb? Worlds with crafts (and, unless --no-arrivals, newcomers) run for
 * years with the baseline minds, and what they came to is printed year by year.
 *
 *   pnpm exec tsx scripts/climb.ts --seeds 1-8 --years 10 [--scenario first_light]
 *                                  [--no-crafts] [--no-arrivals] [--quiet] [--json out.json]
 *                                  [--set key=value ...]
 *
 * Development seeds only (1–999). This is how the thresholds in CRAFT_SPECS and the arrival
 * rule were set, and it is what the figures in docs/EVIDENCE.md on climbing were made with.
 * It costs nothing: no mind here is a model.
 */
import { writeFileSync } from "node:fs";
import { AGES, CRAFTS, TICKS_PER_DAY, createWorld, makeConfig, step, worldDigest, type SimEvent, type WorldConfig } from "../src/engine";
import { legacyOf, readAges, tally } from "../src/engine/metrics/ages";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function seedsOf(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let s = a as number; s <= (b ?? (a as number)); s++) out.push(s);
  }
  return out;
}

function overrides(): Partial<WorldConfig> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--set") continue;
    const kv = process.argv[i + 1] ?? "";
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const raw = kv.slice(eq + 1);
    out[kv.slice(0, eq)] = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
  }
  return out as Partial<WorldConfig>;
}

export interface ClimbYear {
  year: number;
  living: number;
  people: number;
  age: number;
  standing: number;
  legacy: number;
  crafts: number[];
  works: { fields: number; granaries: number; houses: number; healingHouses: number; mills: number; recordHouses: number; dwellings: number; stores: number };
}
export interface ClimbRun {
  scenario: string;
  seed: number;
  years: ClimbYear[];
  ageDays: number[];
  deaths: Record<string, number>;
  counters: { discoveries: number; learned: number; inscribed: number; fieldHarvests: number; milled: number; careLaid: number; careSpent: number; arrivals: number };
  firsts: Record<string, number>;
  /** The first day on which the last age had been reached with no fewer alive than began (-1 = never in this run). */
  aimDay: number;
  /** The fewest alive on any morning. */
  fewest: number;
  digest: string;
  seconds: number;
}

export function climb(scenario: string, seed: number, years: number, over: Partial<WorldConfig>): ClimbRun {
  const cfg = makeConfig(scenario, seed, over);
  const world = createWorld(cfg);
  const yearDays = cfg.seasonDays.reduce((a, b) => a + b, 0);
  const out: SimEvent[] = [];
  const rows: ClimbYear[] = [];
  const firsts: Record<string, number> = {};
  let aimDay = -1;
  let fewest = cfg.population;
  const started = Date.now();
  for (let y = 0; y < years; y++) {
    for (let t = 0; t < yearDays * TICKS_PER_DAY; t++) {
      step(world, out);
      for (const e of out) {
        if (e.k === "discovered" || e.k === "learned") {
          const key = `${e.k}:${CRAFTS[e.q ?? 0]}`;
          if (firsts[key] === undefined) firsts[key] = Math.floor(e.t / TICKS_PER_DAY);
        }
      }
      out.length = 0;
      if (world.tick % TICKS_PER_DAY === 1) {
        let living = 0;
        for (const a of world.agents) if (a.alive) living++;
        if (living < fewest) fewest = living;
        if (aimDay < 0 && (world.metrics.ages[AGES.length - 1] as number) >= 0 && living >= cfg.population) aimDay = Math.floor(world.tick / TICKS_PER_DAY);
      }
    }
    const t = tally(world);
    const ages = readAges(world);
    const crafts = CRAFTS.map((_, c) => world.agents.filter((a) => a.alive && (a.lore & (1 << c)) !== 0).length);
    rows.push({
      year: y + 1,
      living: t.living,
      people: world.agents.length,
      age: ages.reached,
      standing: ages.standing,
      legacy: legacyOf(world).total,
      crafts,
      works: { fields: t.fields, granaries: t.granaries, houses: t.houses, healingHouses: t.healingHouses, mills: t.mills, recordHouses: t.recordHouses, dwellings: t.dwellings, stores: t.stores },
    });
    if (t.living === 0) break;
  }
  const m = world.metrics;
  return {
    scenario,
    seed,
    years: rows,
    ageDays: m.ages.map((tick) => (tick < 0 ? -1 : Math.floor(tick / TICKS_PER_DAY))),
    deaths: { ...m.deathsByCause },
    counters: { discoveries: m.discoveries, learned: m.learned, inscribed: m.inscribed, fieldHarvests: m.fieldHarvests, milled: m.milled, careLaid: m.careLaid, careSpent: m.careSpent, arrivals: m.arrivals },
    firsts,
    aimDay,
    fewest,
    digest: worldDigest(world),
    seconds: (Date.now() - started) / 1000,
  };
}

function main(): void {
  const scenario = arg("scenario", "first_light");
  const seeds = seedsOf(arg("seeds", "1-4"));
  if (seeds.some((s) => s < 1 || s > 999)) throw new Error("development seeds only (1–999)");
  const years = Number(arg("years", "8"));
  const over: Partial<WorldConfig> = { crafts: !flag("no-crafts"), arrivals: !flag("no-arrivals"), ...overrides() };
  const quiet = flag("quiet");
  const runs: ClimbRun[] = [];
  for (const seed of seeds) {
    const r = climb(scenario, seed, years, over);
    runs.push(r);
    const last = r.years[r.years.length - 1]!;
    console.log(`${scenario} seed ${seed}: after ${last.year} years ${last.living} alive of ${last.people} · ${AGES[last.age]}${last.standing < last.age ? ` (standing: ${AGES[last.standing]})` : ""} · legacy ${last.legacy} · ages on days ${r.ageDays.slice(1).join("/")} · fewest alive ${r.fewest} · aim ${r.aimDay < 0 ? "not met" : `met day ${r.aimDay}`} · ${r.seconds.toFixed(0)} s`);
    if (!quiet) {
      for (const y of r.years) {
        console.log(
          `   y${String(y.year).padStart(2)} alive ${String(y.living).padStart(3)}/${String(y.people).padStart(3)}  ${AGES[y.age]!.padEnd(8)} legacy ${String(y.legacy).padStart(5)}  know ${y.crafts.join(",").padEnd(18)} fields ${String(y.works.fields).padStart(3)} gran ${y.works.granaries} house ${String(y.works.houses).padStart(2)} heal ${y.works.healingHouses} mill ${y.works.mills} rec ${y.works.recordHouses}  beds ${y.works.dwellings} stores ${y.works.stores}`,
        );
      }
      console.log(`   deaths ${JSON.stringify(r.deaths)}  ${JSON.stringify(r.counters)}`);
      console.log(`   first ${Object.entries(r.firsts).map(([k, d]) => `${k}@${d}`).join(" ")}`);
    }
  }
  const final = runs.map((r) => r.years[r.years.length - 1]!);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`\n${runs.length} islands after ${years} years: alive ${mean(final.map((f) => f.living)).toFixed(1)} on average (${Math.min(...final.map((f) => f.living))}–${Math.max(...final.map((f) => f.living))}); died out ${final.filter((f) => f.living === 0).length}; age reached ${AGES.map((name, i) => `${name} ${final.filter((f) => f.age === i).length}`).join(", ")}; the last age with no fewer alive than began: ${runs.filter((r) => r.aimDay >= 0).length} of ${runs.length}`);
  const file = arg("json", "");
  if (file) writeFileSync(file, `${JSON.stringify({ scenario, years, overrides: over, runs }, null, 1)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("climb.ts")) main();
