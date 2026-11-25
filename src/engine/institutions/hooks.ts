/**
 * The narrow interface between the physical action system and the institution module.
 * Physical actions never reach into institutional state directly; they ask here.
 */
import type { Agent, Intent, Structure, WorldState } from "../model/types";
import type { EventOut } from "../sim/events";
import type { Scratch } from "../sim/scratch";

export type StoreOp = "shelter" | "deposit" | "withdraw" | "deposited" | "withdrew";

/**
 * Permission check (shelter / deposit / withdraw) and post-hoc accounting notification
 * (deposited / withdrew) for a structure. Unbound structures are open access, subject to
 * the scenario's `openStoresTakeable` switch.
 */
export function storeAccess(
  world: WorldState,
  agent: Agent,
  s: Structure,
  op: StoreOp,
  _item: number,
  _qty: number,
  _eventId?: number,
  _out?: EventOut,
): boolean {
  if (s.bound < 0) {
    if (op === "withdraw" && !world.config.openStoresTakeable) {
      // when taking from open stores is switched off, only those who stocked or built it may withdraw
      return s.founder === agent.id || s.contributors.includes(agent.id);
    }
    return true;
  }
  // Bound structures are governed by their institution's rules (phase 09).
  return false;
}

/**
 * Validate and execute an institutional intent (propose, endorse, motion, vote, leave, pacts).
 * Returns "done" when it executed instantly, "busy" when it occupies the agent for a tick,
 * or a rejection reason code.
 */
export function institutionalIntent(
  _world: WorldState,
  _sc: Scratch,
  _agent: Agent,
  _intent: Intent,
  _out: EventOut,
): "done" | "busy" | string {
  return "disabled";
}

/** Per-tick institutional processing (rule triggers, deadlines, expiry). */
export function stepInstitutions(_world: WorldState, _sc: Scratch, _out: EventOut): void {
  // implemented in phase 09
}
