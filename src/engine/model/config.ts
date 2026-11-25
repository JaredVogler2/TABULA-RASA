/**
 * World configuration: every experimental knob, as integers.
 *
 * Fractions are expressed in permille (1000 = ×1.0) so that configurations serialize
 * canonically and hash identically everywhere. A config plus a seed fully determines a
 * baseline world.
 */
import { canonicalJson } from "../core/canonical";
import { sha256Text } from "../core/hash";

export type PolicyKind = "reflex" | "planner";
export type InstitutionMode = "off" | "grammar_search" | "scripted_control" | "open";
export type SpawnMode = "dispersed" | "clustered";

export type ShockKind =
  | "drought" // streams shrink to pools, bushes and roots stop growing
  | "cold_snap" // temperature drops
  | "blight" // a share of berry bushes and root patches lose their stock
  | "rain" // sustained rain
  | "bounty" // renewable nodes are topped up
  | "windfall" // a pile of food and wood washes ashore
  | "newcomers" // additional adults arrive on the shore
  | "hush"; // voices carry less far

export interface ScheduledShock {
  kind: ShockKind;
  /** Earliest and latest day (from tick 0) on which the shock may start; the engine draws a day by seed. */
  minDay: number;
  maxDay: number;
  /** Duration in days for lasting shocks. */
  days: number;
  /** Strength in permille (meaning depends on kind). */
  magnitude: number;
}

export interface WorldConfig {
  seed: number;
  scenario: string;

  // geography
  size: number; // tiles per side (32..128)
  landFraction: number; // permille of tiles that are land
  relief: number; // permille: ruggedness
  strait: boolean; // split the island with a strait and a single ford ("Two Shores")
  shoreSplit: number; // permille: with a strait, how unevenly the two shores are endowed (0 = alike)

  // ecology
  richness: number; // permille: scales node capacities
  nodeDensity: number; // permille: scales how many nodes exist
  regrowth: number; // permille: scales renewable growth
  collapse: number; // permille: scales collapse thresholds (0 disables collapse)
  spoilage: number; // permille
  seasonDays: [number, number, number, number]; // spring, summer, autumn, winter
  startDay: number; // day of year at tick 0
  winterSeverity: number; // permille: scales how far winter falls below the annual mean
  weatherVolatility: number; // permille

  // bodies and society
  population: number;
  spawn: SpawnMode;
  diversity: number; // permille: variance scale of traits and skills
  metabolism: number; // permille: scales need decay
  illness: number; // permille: scales the daily chance of falling ill (0 disables)
  movementCost: number; // permille
  sightRadius: number; // tiles, daylight
  hearingRadius: number; // tiles
  learningRate: number; // permille
  memoryCapacity: number; // episodic items per agent

  // cognition
  policy: PolicyKind;
  /** Permille of agents that deliberate when `policy` is "planner"; the rest are reflex-only (for mixed-population studies). */
  plannerShare: number;
  /**
   * Permille of agents whose deliberate decisions come from outside the engine (a language
   * model, a mock, or a recorded tape). Who they are is drawn per person by seed. Between
   * decisions, and whenever a decision is missing or refused, they act on the reflex layer,
   * labelled as fallback. 0 = a baseline world.
   */
  externalShare: number;
  cadence: number; // ticks between strategic deliberations (the least interval between two decisions by one mind)
  /**
   * Ticks a baseline planner waits between two deliberations; in between it acts on reflex.
   * 0 (the reference setting) means it deliberates whenever its plan runs out. This is the
   * registered "cognitive cadence" factor for the planner (protocol §3, deviation 2026-11-25).
   */
  planEvery: number;

  // affordance switches
  institutions: InstitutionMode;
  escrow: boolean;
  lockableStores: boolean;
  planting: boolean;
  openStoresTakeable: boolean;

