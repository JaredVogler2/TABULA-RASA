/**
 * Compare the three activation policies on the same worlds, at no cost.
 *
 *   pnpm schedulers -- --seeds 1-4 --days 6 --slots 8
 *
 * Minds are the mock provider (a deterministic test double), so this measures what the
 * policies do with a ration of deliberation — how many calls they make, to whom, for what
 * stated reason, and what share of people's time is spent carrying out a plan of their own
 * rather than acting on reflex (from each plan's adoption to the next decision of any kind)
 * — and what those calls would have had reserved for them at current prices. It says
 * nothing about how good a model's decisions would be: the outcome columns are there to show
 * that the worlds are comparable, not to rank policies.
 *
 * Development seeds only (1–999).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { TICKS_PER_DAY, createWorld, makeConfig, type SimEvent, type WorldState } from "../src/engine";
import { MockProvider } from "../src/providers/mock";
import { PRICE_TABLE, formatUsd, priceOf, worstCaseCost } from "../src/providers/prices";
import { inputTokenBound } from "../src/providers/prompt";
import { DEFAULT_SPEC, ask, callFor, commitEpoch, planEpoch, type RunSpec } from "../src/providers/run";
import { SCHEDULER_KINDS, newSchedulerState, type SchedulerKind } from "../src/providers/schedule";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

function seedsOf(text: string): number[] {
  const m = /^(\d+)-(\d+)$/.exec(text);
  const list = m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i) : text.split(",").map(Number);
  for (const s of list) if (!Number.isInteger(s) || s < 1 || s > 999) throw new Error("development seeds are 1–999; holdout seeds are not for this script");
  return list;
}

function gini(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const total = v.reduce((s, x) => s + x, 0);
  if (n === 0 || total === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * (v[i] as number);
  return acc / (n * total);
}

interface Row {
  scheduler: SchedulerKind;
  seed: number;
  calls: number;
  slotsUsed: number;
  callsPerPersonDay: number;
  gini: number;
  maxShare: number;
  neverAsked: number;
  ownPlanShare: number;
  accepted: number;
  refused: number;
  alive: number;
  agreements: number;
  reasons: Record<string, number>;
  /** Sum over the calls actually made of the byte bound on their input, and the bound's mean. */
  inputBoundTokens: number;
  reservedMicroUsd: Record<string, number>;
}

async function one(kind: SchedulerKind, seed: number, days: number, slots: number, population: number, maxTokens: number): Promise<Row> {
  const epochTicks = 24;
  const cfg = makeConfig("first_light", seed, { population, externalShare: 1000, institutions: "open", cadence: epochTicks });
  const spec: RunSpec = { ...DEFAULT_SPEC, provider: "mock", epochTicks, epochs: (days * TICKS_PER_DAY) / epochTicks, maxTokens, scheduler: { kind, callsPerEpoch: slots, maxPerAgentPerDay: 3, starveAfterEpochs: 12 } };
  const world: WorldState = createWorld(cfg);
  const provider = new MockProvider();
  let st = newSchedulerState(world.agents.length);
  const perAgent = new Array<number>(world.agents.length).fill(0);
  const reasons: Record<string, number> = {};
  let calls = 0;
  let accepted = 0;
  let refused = 0;
  let inputBound = 0;
  // for each person: when their current plan was adopted and whether an outside mind made it
  const since = new Array<number>(world.agents.length).fill(0);
  const own = new Array<boolean>(world.agents.length).fill(false);
  let ownTicks = 0;
  let allTicks = 0;
  const account = (events: SimEvent[]): void => {
    for (const ev of events) {
      if (ev.k !== "decision" || ev.a < 0) continue;
      const d = ev.d as { src?: string; n?: number } | undefined;
      // a refused decision adopts nothing: the plan in force stays in force
      if (d?.src === "mock" && d.n === 0) continue;
      const span = ev.t - (since[ev.a] as number);
      allTicks += span;
      if (own[ev.a]) ownTicks += span;
      since[ev.a] = ev.t;
      own[ev.a] = d?.src === "mock";
    }
  };
  const models = Object.keys(PRICE_TABLE.models);
  const reserved: Record<string, number> = Object.fromEntries(models.map((m) => [m, 0]));
  for (let e = 0; e < spec.epochs; e++) {
    const plan = planEpoch(world, spec, st, e);
    for (const act of plan.schedule.activations) {
      const call = callFor("cmp", cfg, spec, plan, act, 1);
      const bound = inputTokenBound(call.request);
      inputBound += bound;
      for (const m of models) reserved[m] = (reserved[m] as number) + worstCaseCost(priceOf(m)!, bound, maxTokens, "5m");
      const key = act.reason.replace(/^voi:/, "").split("+")[0] as string;
      reasons[key] = (reasons[key] ?? 0) + 1;
      perAgent[act.agent] = (perAgent[act.agent] as number) + 1;
    }
    const asked = await ask("cmp", cfg, spec, plan, provider);
    const result = commitEpoch(world, spec, plan, asked, "mock", account);
    st = plan.schedule.next;
    calls += result.outcomes.length;
    for (const o of result.outcomes) {
      accepted += o.accepted;
      refused += o.refused;
    }
  }
  let alive = 0;
  for (const a of world.agents) {
    if (a.alive) alive++;
    // close each person's last plan at the end of the run (or at their death)
    const end = a.alive ? world.tick : a.diedTick;
    const span = Math.max(0, end - (since[a.id] as number));
    allTicks += span;
    if (own[a.id]) ownTicks += span;
  }
  return {
    scheduler: kind,
    seed,
    calls,
    slotsUsed: calls / (spec.epochs * slots),
    callsPerPersonDay: calls / (population * days),
    gini: gini(perAgent),
    maxShare: calls ? Math.max(...perAgent) / calls : 0,
    neverAsked: perAgent.filter((n) => n === 0).length,
    ownPlanShare: allTicks ? ownTicks / allTicks : 0,
    accepted,
    refused,
    alive,
    agreements: world.inst.proposals.length,
    reasons,
    inputBoundTokens: inputBound,
    reservedMicroUsd: reserved,
  };
}

