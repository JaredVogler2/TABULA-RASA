/**
 * The tick pipeline. One call advances the world by exactly one tick.
 *
 *   environment → speech delivery → bodies → perception →
 *   (interrupt → decide → start → advance) per agent in keyed random order →
 *   institutions → bookkeeping
 *
 * The function mutates `world` in place and appends events to `out`. It reads no clock,
 * no ambient randomness and no state outside `world`.
 */
import { Stream, u32 } from "../core/rng";
import { TICKS_PER_DAY, WEATHER } from "../model/constants";
import { ACTOR_ENV, type Agent, type WorldState } from "../model/types";
import { hearingRadius, updateClimate } from "../world/climate";
import { decide, deliverSpeech } from "../mind/decide";
import { perceive } from "../mind/knowledge";
import { urgentNeed } from "../mind/reflex";
import { stepInstitutions } from "../institutions/hooks";
import { sampleDay } from "../metrics/accumulate";
import { advance, interrupt, startNext } from "./actions";
import { updateBody } from "./bodies";
import { stepEnvironment } from "./environment";
import { emit, type EventOut } from "./events";
import { indexAgents, indexWarmth, scratchOf } from "./scratch";

/** Goals that already serve an urgent need; an agent pursuing one is not interrupted for it. */
const SERVES: Record<string, readonly string[]> = {
  drink: ["drink", "seek_water"],
  eat: ["eat", "forage", "seek_food"],
  warm: ["warm"],
  sleep: ["sleep"],
};

function maybeInterrupt(world: WorldState, a: Agent, out: EventOut): void {
  if (a.queue.length === 0 && a.act === null) return;
  const urgent = urgentNeed(a);
  if (urgent === "") return;
  // A plan made while this need was already pressing has taken it into account;
  // only a need that became urgent afterwards pre-empts the plan.
  if (urgent === a.mind.urgentAt) return;
  if (SERVES[urgent]!.includes(a.mind.goal)) return;
  // sleeping through thirst or cold is handled by the rest action's own wake rule
  if (a.act && a.act.k === "rest" && urgent === "sleep") return;
  interrupt(world, a, out);
}

export function step(world: WorldState, out: EventOut): void {
  const sc = scratchOf(world);
  const cfg = world.config;
  const tick = world.tick;

  // 1. environment
  const weatherChanged = updateClimate(world);
  if (weatherChanged) emit(world, out, "weather", ACTOR_ENV, { r: WEATHER[world.climate.weather] });
  stepEnvironment(world, sc, out);
  indexAgents(world, sc);
  indexWarmth(world, sc);

  // 2. speech from the previous tick reaches those in range
  deliverSpeech(world, sc, hearingRadius(world));

  // 3. bodies, 4. perception (independent per agent; id order)
  const agents = world.agents;
  for (let k = 0; k < agents.length; k++) {
    const a = agents[k]!;
    if (!a.alive) continue;
    updateBody(world, sc, a, out);
  }
  for (let k = 0; k < agents.length; k++) {
    const a = agents[k]!;
    if (a.alive) perceive(world, sc, a);
  }

  // 5. decisions and actions in a keyed random order, re-drawn every tick, so that no
  //    agent is systematically first to a contested resource
  const order = sc.order;
  const keys = sc.orderKeys;
  order.length = 0;
  const epoch = world.meta.branch.rngEpoch;
  for (let k = 0; k < agents.length; k++) {
    if (!agents[k]!.alive) continue;
    order.push(k);
    keys[k] = u32(cfg.seed, Stream.Arbitration, tick, k, epoch);
  }
  order.sort((p, q) => (keys[p] as number) - (keys[q] as number) || p - q);
  for (let o = 0; o < order.length; o++) {
    const a = agents[order[o] as number]!;
    if (!a.alive) continue;
    maybeInterrupt(world, a, out);
    if (a.act === null && a.queue.length === 0) decide(world, sc, a, out);
    if (a.act === null && a.queue.length > 0) startNext(world, sc, a, out);
    advance(world, sc, a, out);
  }

  // 6. institutions
  stepInstitutions(world, sc, out);

  // 7. bookkeeping
  if ((tick + 1) % TICKS_PER_DAY === 0) sampleDay(world);
  world.tick = tick + 1;
}

/** Advance `ticks` ticks, discarding events (for callers that only need the end state). */
export function run(world: WorldState, ticks: number): void {
  const sink: EventOut = [];
  for (let i = 0; i < ticks; i++) {
    step(world, sink);
    sink.length = 0;
  }
}
