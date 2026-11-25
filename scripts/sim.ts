/**
 * Headless seeded simulation with a text report.
 *
 *   pnpm sim -- --scenario first_light --seed 1 --days 40 [--policy reflex|planner]
 *               [--population 50] [--replay] [--trace N] [--set key=value ...]
 *
 * --replay   run the same configuration twice and compare per-day digests and the final
 *            snapshot hash (determinism check)
 * --trace N  print the first N events
 * --set      override any integer/boolean/string config field, e.g. --set richness=700
 */
import {
  BIOMES,
  ITEMS,
  NODE_KINDS,
  SEASONS,
  TICKS_PER_DAY,
  WEATHER,
  calendarAt,
  createWorld,
  makeConfig,
  serializeWorld,
  snapshotHash,
  step,
  summarize,
  totalGoods,
  worldDigest,
  type SimEvent,
  type WorldConfig,
  type WorldState,
} from "../src/engine";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function overrides(): Partial<WorldConfig> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--set") continue;
    const kv = process.argv[i + 1] ?? "";
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const key = kv.slice(0, eq);
    const raw = kv.slice(eq + 1);
    out[key] = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
  }
  if (process.argv.includes("--policy")) out.policy = arg("policy", "planner");
  if (process.argv.includes("--population")) out.population = Number(arg("population", "50"));
  return out as Partial<WorldConfig>;
}

function describeWorld(world: WorldState): void {
  const t = world.terrain;
  const biomeCounts = new Array<number>(BIOMES.length).fill(0);
  let streams = 0;
  let ponds = 0;
  let freshTiles = 0;
  for (let i = 0; i < t.w * t.h; i++) {
    biomeCounts[t.biome[i] as number]!++;
    if (t.water[i] === 2) streams++;
    if (t.water[i] === 3) ponds++;
    if ((t.fresh[i] as number) > 0) freshTiles++;
  }
  const nodeCounts = new Array<number>(NODE_KINDS.length).fill(0);
  const nodeStock = new Array<number>(NODE_KINDS.length).fill(0);
  for (let n = 0; n < world.nodes.count; n++) {
    nodeCounts[world.nodes.kind[n] as number]!++;
    nodeStock[world.nodes.kind[n] as number]! += world.nodes.amount[n] as number;
  }
  console.log(`world ${t.w}×${t.h}  land ${t.landCount} (${((100 * t.landCount) / (t.w * t.h)).toFixed(1)}%)  streams ${streams}  ponds ${ponds}  drinkable tiles ${freshTiles}`);
  console.log(`biomes  ${BIOMES.map((b, i) => `${b} ${biomeCounts[i]}`).join("  ")}`);
  console.log(`nodes   ${NODE_KINDS.map((k, i) => `${k} ${nodeCounts[i]} (stock ${nodeStock[i]})`).join("  ")}`);
  console.log(`terrain hash ${t.hash.slice(0, 16)}  config hash ${world.meta.configHash.slice(0, 16)}`);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function statusLine(world: WorldState): string {
  const cal = calendarAt(world.config, world.tick);
  const alive = world.agents.filter((a) => a.alive);
  const goods = totalGoods(world);
  const f = (x: number) => String(Math.round(x)).padStart(4);
  let stockFood = 0;
  for (let n = 0; n < world.nodes.count; n++) {
    const k = world.nodes.kind[n] as number;
    if (k === 0 || k === 1 || k === 6) stockFood += world.nodes.amount[n] as number;
  }
  const fires = world.structures.filter((s) => s.complete && !s.removed && s.kind === 0 && s.fuel > 0).length;
  const shelters = world.structures.filter((s) => s.complete && !s.removed && s.kind === 1).length;
  const stores = world.structures.filter((s) => s.complete && !s.removed && s.kind === 2).length;
  const plots = world.structures.filter((s) => s.complete && !s.removed && s.kind === 3).length;
  return [
    `day ${String(cal.day).padStart(3)} ${SEASONS[cal.season]!.padEnd(6)}`,
    `${(world.climate.temp / 10).toFixed(1).padStart(5)}°C ${WEATHER[world.climate.weather]!.padEnd(8)}`,
    `alive ${String(alive.length).padStart(3)}`,
    `E${f(mean(alive.map((a) => a.energy)))} H${f(mean(alive.map((a) => a.hydration)))} R${f(mean(alive.map((a) => a.rest)))} W${f(mean(alive.map((a) => a.warmth)))} hp${f(mean(alive.map((a) => a.health)))}`,
    `food carried ${String((goods[0] ?? 0) + (goods[1] ?? 0) + (goods[2] ?? 0) + (goods[3] ?? 0)).padStart(4)} wild ${String(stockFood).padStart(5)}`,
    `fires ${fires} shelters ${shelters} stores ${stores} plots ${plots}`,
  ].join("  ");
}

interface RunResult {
  world: WorldState;
  digests: string[];
  histogram: Map<string, number>;
  events: number;
  ms: number;
  trace: SimEvent[];
}

function runOnce(cfg: WorldConfig, days: number, verbose: boolean, traceN: number): RunResult {
  const world = createWorld(cfg);
  if (verbose) describeWorld(world);
  const out: SimEvent[] = [];
  const histogram = new Map<string, number>();
  const digests: string[] = [];
  const trace: SimEvent[] = [];
  let events = 0;
  const started = performance.now();
  for (let d = 0; d < days; d++) {
    if (verbose && (d % 5 === 0 || d === days - 1)) console.log(statusLine(world));
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      step(world, out);
      for (const e of out) {
        const key = e.k === "rejected" ? `rejected:${e.r}` : e.k === "death" ? `death:${e.r}` : e.k === "decision" ? `decision:${e.r}` : e.k;
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
        if (trace.length < traceN) trace.push(e);
      }
      events += out.length;
      out.length = 0;
    }
    digests.push(worldDigest(world));
  }
  const ms = performance.now() - started;
  if (verbose) console.log(statusLine(world));
  return { world, digests, histogram, events, ms, trace };
}

