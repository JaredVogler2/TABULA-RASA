/**
 * Pacts: two people, two goods, one moment.
 *
 * An offer names what is given and what is wanted. Where the scenario provides escrow, the
 * offered goods leave the offerer's hands at once and are held; when a counterparty standing
 * beside the offerer accepts, both transfers happen in the same instant or neither does. An
 * offer nobody takes expires and everything held goes back. Without escrow an offer is only
 * words until both still have the goods at the moment of acceptance.
 *
 * Nothing about price, currency or fairness is built in: any two items, any quantities.
 */
import { ITEM_COUNT, ITEM_SPECS } from "../model/constants";
import type { Agent, WorldState } from "../model/types";
import { emit, type EventOut } from "../sim/events";
import { dropOnGround, emptyInv, roomFor } from "../sim/inventory";
import type { Scratch } from "../sim/scratch";
import { LIMITS, type Pact } from "./types";

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const MAX_QTY = 60;

export function learnPact(a: Agent, id: number): void {
  const list = a.mind.pacts;
  if (list.includes(id)) return;
  if (list.length >= 8) list.shift();
  list.push(id);
}

export function offerPact(world: WorldState, agent: Agent, to: number, give: number, giveQty: number, want: number, wantQty: number, out: EventOut): string {
  if (world.config.institutions === "off") return "disabled";
  if (![give, want].every((i) => isInt(i) && i >= 0 && i < ITEM_COUNT) || give === want) return "bad_item";
  if (![giveQty, wantQty].every((q) => isInt(q) && q >= 1 && q <= MAX_QTY)) return "bad_quantity";
  if (to !== -1 && (!isInt(to) || to === agent.id || !world.agents[to]?.alive)) return "no_target";
  if ((agent.inv[give] as number) < giveQty) return "no_item";
  if (world.inst.pacts.filter((p) => p.state === "open" && p.a === agent.id).length >= LIMITS.openPactsPerAgent) return "offer_pending";
  const pact: Pact = { id: world.inst.nextId++, a: agent.id, b: to, give, giveQty, want, wantQty, tick: world.tick, expires: world.tick + LIMITS.pactTicks, state: "open", held: 0, x: agent.x, y: agent.y };
  if (world.config.escrow) {
    agent.inv[give] = (agent.inv[give] as number) - giveQty;
    pact.held = giveQty;
  }
  world.inst.pacts.push(pact);
  learnPact(agent, pact.id);
  const ev = emit(world, out, "pact", agent.id, { ...(to >= 0 ? { b: to } : {}), i: give, q: giveQty, x: agent.x, y: agent.y, d: { pact: pact.id, want, wantQty, escrow: pact.held > 0 } });
  // the offer is spoken: those in earshot (or the one addressed) come to know it exists
  world.speech.push({ id: world.nextUtterance++, tick: world.tick, from: agent.id, to, x: agent.x, y: agent.y, act: { t: "offer", give, giveQty, want, wantQty, pact: pact.id } });
  world.metrics.utterances++;
  void ev;
  return "done";
}

function returnHeld(world: WorldState, sc: Scratch, pact: Pact): void {
  if (pact.held <= 0) return;
  const a = world.agents[pact.a]!;
  const q = pact.held;
  pact.held = 0;
  if (a.alive) {
    const kept = Math.min(q, roomFor(a, pact.give));
    a.inv[pact.give] = (a.inv[pact.give] as number) + kept;
    if (kept < q) dropOnGround(world, sc, a.x, a.y, pact.give, q - kept);
  } else {
    dropOnGround(world, sc, pact.x, pact.y, pact.give, q);
  }
}

export function acceptPact(world: WorldState, sc: Scratch, agent: Agent, pactId: number, out: EventOut): string {
  if (world.config.institutions === "off") return "disabled";
  const pact = world.inst.pacts.find((p) => p.id === pactId);
  if (!pact || pact.state !== "open") return "no_such_offer";
  if (!agent.mind.pacts.includes(pactId)) return "unknown_offer";
  if (pact.a === agent.id) return "self_target";
  if (pact.b >= 0 && pact.b !== agent.id) return "not_for_you";
  const a = world.agents[pact.a]!;
  if (!a.alive) return "no_target";
  const dx = a.x > agent.x ? a.x - agent.x : agent.x - a.x;
  const dy = a.y > agent.y ? a.y - agent.y : agent.y - a.y;
  if ((dx > dy ? dx : dy) > 1) return "too_far";
  if ((agent.inv[pact.want] as number) < pact.wantQty) return "no_item";
  // without escrow the offerer must still have what they offered
  if (pact.held === 0 && (a.inv[pact.give] as number) < pact.giveQty) {
    pact.state = "void";
    emit(world, out, "pact_void", pact.a, { b: agent.id, r: "offerer_empty_handed", d: { pact: pact.id } });
    return "offer_void";
  }
  // both hand over first, then both receive: the weight given up makes room for what comes back
  agent.inv[pact.want] = (agent.inv[pact.want] as number) - pact.wantQty;
  if (pact.held > 0) pact.held = 0;
  else a.inv[pact.give] = (a.inv[pact.give] as number) - pact.giveQty;
  const takeB = Math.min(pact.giveQty, roomFor(agent, pact.give));
  agent.inv[pact.give] = (agent.inv[pact.give] as number) + takeB;
  if (takeB < pact.giveQty) dropOnGround(world, sc, agent.x, agent.y, pact.give, pact.giveQty - takeB);
  const takeA = Math.min(pact.wantQty, roomFor(a, pact.want));
  a.inv[pact.want] = (a.inv[pact.want] as number) + takeA;
  if (takeA < pact.wantQty) dropOnGround(world, sc, a.x, a.y, pact.want, pact.wantQty - takeA);
  for (const [who, item] of [[agent, pact.give], [a, pact.want]] as const) {
    if (ITEM_SPECS[item]!.uses > 0 && (who.toolUses[item] as number) <= 0) who.toolUses[item] = ITEM_SPECS[item]!.uses;
  }
  pact.state = "done";
  pact.b = agent.id;
  // an exchange honoured is remembered by both, a little
  a.mind.trust[agent.id] = Math.min(1000, (a.mind.trust[agent.id] as number) + 25);
  agent.mind.trust[a.id] = Math.min(1000, (agent.mind.trust[a.id] as number) + 25);
  world.metrics.exchanges++;
  emit(world, out, "pact_done", agent.id, { b: pact.a, x: agent.x, y: agent.y, d: { pact: pact.id, gave: pact.want, gaveQty: pact.wantQty, got: pact.give, gotQty: pact.giveQty } });
  return "done";
}

export function tickPacts(world: WorldState, sc: Scratch, out: EventOut): void {
  const pacts = world.inst.pacts;
  if (pacts.length === 0) return;
  for (const pact of pacts) {
    if (pact.state !== "open") continue;
    const a = world.agents[pact.a]!;
    if (world.tick > pact.expires || !a.alive) {
      returnHeld(world, sc, pact);
      pact.state = "void";
      emit(world, out, "pact_void", pact.a, { r: a.alive ? "expired" : "offerer_died", d: { pact: pact.id } });
    }
  }
  if (world.tick % 96 === 0) world.inst.pacts = pacts.filter((p) => p.state === "open" || world.tick - p.expires < 96 * 3);
}

/** Goods held in pact escrow, per item id. */
export function escrowHoldings(world: WorldState): number[] {
  const total = emptyInv();
  for (const p of world.inst.pacts) if (p.state === "open" && p.held > 0) total[p.give] = (total[p.give] as number) + p.held;
  return total;
}
