/**
 * The study registry: every registered hypothesis of docs/EXPERIMENT_PROTOCOL.md §6 as data —
 * its conditions, the measure it is about, and the rule that would falsify it — plus the one
 * function that runs a world to its horizon and returns the registered measures.
 *
 * A study is a set of conditions run on the same seeds. Conditions differ only in the
 * configuration overrides written here; everything else, including geography, people and
 * weather, is fixed by the seed (common random numbers), so analyses are paired by seed.
 */
import { DEFAULT_CONFIG, SocietyTracker, TICKS_PER_DAY, createWorld, makeConfig, serializeWorld, snapshotHash, step, summarize, worldDigest, type SimEvent, type WorldConfig } from "@/engine";

export const HORIZON_DAYS = 40;
export const DEVELOPMENT_SEEDS: readonly [number, number] = [1, 999];
export const HOLDOUT_SEEDS: readonly [number, number] = [9000, 9999];

export type Metric =
  | "survival"
  | "welfare"
  | "gini"
  | "cooperation"
  | "reciprocity"
  | "specialization"
  | "productivity"
  | "tradeVolume"
  | "modularity"
  | "commonsMin"
  | "e2"
  | "e4"
  | "ratified"
  | "decisions"
  | "deliberations";

export const METRIC_LABEL: Record<Metric, { label: string; unit: string; digits: number }> = {
  survival: { label: "Survival", unit: "share alive at the horizon", digits: 3 },
  welfare: { label: "Welfare", unit: "mean of the worst need, 0–1, the dead counted as 0", digits: 3 },
  gini: { label: "Inequality of holdings", unit: "Gini, 0–1", digits: 3 },
  cooperation: { label: "Voluntary cooperation", unit: "transfers per living agent-day", digits: 4 },
  reciprocity: { label: "Reciprocity", unit: "share of dyads answered within 5 days", digits: 3 },
  specialization: { label: "Specialization", unit: "0 (everyone does everything) – 1", digits: 3 },
  productivity: { label: "Productivity", unit: "units gathered per work tick", digits: 3 },
  tradeVolume: { label: "Trade volume", unit: "units per living agent-day", digits: 4 },
  modularity: { label: "Network modularity", unit: "Newman Q", digits: 3 },
  commonsMin: { label: "Commons health", unit: "lowest mean stock ratio, 0–1", digits: 3 },
  e2: { label: "Reached E2 (adopted)", unit: "1 if any institution was ratified by ≥ 3 members", digits: 2 },
  e4: { label: "Reached E4 (persistent)", unit: "1 if any non-scripted institution lasted ≥ 10 days", digits: 2 },
  ratified: { label: "Institutions ratified", unit: "count", digits: 2 },
  decisions: { label: "Decisions", unit: "plans adopted, of any kind", digits: 0 },
  deliberations: { label: "Deliberations", unit: "times a planner was consulted", digits: 0 },
};

export interface Condition {
  id: string;
  label: string;
  scenario: string;
  overrides: Partial<WorldConfig>;
}

export interface Contrast {
  id: string;
  /** The registered hypothesis this tests ("H1" …), or "pilot" / "exploratory". */
  hypothesis: string;
  metric: Metric;
  /** The claim is about mean(a − b) for "difference", or mean(a) / mean(b) for "ratio". */
  a: string;
  b: string;
  kind: "difference" | "ratio";
  /**
   * What the registered text predicts: "greater" (the interval must lie wholly above the bound),
   * "less" (wholly below), "at-least" (lower end at or above the bound), "at-most" (upper end at or
   * below it), or "two-sided" (no prediction; the interval is reported).
   */
  predicts: "greater" | "less" | "at-least" | "at-most" | "two-sided";
  bound: number;
  text: string;
}

export interface Study {
  id: string;
  title: string;
  /** True for the confirmatory family: to be run on holdout seeds, once, at the registered seed count. */
  registered: boolean;
  days: number;
  conditions: Condition[];
  contrasts: Contrast[];
  note: string;
}

/** A richness level multiplies both how many resource nodes there are and how much each holds (protocol §3). */
function richness(level: number): Partial<WorldConfig> {
  return { richness: Math.round(DEFAULT_CONFIG.richness * level), nodeDensity: Math.round(DEFAULT_CONFIG.nodeDensity * level) };
}

const PLANNER: Partial<WorldConfig> = { policy: "planner", plannerShare: 1000, externalShare: 0 };