  // exogenous scheduled shocks
  shocks: ScheduledShock[];
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 1,
  scenario: "first_light",
  size: 64,
  landFraction: 500,
  relief: 1000,
  strait: false,
  shoreSplit: 0,
  // Reference ecology (D-014): tuned on development seeds so that an island feeds fifty
  // people with slack when its patches are left half full, and about two thirds of them
  // when every patch is picked bare. 1000 is the neutral multiplier of the underlying tables.
  richness: 1200,
  nodeDensity: 1500,
  regrowth: 1200,
  collapse: 1000,
  spoilage: 1000,
  seasonDays: [10, 10, 10, 10],
  startDay: 0,
  winterSeverity: 1000,
  weatherVolatility: 1000,
  population: 50,
  spawn: "dispersed",
  diversity: 1000,
  metabolism: 1000,
  illness: 1000,
  movementCost: 1000,
  sightRadius: 7,
  hearingRadius: 5,
  learningRate: 1000,
  memoryCapacity: 48,
  policy: "planner",
  plannerShare: 1000,
  externalShare: 0,
  cadence: 24,
  planEvery: 0,
  institutions: "grammar_search",
  escrow: true,
  lockableStores: true,
  planting: true,
  openStoresTakeable: true,
  shocks: [],
};

export interface ScenarioObjective {
  id: string;
  text: string;
}

export interface ScenarioDef {
  id: string;
  title: string;
  tagline: string;
  description: string;
  objective: ScenarioObjective;
  overrides: Partial<WorldConfig>;
}

/**
 * How unevenly Two Shores endows its halves (permille, see world/nodes.ts): at 800, one shore
 * has a fifth of the trees and two fifths of the berries and roots it would otherwise have,
 * the other a fifth of the stone and clay. Chosen on development seeds as the strongest split
 * under which the baseline minds on the poorer shore still come through the year in most
 * worlds (scripts/shores.ts; D-041).
 */
const SHORE_SPLIT = 800;

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: "first_light",
    title: "First Light",
    tagline: "Early spring on a temperate island.",
    description:
      "Fifty unrelated adults wake scattered across a green island with a year ahead of them. Food is within reach, water runs from the hills, and winter is three seasons away.",
    objective: { id: "survive_80", text: "See four in five through the first winter." },
    overrides: {},
  },
  {
    id: "long_winter",
    title: "The Long Winter",
    tagline: "Late summer. The cold will come early and stay.",
    description:
      "The warm days are numbered. Winter here is long and hard, fresh food rots quickly, and there is roughly a season and a half to prepare.",
    objective: { id: "survive_cold", text: "Lose no one to cold or hunger before spring." },
    overrides: {
      seasonDays: [8, 8, 8, 16],
      startDay: 12,
      winterSeverity: 1350,
      spoilage: 1250,
    },
  },
  {
    id: "thin_commons",
    title: "Thin Commons",
    tagline: "A few rich groves and lagoons feed everyone — while they last.",
    description:
      "Food is concentrated in a handful of fishing waters and berry groves that collapse if they are stripped and recover only slowly.",
    objective: { id: "commons_alive", text: "Keep every commons above its collapse threshold for a year while four in five survive." },
    overrides: {
      nodeDensity: 700,
      richness: 1800,
      collapse: 1800,
      regrowth: 1020,
    },
  },
  {
    id: "two_shores",
    title: "Two Shores",
    tagline: "One island, one ford, two unequal halves.",
    description:
      "A strait divides the land. Most of the stone and clay lie on one shore; most of the timber, berries and roots on the other. A single shallow ford joins them.",
    objective: { id: "narrow_gap", text: "Narrow the gap in well-being between the shores." },
    overrides: {
      strait: true,
      shoreSplit: SHORE_SPLIT,
      landFraction: 540,
    },
  },
  {
    id: "dry_year",
    title: "Dry Year",
    tagline: "An ordinary spring. Then the rain stops.",
    description:
      "Sometime before autumn a drought arrives without warning: streams shrink to scattered pools and the bushes stop bearing.",
    objective: { id: "survive_drought", text: "Keep four in five alive through the drought." },
    overrides: {
      shocks: [{ kind: "drought", minDay: 9, maxDay: 18, days: 9, magnitude: 1000 }],
    },
  },
];

