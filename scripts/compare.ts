/**
 * Baseline competence comparison: the same seeds under each policy, side by side.
 *
 *   pnpm compare -- [--scenario first_light] [--seeds 1-8] [--days 40] [--policies reflex,planner]
 *                   [--checkpoints 20,30,40] [--set key=value ...] [--json out.json]
 *
 * Seeds are paired: policy A and policy B face the same island, the same people and the same
 * weather. This is a development tool for tuning and for the phase 05 competence gate; it
 * uses development seeds (1–999) unless told otherwise and makes no confirmatory claim.
 */
import { writeFileSync } from "node:fs";
import { TICKS_PER_DAY, createWorld, makeConfig, run, summarize, totalGoods, type PolicyKind, type Summary, type WorldConfig, type WorldState } from "../src/engine";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
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

function seedList(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
    else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return out;
}

interface Row {
  seed: number;
  policy: string;
  alive: number[];
  summary: Summary;
  wild: number;
  held: number;
  stored: number;
  ms: number;
}

function wildFood(world: WorldState): number {
  let n = 0;
  for (let k = 0; k < world.nodes.count; k++) {
    const kind = world.nodes.kind[k] as number;
    if (kind === 0 || kind === 1 || kind === 6) n += world.nodes.amount[k] as number;
  }
  return n;
}

const scenario = arg("scenario", "first_light");
const seeds = seedList(arg("seeds", "1-6"));
const days = Number(arg("days", "40"));
const policies = arg("policies", "reflex,planner").split(",") as PolicyKind[];
const checkpoints = arg("checkpoints", String(days))
  .split(",")
  .map(Number)
  .filter((d) => d > 0 && d <= days);
const extra = overrides();

const rows: Row[] = [];
for (const seed of seeds) {
  for (const policy of policies) {
    const world = createWorld(makeConfig(scenario, seed, { ...extra, policy }));
    const started = performance.now();
    const alive: number[] = [];
    let day = 0;
    for (const cp of checkpoints) {
      run(world, (cp - day) * TICKS_PER_DAY);
      day = cp;
      alive.push(world.agents.filter((a) => a.alive).length);
    }
    if (day < days) run(world, (days - day) * TICKS_PER_DAY);
    const goods = totalGoods(world);
    let held = 0;
    for (const a of world.agents) if (a.alive) held += (a.inv[0] as number) + (a.inv[1] as number) + (a.inv[2] as number) + (a.inv[3] as number);
    let stored = 0;
    for (const s of world.structures) if (!s.removed) stored += (s.inv[0] as number) + (s.inv[1] as number) + (s.inv[2] as number) + (s.inv[3] as number);
    void goods;
    rows.push({ seed, policy, alive, summary: summarize(world), wild: wildFood(world), held, stored, ms: Math.round(performance.now() - started) });
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`scenario=${scenario} days=${days} seeds=${seeds.join(",")} overrides=${JSON.stringify(extra)}`);
console.log(`${pad("seed", 5)} ${pad("policy", 8)} ${checkpoints.map((c) => pad(`d${c}`, 5)).join("")} ${pad("welfare", 8)} ${pad("gini", 6)} ${pad("gifts", 6)} ${pad("built", 6)} ${pad("commons", 8)} ${pad("wild", 6)} ${pad("held", 5)} ${pad("stored", 7)}  deaths`);
for (const r of rows) {
  const s = r.summary;
  console.log(
    `${pad(r.seed, 5)} ${pad(r.policy, 8)} ${r.alive.map((n) => pad(n, 5)).join("")} ${pad((s.welfare / 10).toFixed(1), 8)} ${pad((s.gini / 1000).toFixed(2), 6)} ${pad(s.cooperation, 6)} ${pad(s.structuresBuilt, 6)} ${pad((s.commonsMin / 10).toFixed(1), 8)} ${pad(r.wild, 6)} ${pad(r.held, 5)} ${pad(r.stored, 7)}  ${JSON.stringify(s.deathsByCause)}`,
  );
}
console.log("");
for (const policy of policies) {
  const mine = rows.filter((r) => r.policy === policy);
  const mean = (f: (r: Row) => number) => mine.reduce((acc, r) => acc + f(r), 0) / Math.max(1, mine.length);
  const finals = mine.map((r) => r.alive[r.alive.length - 1] as number).sort((a, b) => a - b);
  const median = finals.length ? (finals[Math.floor((finals.length - 1) / 2)] as number) : 0;
  console.log(
    `${pad(policy, 8)}  alive at checkpoints (mean): ${checkpoints.map((_, i) => mean((r) => r.alive[i] as number).toFixed(1)).join(" / ")}   median final ${median}   min ${finals[0]}   welfare ${(mean((r) => r.summary.welfare) / 10).toFixed(1)}%   ${Math.round(mean((r) => r.ms))} ms/run`,
  );
}

const jsonPath = arg("json", "");
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ scenario, days, seeds, overrides: extra, checkpoints, rows }, null, 1));