function main(): void {
  const scenario = arg("scenario", "first_light");
  const seed = Number(arg("seed", "1"));
  const days = Number(arg("days", "40"));
  const traceN = Number(arg("trace", "0"));
  const cfg = makeConfig(scenario, seed, overrides());
  console.log(`TABULA RASA headless run — scenario=${scenario} seed=${seed} days=${days} policy=${cfg.policy} population=${cfg.population}`);

  const a = runOnce(cfg, days, true, traceN);
  const s = summarize(a.world);
  const ticks = days * TICKS_PER_DAY;
  console.log("");
  console.log(`ticks ${ticks}  events ${a.events}  wall ${a.ms.toFixed(0)} ms  (${(ticks / (a.ms / 1000)).toFixed(0)} ticks/s, ${((a.ms * 1000) / (ticks * cfg.population)).toFixed(2)} µs per agent-tick)`);
  console.log(`survival ${(s.survival / 10).toFixed(1)}%  welfare ${(s.welfare / 10).toFixed(1)}% (living ${(s.welfareLiving / 10).toFixed(1)}%)  gini ${(s.gini / 1000).toFixed(3)}  cooperation ${s.cooperation}/1000 agent-days  specialization ${(s.specialization / 1000).toFixed(3)}  commons min ${(s.commonsMin / 10).toFixed(1)}%`);
  console.log(`deaths ${JSON.stringify(s.deathsByCause)}  structures built ${s.structuresBuilt}  decisions ${s.decisions}  rejected intents ${s.rejected}  utterances ${s.utterances}`);
  const top = [...a.histogram.entries()].sort((x, y) => y[1] - x[1]);
  console.log(`events  ${top.map(([k, v]) => `${k} ${v}`).join("  ")}`);
  const goods = totalGoods(a.world);
  console.log(`goods   ${ITEMS.map((n, i) => `${n} ${goods[i]}`).filter((_, i) => (goods[i] ?? 0) > 0).join("  ")}`);
  const text = serializeWorld(a.world);
  const hash = snapshotHash(text);
  console.log(`final digest ${a.digests[a.digests.length - 1]}  snapshot ${hash}  (${(text.length / 1024).toFixed(0)} KiB)`);

  if (traceN > 0) {
    console.log("\ntrace");
    for (const e of a.trace) console.log(JSON.stringify(e));
  }

  if (flag("replay")) {
    const b = runOnce(cfg, days, false, 0);
    const hashB = snapshotHash(serializeWorld(b.world));
    let firstDiff = -1;
    for (let d = 0; d < a.digests.length; d++) {
      if (a.digests[d] !== b.digests[d]) {
        firstDiff = d;
        break;
      }
    }
    const ok = firstDiff === -1 && hash === hashB && a.events === b.events;
    console.log(`\nreplay  ${ok ? "IDENTICAL" : "DIVERGED"}  second run snapshot ${hashB}${firstDiff >= 0 ? `  first differing day ${firstDiff}` : ""}`);
    if (!ok) process.exit(1);
  }
}

main();
