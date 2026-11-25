/**
 * Engine benchmarks (headless).
 *
 *   pnpm bench [-- --days 5] [--json evidence/phase-03/bench.json]
 *
 * Measures world generation, simulation throughput, memory and snapshot cost for the
 * reference 50-agent world and for stress populations. Numbers are properties of the
 * machine they were measured on; the script records that machine in its output.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname } from "node:path";
import { ENGINE_VERSION, TICKS_PER_DAY, createWorld, makeConfig, restoreWorld, serializeWorld, snapshotHash, step, worldDigest, type SimEvent } from "../src/engine";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

interface Row {
  population: number;
  size: number;
  policy: string;
  worldgenMs: number;
  ticks: number;
  simMs: number;
  ticksPerSecond: number;
  microsPerAgentTick: number;
  p50TickMs: number;
  p95TickMs: number;
  maxTickMs: number;
  events: number;
  aliveAtEnd: number;
  heapMb: number;
  snapshotKib: number;
  serializeMs: number;
  restoreMs: number;
  hashMs: number;
  digestMs: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

function bench(population: number, size: number, days: number, policy: "reflex" | "planner"): Row {
  const cfg = makeConfig("first_light", 1, { population, size, policy });
  let t0 = performance.now();
  const world = createWorld(cfg);
  const worldgenMs = performance.now() - t0;

  const out: SimEvent[] = [];
  // warm-up day (JIT, first exploration burst) is excluded from timings
  for (let t = 0; t < TICKS_PER_DAY; t++) {
    step(world, out);
    out.length = 0;
  }
  const ticks = days * TICKS_PER_DAY;
  const tickTimes: number[] = [];
  let events = 0;
  t0 = performance.now();
  for (let t = 0; t < ticks; t++) {
    const s = performance.now();
    step(world, out);
    tickTimes.push(performance.now() - s);
    events += out.length;
    out.length = 0;
  }
  const simMs = performance.now() - t0;
  tickTimes.sort((a, b) => a - b);

  if (global.gc) global.gc();
  const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);

  t0 = performance.now();
  const text = serializeWorld(world);
  const serializeMs = performance.now() - t0;
  t0 = performance.now();
  snapshotHash(text);
  const hashMs = performance.now() - t0;
  t0 = performance.now();
  restoreWorld(text);
  const restoreMs = performance.now() - t0;
  t0 = performance.now();
  for (let k = 0; k < 20; k++) worldDigest(world);
  const digestMs = (performance.now() - t0) / 20;

  return {
    population,
    size,
    policy,
    worldgenMs: Math.round(worldgenMs * 10) / 10,
    ticks,
    simMs: Math.round(simMs),
    ticksPerSecond: Math.round(ticks / (simMs / 1000)),
    microsPerAgentTick: Math.round(((simMs * 1000) / (ticks * population)) * 100) / 100,
    p50TickMs: Math.round(quantile(tickTimes, 0.5) * 1000) / 1000,
    p95TickMs: Math.round(quantile(tickTimes, 0.95) * 1000) / 1000,
    maxTickMs: Math.round((tickTimes[tickTimes.length - 1] ?? 0) * 1000) / 1000,
    events,
    aliveAtEnd: world.agents.filter((a) => a.alive).length,
    heapMb: Math.round(heapMb * 10) / 10,
    snapshotKib: Math.round(text.length / 1024),
    serializeMs: Math.round(serializeMs * 10) / 10,
    restoreMs: Math.round(restoreMs * 10) / 10,
    hashMs: Math.round(hashMs * 10) / 10,
    digestMs: Math.round(digestMs * 100) / 100,
  };
}

function main(): void {
  const days = Number(arg("days", "5"));
  const policy = arg("policy", "reflex") as "reflex" | "planner";
  const plan: [number, number][] = [
    [50, 64],
    [100, 64],
    [250, 96],
    [500, 128],
  ];
  const rows = plan.map(([population, size]) => bench(population, size, days, policy));
  const env = {
    date: new Date().toISOString(),
    engine: ENGINE_VERSION,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    note: "single thread, headless, warm-up day excluded",
  };
  console.log(`engine ${env.engine} · ${env.node} · ${env.cpu} × ${env.cores} · ${env.memoryGb} GB · policy=${policy} · ${days} days measured`);
  console.table(
    rows.map((r) => ({
      agents: r.population,
      map: `${r.size}²`,
      "ticks/s": r.ticksPerSecond,
      "µs/agent-tick": r.microsPerAgentTick,
      "p50 tick ms": r.p50TickMs,
      "p95 tick ms": r.p95TickMs,
      "max tick ms": r.maxTickMs,
      "alive end": r.aliveAtEnd,
      "heap MB": r.heapMb,
      "snapshot KiB": r.snapshotKib,
      "serialize ms": r.serializeMs,
      "restore ms": r.restoreMs,
      "sha256 ms": r.hashMs,
      "digest ms": r.digestMs,
      "worldgen ms": r.worldgenMs,
    })),
  );
  const json = arg("json", "");
  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, JSON.stringify({ env, days, rows }, null, 2) + "\n");
    console.log(`wrote ${json}`);
  }
}

main();
