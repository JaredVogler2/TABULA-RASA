/**
 * Bounded-rational planner (strategic layer of the non-LLM baseline).
 * Implemented in phase 05. Until then planner agents defer to the reflex layer.
 */
import type { Agent, WorldState } from "../model/types";
import type { Scratch } from "../sim/scratch";
import type { Plan } from "./reflex";

export function planDecide(_world: WorldState, _sc: Scratch, _a: Agent): Plan | null {
  return null;
}
