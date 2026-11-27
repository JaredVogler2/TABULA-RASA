/**
 * Metric accumulators updated inside the simulation (cheap, incremental) and the
 * state-derived measures defined in docs/EXPERIMENT_PROTOCOL.md §4.
 * Everything here is computed from engine state and events, never from agent self-reports.
 */
import { ITEM_COUNT, NODE_SPECS, NodeKind, TICKS_PER_DAY } from "../model/constants";
import { WORK_ACTIVITIES, type MetricsAcc, type WorldState } from "../model/types";
import { AGE_COUNT } from "../model/constants";
import { worthOf } from "../sim/inventory";

export function emptyMetrics(): MetricsAcc {
  return {
    days: 0,
    giniSum: 0,
    commonsMin: 1000,
    gives: 0,
    giveUnits: 0,
    pactTrades: 0,
    pactUnits: 0,
    institutionTransfers: 0,
    workTicks: 0,
    gatheredUnits: 0,
    projectsStarted: 0,
    projectsCompleted: 0,
    deaths: 0,
    deathsByCause: {},
    proposals: 0,
    ratified: 0,
    rejectedIntents: 0,
    utterances: 0,
    decisionsBySource: {},
    deliberations: 0,
    sources: new Array<number>(ITEM_COUNT).fill(0),
    sinks: new Array<number>(ITEM_COUNT).fill(0),
    discoveries: 0,
    learned: 0,
    inscribed: 0,
    fieldHarvests: 0,
    milled: 0,
    careLaid: 0,
    careSpent: 0,
    arrivals: 0,
    ages: new Array<number>(AGE_COUNT).fill(-1),
  };
}

/**
 * Gini coefficient of a list of non-negative values, in permille (0..1000).
 * Defined as 0 when there are fewer than two values or the total is zero.
 */
export function giniPermille(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.slice().sort((a, b) => a - b);
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] as number;
    total += x;
    weighted += (i + 1) * x;
  }
  if (total <= 0) return 0;
  const g = (2 * weighted) / (n * total) - (n + 1) / n;
  return Math.max(0, Math.min(1000, Math.round(g * 1000)));
}

/** Mean stock ratio (permille) of the renewable commons: berry bushes and fishing waters. */
export function commonsHealthPermille(world: WorldState): number {
  const nodes = world.nodes;
  let sum = 0;
  let count = 0;
  for (let n = 0; n < nodes.count; n++) {
    const kind = nodes.kind[n] as number;
    if (kind !== NodeKind.berry_bush && kind !== NodeKind.fishing_water) continue;
    if (!NODE_SPECS[kind]!.renewable) continue;
    sum += ((nodes.amount[n] as number) * 1000) / (nodes.cap[n] as number);
    count++;
  }
  return count === 0 ? 1000 : Math.round(sum / count);
}

/** Called at the end of each simulated day. */
export function sampleDay(world: WorldState): void {
  const m = world.metrics;
  const holdings: number[] = [];
  for (const a of world.agents) if (a.alive) holdings.push(worthOf(a.inv));
  m.giniSum += giniPermille(holdings);
  m.days++;
  // Winter die-back empties bushes by design; commons health tracks fishing waters all year
  // and bushes only outside winter, via the combined ratio sampled daily.
  const health = commonsHealthPermille(world);
  if (health < m.commonsMin) m.commonsMin = health;
}

export interface Summary {
  tick: number;
  day: number;
  population: number;
  alive: number;
  /** permille */
  survival: number;
  /** permille; welfare including mortality (dead agents contribute zero for the rest of the run) */
  welfare: number;
  /** permille; mean over living agent-ticks only */
  welfareLiving: number;
  /** permille, mean of daily samples */
  gini: number;
  /** validated voluntary transfers per 1000 living agent-days */
  cooperation: number;
  /** permille */
  reciprocity: number;
  /** permille; 1000 = every agent does a single kind of work */
  specialization: number;
  /** units gathered per 1000 work ticks */
  productivity: number;
  /** permille; minimum over time of mean commons stock ratio */
  commonsMin: number;
  structuresBuilt: number;
  projectsStarted: number;
  projectsCompleted: number;
  deathsByCause: Record<string, number>;
  decisions: number;
  rejected: number;
  utterances: number;
  proposals: number;
  ratified: number;
}

