/**
 * Mixed-population check: planners and reflex-only agents sharing one island.
 *
 *   pnpm exec tsx scripts/mixed.ts [--seeds 1-6] [--days 40] [--share 500] [--set key=value ...]
 *
 * Within one world both kinds face the same commons and the same winter, so a difference in
 * how they fare is a difference between the policies as individuals, not between societies.
 */
import { TICKS_PER_DAY, createWorld, makeConfig, run, type WorldConfig } from "../src/engine";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}
const extra: Record<string, unknown> = {};
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== "--set") continue;
  const kv = process.argv[i + 1] ?? "";
  const eq = kv.indexOf("=");
  if (eq > 0) extra[kv.slice(0, eq)] = /^-?\d+$/.test(kv.slice(eq + 1)) ? Number(kv.slice(eq + 1)) : kv.slice(eq + 1);
}
const [lo, hi] = arg("seeds", "1-6").split("-").map(Number) as [number, number];
const days = Number(arg("days", "40"));
const share = Number(arg("share", "500"));
const tot = { planner: { n: 0, alive: 0, welfare: 0, food: 0 }, reflex: { n: 0, alive: 0, welfare: 0, food: 0 } };
console.log(`days=${days} plannerShare=${share} overrides=${JSON.stringify(extra)}`);
for (let seed = lo; seed <= (hi ?? lo); seed++) {
  const world = createWorld(makeConfig(arg("scenario", "first_light"), seed, { ...(extra as Partial<WorldConfig>), policy: "planner", plannerShare: share }));
  run(world, days * TICKS_PER_DAY);
  const row: Record<string, string> = {};
  for (const kind of ["planner", "reflex"] as const) {
    const mine = world.agents.filter((a) => a.controller === kind);
    const alive = mine.filter((a) => a.alive);
    const welfare = mine.reduce((s, a) => s + a.stats.welfareSum / (days * TICKS_PER_DAY), 0);
    const food = alive.reduce((s, a) => s + (a.inv[0] as number) + (a.inv[1] as number) + (a.inv[2] as number) + (a.inv[3] as number), 0);
    tot[kind].n += mine.length;
    tot[kind].alive += alive.length;
    tot[kind].welfare += welfare;
    tot[kind].food += food;
    row[kind] = `${alive.length}/${mine.length} alive, welfare ${(welfare / Math.max(1, mine.length) / 10).toFixed(1)}%, food in hand ${food}`;
  }
  console.log(`seed ${String(seed).padStart(3)}  planner ${row.planner}   |   reflex ${row.reflex}`);
}
for (const kind of ["planner", "reflex"] as const) {
  const t = tot[kind];
  console.log(`${kind.padStart(8)}: survival ${((100 * t.alive) / Math.max(1, t.n)).toFixed(1)}% (${t.alive}/${t.n}), welfare incl. the dead ${(t.welfare / Math.max(1, t.n) / 10).toFixed(1)}%`);
}
