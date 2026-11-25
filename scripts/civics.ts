/**
 * What institutions did in a run: a per-seed account for each institution mode.
 *
 *   pnpm exec tsx scripts/civics.ts [--scenario long_winter] [--seeds 1-6] [--days 40]
 *                                   [--modes off,scripted_control,grammar_search] [--set key=value ...]
 *
 * Development tool. Seeds are paired across modes (same island, people and weather). The
 * emergence ladder (E1–E4) is computed from logged events as registered in the protocol;
 * `scripted_control` is reported but is never emergence.
 */
import { SocietyTracker, TICKS_PER_DAY, createWorld, makeConfig, step, summarize, type InstitutionMode, type SimEvent, type WorldConfig } from "../src/engine";

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
const [lo, hi] = arg("seeds", "1-4").split("-").map(Number) as [number, number];
const days = Number(arg("days", "40"));
const scenario = arg("scenario", "first_light");
const modes = arg("modes", "off,scripted_control,grammar_search").split(",") as InstitutionMode[];
const pad = (s: string | number, n: number) => String(s).padStart(n);

console.log(`scenario=${scenario} days=${days} overrides=${JSON.stringify(extra)}`);
console.log(`${pad("seed", 4)} ${pad("mode", 17)} ${pad("alive", 6)} ${pad("welfare", 8)} ${pad("commons", 8)} ${pad("E1", 3)} ${pad("E2", 3)} ${pad("E3", 3)} ${pad("E4", 3)} ${pad("coop", 5)} ${pad("recip", 6)} ${pad("trade", 6)} ${pad("Q", 5)} ${pad("excl", 5)}  events`);
const totals = new Map<string, { alive: number; welfare: number; n: number; e2: number; e4: number }>();
for (let seed = lo; seed <= (hi ?? lo); seed++) {
  for (const mode of modes) {
    const world = createWorld(makeConfig(scenario, seed, { ...(extra as Partial<WorldConfig>), policy: "planner", institutions: mode }));
    const out: SimEvent[] = [];
    const counts: Record<string, number> = {};
    const tracker = new SocietyTracker(world.agents.length);
    for (let t = 0; t < days * TICKS_PER_DAY; t++) {
      step(world, out);
      for (const e of out) {
        tracker.push(e);
        if (["proposal", "proposal_rejected", "endorse", "ratified", "lapsed", "joined", "left", "expelled", "motion", "vote", "obligation", "breach", "sanction", "dissolved", "pact", "pact_done"].includes(e.k)) counts[e.k] = (counts[e.k] ?? 0) + 1;
        if (e.k === "decision" && ["pay_dues", "draw_ration", "sign", "propose"].includes(e.r ?? "")) counts[`d:${e.r}`] = (counts[`d:${e.r}`] ?? 0) + 1;
      }
      out.length = 0;
    }
    const s = summarize(world);
    // the registered ladder and the society measures, from the ledger
    const soc = tracker.report(world);
    const { E1: e1, E2: e2, E3: e3, E4: e4 } = soc.institutions.ladder;
    const alive = world.agents.filter((a) => a.alive).length;
    console.log(`${pad(seed, 4)} ${pad(mode, 17)} ${pad(alive, 6)} ${pad((s.welfare / 10).toFixed(1), 8)} ${pad((s.commonsMin / 10).toFixed(1), 8)} ${pad(e1, 3)} ${pad(e2, 3)} ${pad(e3, 3)} ${pad(e4, 3)} ${pad(soc.cooperation, 5)} ${pad((soc.reciprocity / 1000).toFixed(2), 6)} ${pad(soc.tradeVolume, 6)} ${pad((soc.network.modularity / 1000).toFixed(2), 5)} ${pad(soc.exclusion.refusals, 5)}  ${JSON.stringify(counts)}`);
    const t = totals.get(mode) ?? { alive: 0, welfare: 0, n: 0, e2: 0, e4: 0 };
    t.alive += alive;
    t.welfare += s.welfare;
    t.n++;
    t.e2 += e2 > 0 ? 1 : 0;
    t.e4 += e4 > 0 ? 1 : 0;
    totals.set(mode, t);
  }
}
console.log("");
for (const [mode, t] of totals) console.log(`${pad(mode, 17)}: mean alive ${(t.alive / t.n).toFixed(1)}, welfare ${(t.welfare / t.n / 10).toFixed(1)}%, runs reaching E2 ${t.e2}/${t.n}, E4 ${t.e4}/${t.n}`);
