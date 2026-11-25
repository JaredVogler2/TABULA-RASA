/**
 * The narrow interface between the physical action system and the institution module.
 * Physical actions never reach into institutional state directly; they ask here.
 */
import type { Agent, Intent, Structure, WorldState } from "../model/types";
import type { EventOut } from "../sim/events";
import type { Scratch } from "../sim/scratch";
import { endorse, leave, mayDeposit, mayShelter, moveMotion, noteGather, noteStoreUse, noteSupply, propose, tickInstitutions, vote, withdrawAllowance } from "./engine";
import { acceptPact, offerPact, tickPacts } from "./pacts";
import { tickScripted } from "./scripted";

export type StoreOp = "shelter" | "deposit" | "withdraw" | "deposited" | "withdrew";

/**
 * Permission check (shelter / deposit / withdraw) and post-hoc accounting notification
 * (deposited / withdrew) for a structure. Unbound structures are open access, subject to
 * the scenario's `openStoresTakeable` switch. A structure under an institution's control
 * opens only as that institution's charter says.
 */
export function storeAccess(world: WorldState, agent: Agent, s: Structure, op: StoreOp, item: number, qty: number, _eventId?: number, _out?: EventOut): boolean {
  if (s.bound < 0) {
    if (op === "withdraw" && !world.config.openStoresTakeable) {
      // when taking from open stores is switched off, only those who stocked or built it may withdraw
      return s.founder === agent.id || s.contributors.includes(agent.id);
    }
    return true;
  }
  switch (op) {
    case "shelter":
      return mayShelter(world, agent, s);
    case "deposit":
      return mayDeposit(world, agent, s);
    case "withdraw":
      return withdrawAllowance(world, agent, s, item) >= 1;
    case "deposited":
    case "withdrew":
      noteStoreUse(world, agent, s, op, item, qty);
      return true;
  }
}

/** The most units of `item` this agent may take from the store right now (unbounded for open stores). */
export function withdrawLimit(world: WorldState, agent: Agent, s: Structure, item: number): number {
  return s.bound < 0 ? 1 << 20 : withdrawAllowance(world, agent, s, item);
}

/** A gather completed: institutions with harvest rules keep count. */
export function gathered(world: WorldState, sc: Scratch, agent: Agent, node: number, qty: number, out: EventOut): void {
  noteGather(world, sc, agent, node, qty, out);
}

/** Materials or labour went into a building site. */
export function supplied(world: WorldState, agent: Agent, s: Structure, worth: number): void {
  noteSupply(world, agent, s, worth);
}

/**
 * Validate and execute an institutional intent (propose, endorse, motion, vote, leave, pacts).
 * Returns "busy" when it took effect (the act occupies the agent for a tick), or a rejection
 * reason code. Every one of these acts is a recorded, individual, voluntary act of one agent.
 */
export function institutionalIntent(world: WorldState, sc: Scratch, agent: Agent, intent: Intent, out: EventOut): "done" | "busy" | string {
  let result: string;
  switch (intent.k) {
    case "propose":
      result = propose(world, agent, intent.charter, out);
      break;
    case "endorse":
      result = endorse(world, sc, agent, intent.proposal, out);
      break;
    case "motion":
      result = moveMotion(world, sc, agent, intent.institution, intent.motion, out);
      break;
    case "vote":
      result = vote(world, sc, agent, intent.motion, intent.yes, out);
      break;
    case "leave":
      result = leave(world, sc, agent, intent.institution, out);
      break;
    case "pact_offer":
      result = offerPact(world, agent, intent.to, intent.give, intent.giveQty, intent.want, intent.wantQty, out);
      break;
    case "pact_accept":
      result = acceptPact(world, sc, agent, intent.pact, out);
      break;
    default:
      return "unsupported";
  }
  return result === "done" ? "busy" : result;
}

/** Per-tick institutional processing (deadlines, period closings, expiry, pact expiry, the scripted control). */
export function stepInstitutions(world: WorldState, sc: Scratch, out: EventOut): void {
  if (world.config.institutions === "off") return;
  tickScripted(world, sc, out);
  tickInstitutions(world, sc, out);
  tickPacts(world, sc, out);
}