async function main(): Promise<void> {
  const seeds = seedsOf(arg("seeds", "1-4"));
  const days = Number(arg("days", "6"));
  const slots = Number(arg("slots", "8"));
  const population = Number(arg("population", "50"));
  const maxTokens = Number(arg("max-tokens", "2000"));
  const rows: Row[] = [];
  for (const kind of SCHEDULER_KINDS) for (const seed of seeds) rows.push(await one(kind, seed, days, slots, population, maxTokens));

  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
  console.log(`\nActivation policies on the same worlds — mock minds, ${population} people, ${days} days, ${slots} slots per 6-hour epoch, seeds ${seeds.join(",")}`);
  console.log("(means over seeds; mock minds are a test double: outcomes here say nothing about a model)\n");
  const head = ["policy", "calls", "slots used", "calls/person/day", "Gini of calls", "largest share", "never asked", "time on own plan", "intents ok / refused", "alive", "agreements"];
  console.log(head.join(" | "));
  console.log(head.map(() => "---").join(" | "));
  const summary: Record<string, unknown>[] = [];
  for (const kind of SCHEDULER_KINDS) {
    const r = rows.filter((x) => x.scheduler === kind);
    const line = [
      kind,
      mean(r.map((x) => x.calls)).toFixed(0),
      pct(mean(r.map((x) => x.slotsUsed))),
      mean(r.map((x) => x.callsPerPersonDay)).toFixed(2),
      mean(r.map((x) => x.gini)).toFixed(2),
      pct(mean(r.map((x) => x.maxShare))),
      mean(r.map((x) => x.neverAsked)).toFixed(1),
      pct(mean(r.map((x) => x.ownPlanShare))),
      `${mean(r.map((x) => x.accepted)).toFixed(0)} / ${mean(r.map((x) => x.refused)).toFixed(0)}`,
      mean(r.map((x) => x.alive)).toFixed(1),
      mean(r.map((x) => x.agreements)).toFixed(1),
    ];
    console.log(line.join(" | "));
    const reasons: Record<string, number> = {};
    for (const x of r) for (const [k, v] of Object.entries(x.reasons)) reasons[k] = (reasons[k] ?? 0) + v;
    summary.push({ scheduler: kind, calls: mean(r.map((x) => x.calls)), slotsUsed: mean(r.map((x) => x.slotsUsed)), callsPerPersonDay: mean(r.map((x) => x.callsPerPersonDay)), gini: mean(r.map((x) => x.gini)), maxShare: mean(r.map((x) => x.maxShare)), neverAsked: mean(r.map((x) => x.neverAsked)), ownPlanShare: mean(r.map((x) => x.ownPlanShare)), alive: mean(r.map((x) => x.alive)), reasons });
  }

  console.log("\nFirst-named reason for each consultation (all seeds):");
  for (const s of summary) {
    const reasons = Object.entries(s.reasons as Record<string, number>).sort((a, b) => b[1] - a[1]);
    console.log(`  ${String(s.scheduler).padEnd(12)} ${reasons.map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }

  console.log(`\nWhat the ledger would have reserved for these calls (worst case per call: every input byte a token at the cache-write price, all ${maxTokens} output tokens, 10% regional margin; no cache hit assumed). Prices verified ${PRICE_TABLE.verifiedOn}. This is an upper bound, not an estimate of spend; nothing was called.`);
  const models = Object.keys(PRICE_TABLE.models);
  console.log(["policy", "mean input bound / call (tokens)", ...models].join(" | "));
  console.log(["---", "---", ...models.map(() => "---")].join(" | "));
  for (const kind of SCHEDULER_KINDS) {
    const r = rows.filter((x) => x.scheduler === kind);
    const calls = r.reduce((s, x) => s + x.calls, 0);
    console.log([kind, (r.reduce((s, x) => s + x.inputBoundTokens, 0) / Math.max(1, calls)).toFixed(0), ...models.map((m) => `${formatUsd(mean(r.map((x) => x.reservedMicroUsd[m] as number)))} (${formatUsd(r.reduce((s, x) => s + (x.reservedMicroUsd[m] as number), 0) / Math.max(1, calls), 3)}/call)`)].join(" | "));
  }

  const out = arg("out", "");
  if (out) {
    mkdirSync(out.slice(0, Math.max(0, out.lastIndexOf("/"))) || ".", { recursive: true });
    writeFileSync(out, `${JSON.stringify({ generated: "pnpm schedulers", minds: "mock (test double)", population, days, slots, maxTokens, seeds, pricesVerifiedOn: PRICE_TABLE.verifiedOn, rows }, null, 2)}\n`);
    console.log(`\nwrote ${out}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
