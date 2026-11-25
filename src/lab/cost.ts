/**
 * What a study would cost at most if its minds were a language model.
 *
 * This is arithmetic over published prices and the same two bounds the server enforces before
 * every request: the most calls a plan can make, and the most one call can cost. It makes no
 * call, reserves nothing and authorizes nothing; it exists so that a design can be sized
 * against a budget before anyone is asked to approve one.
 *
 * The numbers are ceilings, not forecasts. They assume every permitted call is made, every
 * call uses its whole output limit, and nothing is ever read from the prompt cache. What a
 * call really costs is unknown until one has been made, and none has.
 */
import { TICKS_PER_DAY, createWorld, makeConfig, type WorldConfig } from "@/engine";
import { PRICE_TABLE, priceOf, worstCaseCost, type PriceTable } from "@/providers/prices";
import { DEFAULT_SPEC, plannedCalls, requestTokenBound, type RunSpec } from "@/providers/run";

export interface LiveDesign {
  label: string;
  scenario: string;
  /** Configuration overrides; who is decided for from outside follows `externalShare`. */
  overrides: Partial<WorldConfig>;
  /** How many of the study's conditions use model-driven minds (conditions on built-in minds cost nothing). */
  liveConditions: number;
  seeds: readonly number[];
  days: number;
  /** The fields a run is created with; anything left out takes the product's default. */
  spec?: Partial<Pick<RunSpec, "scheduler" | "epochTicks" | "maxTokens" | "context">>;
}

export interface StudyCost {
  label: string;
  model: string;
  /** Worlds with model-driven minds: live conditions × seeds. */
  runs: number;
  /** The most people decided for from outside in any one of those worlds. */
  externalAgents: number;
  callsPerRun: number;
  calls: number;
  inputTokenBound: number;
  maxTokens: number;
  perCallMicroUsd: number;
  perRunMicroUsd: number;
  worstCaseMicroUsd: number;
}

function specOf(design: LiveDesign): RunSpec {
  const epochTicks = design.spec?.epochTicks ?? DEFAULT_SPEC.epochTicks;
  return {
    ...DEFAULT_SPEC,
    ...design.spec,
    scheduler: { ...DEFAULT_SPEC.scheduler, ...design.spec?.scheduler },
    epochTicks,
    epochs: Math.ceil((design.days * TICKS_PER_DAY) / epochTicks),
  };
}

/** The most people an outside mind decides for in any of the design's worlds. */
function externalAgents(design: LiveDesign): number {
  const first = makeConfig(design.scenario, design.seeds[0] ?? 1, design.overrides);
  if (first.externalShare >= 1000) return first.population;
  if (first.externalShare <= 0) return 0;
  // a partial share is drawn per person from the seed, so the count differs between seeds: take the largest
  let most = 0;
  for (const seed of design.seeds) {
    let n = 0;
    for (const a of createWorld(makeConfig(design.scenario, seed, design.overrides)).agents) if (a.controller === "external") n++;
    most = Math.max(most, n);
  }
  return most;
}

/** The ceiling for one design on one model. Throws for a model with no published price in the table: an unknown price is not guessed. */
export function estimateLiveStudy(design: LiveDesign, model: string, table: PriceTable = PRICE_TABLE): StudyCost {
  if (!Number.isInteger(design.liveConditions) || design.liveConditions < 0) throw new Error("live conditions must be a whole number");
  if (!Number.isInteger(design.days) || design.days < 1) throw new Error("a study runs for at least a day");
  if (design.seeds.length === 0) throw new Error("a study needs at least one seed");
  const price = priceOf(model, table);
  if (!price) throw new Error(`no published price for ${model}: its cost cannot be bounded`);
  const spec = specOf(design);
  const cfg = makeConfig(design.scenario, design.seeds[0] as number, design.overrides);
  const people = externalAgents(design);
  const callsPerRun = plannedCalls(spec, people);
  const inputTokenBound = requestTokenBound(cfg, spec.context);
  const perCall = worstCaseCost(price, inputTokenBound, spec.maxTokens, "5m");
  const runs = design.liveConditions * design.seeds.length;
  return {
    label: design.label,
    model,
    runs,
    externalAgents: people,
    callsPerRun,
    calls: callsPerRun * runs,
    inputTokenBound,
    maxTokens: spec.maxTokens,
    perCallMicroUsd: perCall,
    perRunMicroUsd: perCall * callsPerRun,
    worstCaseMicroUsd: perCall * callsPerRun * runs,
  };
}

/**
 * The largest number of seeds per condition whose ceiling fits inside `budgetMicroUsd`
 * (0 if not even one does). Uses the design's first seeds, in order.
 */
export function seedsWithin(budgetMicroUsd: number, design: LiveDesign, model: string, table: PriceTable = PRICE_TABLE): number {
  if (!Number.isFinite(budgetMicroUsd) || budgetMicroUsd <= 0 || design.liveConditions === 0) return 0;
  const one = estimateLiveStudy({ ...design, seeds: design.seeds.slice(0, 1) }, model, table);
  if (one.worstCaseMicroUsd <= 0) return design.seeds.length;
  // a partial share gives different worlds different ceilings, so each prefix of the seed list is priced as it is
  let best = 0;
  for (let n = 1; n <= design.seeds.length; n++) {
    if (estimateLiveStudy({ ...design, seeds: design.seeds.slice(0, n) }, model, table).worstCaseMicroUsd <= budgetMicroUsd) best = n;
    else break;
  }
  return best;
}

export function dollars(microUsd: number): string {
  const d = microUsd / 1_000_000;
  return d >= 100 ? `$${Math.round(d).toLocaleString("en-US")}` : d >= 10 ? `$${d.toFixed(0)}` : d >= 1 ? `$${d.toFixed(2)}` : `$${d.toFixed(3)}`;
}

const ALL_MODEL_MINDS: Partial<WorldConfig> = { policy: "planner", externalShare: 1000 };
const seedRange = (n: number): number[] => Array.from({ length: n }, (_, i) => 9000 + i);

/**
 * Designs worth pricing before a live study is proposed, from the smallest thing that would
 * say anything to a contrast of the size the baseline studies are run at. Every person in
 * these worlds would be decided for by the model, at the product's default ration.
 */
export const LIVE_DESIGNS: readonly LiveDesign[] = [
  { label: "One world, six days (the size of the bundled mock recording)", scenario: "first_light", overrides: ALL_MODEL_MINDS, liveConditions: 1, seeds: seedRange(1), days: 6 },
  { label: "One world, forty days (one cell of a study)", scenario: "first_light", overrides: ALL_MODEL_MINDS, liveConditions: 1, seeds: seedRange(1), days: 40 },
  { label: "A pilot contrast: two conditions on eight seeds, forty days", scenario: "first_light", overrides: ALL_MODEL_MINDS, liveConditions: 2, seeds: seedRange(8), days: 40 },
  { label: "A confirmatory contrast: two conditions on thirty-two seeds, forty days", scenario: "first_light", overrides: ALL_MODEL_MINDS, liveConditions: 2, seeds: seedRange(32), days: 40 },
  { label: "H6's model arm: one condition on thirty-two seeds of The Long Winter", scenario: "long_winter", overrides: { ...ALL_MODEL_MINDS, institutions: "open" }, liveConditions: 1, seeds: seedRange(32), days: 40 },
];
