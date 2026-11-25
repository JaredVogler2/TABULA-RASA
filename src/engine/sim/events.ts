/**
 * Event emission. The engine appends to an output buffer supplied by the host; the
 * world itself only carries the next event id, so ledgers can be stored, chunked or
 * discarded by the host without affecting simulation state.
 */
import type { EventKind, SimEvent, WorldState } from "../model/types";

export type EventOut = SimEvent[];

export function emit(
  world: WorldState,
  out: EventOut,
  k: EventKind,
  a: number,
  fields?: Omit<SimEvent, "id" | "t" | "k" | "a">,
): number {
  const id = world.nextEvent++;
  const e: SimEvent = { id, t: world.tick, k, a };
  if (fields) {
    if (fields.b !== undefined) e.b = fields.b;
    if (fields.n !== undefined) e.n = fields.n;
    if (fields.s !== undefined) e.s = fields.s;
    if (fields.x !== undefined) e.x = fields.x;
    if (fields.y !== undefined) e.y = fields.y;
    if (fields.i !== undefined) e.i = fields.i;
    if (fields.q !== undefined) e.q = fields.q;
    if (fields.r !== undefined) e.r = fields.r;
    if (fields.p !== undefined && fields.p.length > 0) e.p = fields.p;
    if (fields.d !== undefined) e.d = fields.d;
  }
  out.push(e);
  return id;
}

/** Causal parent list containing the agent's current decision, if any. */
export function parentsOf(decisionEvent: number, ...others: number[]): number[] {
  const p: number[] = [];
  if (decisionEvent >= 0) p.push(decisionEvent);
  for (const o of others) if (o >= 0) p.push(o);
  return p;
}
