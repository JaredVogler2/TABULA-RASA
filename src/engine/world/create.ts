/**
 * World creation: a config (which includes the seed) fully determines the initial state.
 */
import { configHash, validateConfig, type WorldConfig } from "../model/config";
import type { BranchInfo, WorldState } from "../model/types";
import { AFFORDANCE_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from "../version";
import { emptyInstitutions } from "../institutions/types";
import { emptyMetrics } from "../metrics/accumulate";
import { ITEM_COUNT } from "../model/constants";
import { resolveShockTicks } from "../sim/environment";
import { source } from "../sim/inventory";
import { initialClimate } from "./climate";
import { placeNodes } from "./nodes";
import { createPopulation } from "./population";
import { generateTerrain } from "./terrain";

export const ROOT_BRANCH: BranchInfo = { id: "root", parent: "", forkTick: -1, rngEpoch: 0 };

export function createWorld(config: WorldConfig, branch: BranchInfo = ROOT_BRANCH): WorldState {
  const cfg = validateConfig({ ...config, seasonDays: [...config.seasonDays] as [number, number, number, number], shocks: config.shocks.map((s) => ({ ...s })) });
  const { terrain } = generateTerrain(cfg);
  const nodes = placeNodes(cfg, terrain);
  const agents = createPopulation(cfg, terrain, nodes);
  const world: WorldState = {
    meta: {
      schema: SCHEMA_VERSION,
      engine: ENGINE_VERSION,
      affordances: AFFORDANCE_VERSION,
      configHash: configHash(cfg),
      branch: { ...branch },
    },
    config: cfg,
    tick: 0,
    terrain,
    nodes,
    climate: initialClimate(cfg),
    agents,
    structures: [],
    piles: [],
    traffic: new Uint16Array(terrain.w * terrain.h),
    speech: [],
    nextUtterance: 0,
    nextStructure: 0,
    nextEvent: 0,
    inst: emptyInstitutions(),
    interventions: [],
    shockTicks: [],
    metrics: emptyMetrics(),
  };
  world.shockTicks = resolveShockTicks(world);
  // everyone wakes already feeling the air of the day they wake into
  for (const a of agents) {
    a.mind.tempEma = world.climate.temp - Math.floor(((terrain.height[a.y * terrain.w + a.x] as number) * 40) / 1000);
  }
  // initial possessions are the first declared source in the conservation ledger
  for (const a of agents) for (let i = 0; i < ITEM_COUNT; i++) source(world, i, a.inv[i] as number);
  return world;
}