export function scenarioById(id: string): ScenarioDef {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario: ${id}`);
  return s;
}

/** Build a complete config from a scenario id, a seed and optional overrides. */
export function makeConfig(scenario: string, seed: number, overrides: Partial<WorldConfig> = {}): WorldConfig {
  const def = scenarioById(scenario);
  const cfg: WorldConfig = {
    ...DEFAULT_CONFIG,
    ...def.overrides,
    ...overrides,
    seed: seed >>> 0,
    scenario,
  };
  // defensive copies of nested values
  cfg.seasonDays = [...cfg.seasonDays] as [number, number, number, number];
  cfg.shocks = cfg.shocks.map((s) => ({ ...s }));
  return validateConfig(cfg);
}

function intInRange(name: string, v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) {
    throw new Error(`config.${name} must be an integer in [${lo}, ${hi}] (got ${String(v)})`);
  }
  return v;
}

/** Reject malformed configurations early, with a precise message. */
export function validateConfig(cfg: WorldConfig): WorldConfig {
  intInRange("seed", cfg.seed, 0, 0xffffffff);
  intInRange("size", cfg.size, 24, 128);
  intInRange("landFraction", cfg.landFraction, 200, 800);
  // configurations written before the shores could differ (recordings, stored runs) mean "alike"
  if ((cfg as { shoreSplit?: number }).shoreSplit === undefined) cfg.shoreSplit = 0;
  intInRange("shoreSplit", cfg.shoreSplit, 0, 1000);
  intInRange("relief", cfg.relief, 200, 2000);
  intInRange("richness", cfg.richness, 100, 4000);
  intInRange("nodeDensity", cfg.nodeDensity, 100, 3000);
  intInRange("regrowth", cfg.regrowth, 0, 4000);
  intInRange("collapse", cfg.collapse, 0, 4000);
  intInRange("spoilage", cfg.spoilage, 0, 4000);
  if (!Array.isArray(cfg.seasonDays) || cfg.seasonDays.length !== 4) throw new Error("config.seasonDays must have 4 entries");
  cfg.seasonDays.forEach((d, i) => intInRange(`seasonDays[${i}]`, d, 1, 60));
  const yearDays = cfg.seasonDays[0] + cfg.seasonDays[1] + cfg.seasonDays[2] + cfg.seasonDays[3];
  intInRange("startDay", cfg.startDay, 0, yearDays - 1);
  intInRange("winterSeverity", cfg.winterSeverity, 0, 3000);
  intInRange("weatherVolatility", cfg.weatherVolatility, 0, 3000);
  intInRange("population", cfg.population, 1, 600);
  intInRange("diversity", cfg.diversity, 0, 2000);
  intInRange("metabolism", cfg.metabolism, 250, 3000);
  intInRange("illness", cfg.illness, 0, 5000);
  intInRange("movementCost", cfg.movementCost, 250, 4000);
  intInRange("sightRadius", cfg.sightRadius, 1, 16);
  intInRange("hearingRadius", cfg.hearingRadius, 0, 16);
  intInRange("learningRate", cfg.learningRate, 0, 4000);
  intInRange("memoryCapacity", cfg.memoryCapacity, 4, 256);
  intInRange("cadence", cfg.cadence, 1, 960);
  // configurations written before the planner had a clock (recordings, stored runs) mean "no clock"
  if ((cfg as { planEvery?: number }).planEvery === undefined) cfg.planEvery = 0;
  intInRange("planEvery", cfg.planEvery, 0, 960);
  if (cfg.spawn !== "dispersed" && cfg.spawn !== "clustered") throw new Error("config.spawn invalid");
  if (cfg.policy !== "reflex" && cfg.policy !== "planner") throw new Error("config.policy invalid");
  intInRange("plannerShare", cfg.plannerShare, 0, 1000);
  intInRange("externalShare", cfg.externalShare, 0, 1000);
  if (!["off", "grammar_search", "scripted_control", "open"].includes(cfg.institutions)) {
    throw new Error("config.institutions invalid");
  }
  for (const key of ["strait", "escrow", "lockableStores", "planting", "openStoresTakeable"] as const) {
    if (typeof cfg[key] !== "boolean") throw new Error(`config.${key} must be boolean`);
  }
  if (!Array.isArray(cfg.shocks) || cfg.shocks.length > 16) throw new Error("config.shocks invalid");
  for (const s of cfg.shocks) {
    intInRange("shock.minDay", s.minDay, 0, 10_000);
    intInRange("shock.maxDay", s.maxDay, s.minDay, 10_000);
    intInRange("shock.days", s.days, 0, 400);
    intInRange("shock.magnitude", s.magnitude, 0, 5000);
  }
  if (typeof cfg.scenario !== "string" || cfg.scenario.length === 0 || cfg.scenario.length > 40) {
    throw new Error("config.scenario invalid");
  }
  return cfg;
}

export function configHash(cfg: WorldConfig): string {
  return sha256Text(canonicalJson(cfg));
}

export function yearLength(cfg: WorldConfig): number {
  return cfg.seasonDays[0] + cfg.seasonDays[1] + cfg.seasonDays[2] + cfg.seasonDays[3];
}