/** ln(x) for x in (0, 1] by a rapidly converging series on (1−x)/(1+x); deterministic arithmetic only. */
function lnUnit(x: number): number {
  if (x <= 0) return 0;
  // ln x = 2 · atanh((x−1)/(x+1))
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let k = 1; k < 60; k += 2) {
    sum += term / k;
    term *= z2;
  }
  return 2 * sum;
}

/**
 * Specialization index in permille: 1 − mean normalised Shannon entropy of each agent's
 * work-time shares over the productive activity classes. Agents with no work time are skipped.
 */
export function specializationPermille(world: WorldState): number {
  const k = WORK_ACTIVITIES.length;
  const lnK = -lnUnit(1 / k);
  let sum = 0;
  let n = 0;
  for (const a of world.agents) {
    let total = 0;
    for (const c of WORK_ACTIVITIES) total += a.stats.activity[c] as number;
    if (total < 24) continue;
    let hgt = 0;
    for (const c of WORK_ACTIVITIES) {
      const p = (a.stats.activity[c] as number) / total;
      if (p > 0) hgt -= p * lnUnit(p);
    }
    sum += 1 - hgt / lnK;
    n++;
  }
  return n === 0 ? 0 : Math.round((1000 * sum) / n);
}

/** Share (permille) of directed giving dyads A→B that are reciprocated B→A at any time. */
export function reciprocityPermille(world: WorldState): number {
  let dyads = 0;
  let mutual = 0;
  const agents = world.agents;
  for (const a of agents) {
    for (const b of agents) {
      if (a.id === b.id) continue;
      if ((a.mind.gave[b.id] as number) > 0) {
        dyads++;
        if ((b.mind.gave[a.id] as number) > 0) mutual++;
      }
    }
  }
  return dyads === 0 ? 0 : Math.round((1000 * mutual) / dyads);
}

export function summarize(world: WorldState): Summary {
  const m = world.metrics;
  const initial = world.config.population;
  let alive = 0;
  let welfareSum = 0;
  let aliveTicks = 0;
  let decisions = 0;
  for (const a of world.agents) {
    if (a.alive) alive++;
    welfareSum += a.stats.welfareSum;
    aliveTicks += a.stats.aliveTicks;
    decisions += a.stats.decisions;
  }
  const population = world.agents.length;
  const ticks = Math.max(1, world.tick);
  const agentDays = aliveTicks / TICKS_PER_DAY;
  let built = 0;
  for (const s of world.structures) if (s.complete) built++;
  return {
    tick: world.tick,
    day: Math.floor(world.tick / TICKS_PER_DAY),
    population,
    alive,
    survival: Math.round((1000 * alive) / Math.max(1, population)),
    welfare: Math.round(welfareSum / (Math.max(initial, population) * ticks)),
    welfareLiving: aliveTicks === 0 ? 0 : Math.round(welfareSum / aliveTicks),
    gini: m.days === 0 ? 0 : Math.round(m.giniSum / m.days),
    cooperation: agentDays === 0 ? 0 : Math.round((1000 * (m.gives + m.pactTrades + m.institutionTransfers)) / agentDays),
    reciprocity: reciprocityPermille(world),
    specialization: specializationPermille(world),
    productivity: m.workTicks === 0 ? 0 : Math.round((1000 * m.gatheredUnits) / m.workTicks),
    commonsMin: m.commonsMin,
    structuresBuilt: built,
    projectsStarted: m.projectsStarted,
    projectsCompleted: m.projectsCompleted,
    deathsByCause: { ...m.deathsByCause },
    decisions,
    rejected: m.rejectedIntents,
    utterances: m.utterances,
    proposals: m.proposals,
    ratified: m.ratified,
  };
}