export const STUDIES: readonly Study[] = [
  {
    id: "h1-scarcity",
    title: "H1 — Scarcity and cooperation (inverted U)",
    registered: true,
    days: HORIZON_DAYS,
    conditions: [
      { id: "r04", label: "richness 0.4", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", ...richness(0.4) } },
      { id: "r07", label: "richness 0.7", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", ...richness(0.7) } },
      { id: "r13", label: "richness 1.3", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", ...richness(1.3) } },
    ],
    contrasts: [
      { id: "h1a", hypothesis: "H1", metric: "cooperation", a: "r07", b: "r13", kind: "difference", predicts: "greater", bound: 0, text: "Cooperation is higher at richness 0.7 than at 1.3." },
      { id: "h1b", hypothesis: "H1", metric: "cooperation", a: "r07", b: "r04", kind: "difference", predicts: "greater", bound: 0, text: "Cooperation is higher at richness 0.7 than at 0.4." },
    ],
    note: "Planner agents, institutions off. Falsified if either interval includes zero or has the opposite sign.",
  },
  {
    id: "h2-mobility",
    title: "H2 — Mobility and specialization",
    registered: true,
    days: HORIZON_DAYS,
    conditions: [
      { id: "m10", label: "movement cost 1.0", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", movementCost: 1000 } },
      { id: "m20", label: "movement cost 2.0", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", movementCost: 2000 } },
    ],
    contrasts: [{ id: "h2", hypothesis: "H2", metric: "specialization", a: "m20", b: "m10", kind: "difference", predicts: "greater", bound: 0, text: "Doubling the cost of movement raises the specialization index." }],
    note: "Falsified if the paired difference is ≤ 0 or its interval includes zero.",
  },
  {
    id: "h3-communication",
    title: "H3 — Communication range and adoption",
    registered: true,
    days: HORIZON_DAYS,
    conditions: [
      { id: "h2r", label: "hearing radius 2", scenario: "first_light", overrides: { ...PLANNER, institutions: "grammar_search", hearingRadius: 2 } },
      { id: "h9r", label: "hearing radius 9", scenario: "first_light", overrides: { ...PLANNER, institutions: "grammar_search", hearingRadius: 9 } },
    ],
    contrasts: [{ id: "h3", hypothesis: "H3", metric: "e2", a: "h9r", b: "h2r", kind: "difference", predicts: "greater", bound: 0, text: "More runs reach E2 when voices carry nine tiles than when they carry two." }],
    note: "Institutions by grammar search. Falsified if the paired difference in the E2 indicator is ≤ 0 or its interval includes zero.",
  },
  {
    id: "h4-diversity",
    title: "H4 — Diversity and resilience",
    registered: true,
    days: HORIZON_DAYS,
    conditions: [
      { id: "d02", label: "diversity 0.2", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", diversity: 200, shocks: [{ kind: "blight", minDay: 15, maxDay: 15, days: 0, magnitude: 1000 }] } },
      { id: "d10", label: "diversity 1.0", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", diversity: 1000, shocks: [{ kind: "blight", minDay: 15, maxDay: 15, days: 0, magnitude: 1000 }] } },
    ],
    contrasts: [{ id: "h4", hypothesis: "H4", metric: "survival", a: "d10", b: "d02", kind: "difference", predicts: "greater", bound: 0, text: "After the same blight on day 16, more people survive where temperaments and skills vary more." }],
    note: "Both conditions receive an identical blight on day 16. Falsified if the paired difference is ≤ 0 or its interval includes zero.",
  },
  {
    id: "h5-cadence",
    title: "H5 — Cadence has diminishing returns",
    registered: true,
    days: HORIZON_DAYS,
    conditions: [
      { id: "c12", label: "deliberate every 12 ticks", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", planEvery: 12 } },
      { id: "c48", label: "deliberate every 48 ticks", scenario: "first_light", overrides: { ...PLANNER, institutions: "off", planEvery: 48 } },
    ],
    contrasts: [
      { id: "h5a", hypothesis: "H5", metric: "welfare", a: "c48", b: "c12", kind: "ratio", predicts: "at-least", bound: 0.9, text: "Welfare at cadence 48 is at least 90% of welfare at cadence 12." },
      { id: "h5b", hypothesis: "H5", metric: "deliberations", a: "c48", b: "c12", kind: "ratio", predicts: "at-most", bound: 0.35, text: "…with at most 35% as many deliberations (the check that the treatment was applied)." },
    ],
    note: "The planner's clock is `planEvery`; between deliberations people act on reflex. Falsified if the lower 95% bound of the welfare ratio is below 0.90.",
  },
  {
    id: "h6-institutions",
    title: "H6 — Do institutions have anything to do? (The Long Winter)",
    registered: true,
    days: HORIZON_DAYS,
    conditions: [
      { id: "off", label: "institutions off", scenario: "long_winter", overrides: { ...PLANNER, institutions: "off" } },
      { id: "scripted", label: "scripted control", scenario: "long_winter", overrides: { ...PLANNER, institutions: "scripted_control" } },
      { id: "search", label: "grammar search", scenario: "long_winter", overrides: { ...PLANNER, institutions: "grammar_search" } },
    ],
    contrasts: [
      { id: "h6a", hypothesis: "H6a", metric: "survival", a: "scripted", b: "off", kind: "difference", predicts: "greater", bound: 0, text: "Positive control: a charter written by the designers raises survival." },
      { id: "h6b", hypothesis: "H6b", metric: "survival", a: "search", b: "off", kind: "difference", predicts: "two-sided", bound: 0, text: "Institutions found by non-LLM search change survival (no prediction of sign)." },
    ],
    note: "H6a failing would mean institutional affordances are not materially useful in this world, and every E5 claim is moot.",
  },
];

/** The development-seed pilot: every registered condition, to estimate the spread of each paired difference. */
export function studyById(id: string): Study | undefined {
  return STUDIES.find((s) => s.id === id);
}

/**
 * The configuration of one cell of a registered study, so that it can be opened as a world and
 * watched: the same seed and the same overrides the batch runner used, nothing else. Null if
 * the three names do not identify a cell.
 */
export function cellConfig(studyId: string, conditionId: string, seed: number): { config: WorldConfig; study: Study; condition: Condition } | null {
  const study = studyById(studyId);
  const condition = study?.conditions.find((c) => c.id === conditionId);
  if (!study || !condition || !Number.isInteger(seed) || seed < 1 || seed > 9999) return null;
  return { config: makeConfig(condition.scenario, seed, condition.overrides), study, condition };
}

export interface RunResult {
  study: string;
  condition: string;
  seed: number;
  days: number;
  /** Fast digest and content hash of the final state: re-running the same cell must reproduce both. */
  digest: string;
  sha256: string;
  configHash: string;
  alive: number;
  population: number;
  metrics: Record<Metric, number>;
  /** How many institutions reached each rung, by how they came to be proposed. */
  ladder: Record<string, { E1: number; E2: number; E3: number; E4: number }>;
  deaths: Record<string, number>;
  ms: number;
}

/** Run one cell of a study: one condition on one seed, from tick 0 to the horizon. */
export function runCell(study: Study, condition: Condition, seed: number, now: () => number = () => 0): RunResult {
  const started = now();
  const config = makeConfig(condition.scenario, seed, condition.overrides);
  const world = createWorld(config);
  const tracker = new SocietyTracker(world.agents.length);
  const out: SimEvent[] = [];
  for (let t = 0; t < study.days * TICKS_PER_DAY; t++) {
    step(world, out);
    for (const e of out) tracker.push(e);
    out.length = 0;
  }
  const s = summarize(world);
  const soc = tracker.report(world);
  const emergent = Object.entries(soc.institutions.byOrigin).filter(([origin]) => origin !== "scripted");
  const metrics: Record<Metric, number> = {
    survival: s.survival / 1000,
    welfare: s.welfare / 1000,
    gini: s.gini / 1000,
    cooperation: soc.cooperation / 1000,
    reciprocity: soc.reciprocity / 1000,
    specialization: s.specialization / 1000,
    productivity: s.productivity / 1000,
    tradeVolume: soc.tradeVolume / 1000,
    modularity: soc.network.modularity / 1000,
    commonsMin: s.commonsMin / 1000,
    e2: soc.institutions.ladder.E2 > 0 ? 1 : 0,
    e4: emergent.some(([, l]) => l.E4 > 0) ? 1 : 0,
    ratified: soc.institutions.ratified,
    decisions: s.decisions,
    deliberations: world.metrics.deliberations,
  };
  return {
    study: study.id,
    condition: condition.id,
    seed,
    days: study.days,
    digest: worldDigest(world),
    sha256: snapshotHash(serializeWorld(world)),
    configHash: world.meta.configHash,
    alive: s.alive,
    population: world.agents.length,
    metrics,
    ladder: Object.fromEntries(Object.entries(soc.institutions.byOrigin).map(([origin, l]) => [origin, { E1: l.E1, E2: l.E2, E3: l.E3, E4: l.E4 }])),
    deaths: s.deathsByCause,
    ms: Math.round(now() - started),
  };
}
