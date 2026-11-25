/**
 * Social bookkeeping: what each mind records, for itself, about dealings with others.
 *
 * Everything here is first-person. A promise exists for the speaker because they made it and
 * for the listener only if they heard it said to them; whether it was kept is judged by the
 * listener from what actually reached their hands. Hearsay about third parties moves trust
 * only in proportion to trust in the teller, and the engine never checks whether it is true.
 *
 * These are mechanics of memory, not norms: nothing obliges anyone to promise, to keep a
 * promise or to care that one was broken. What agents do with the record is policy.
 */
import { clampInt } from "../core/math";
import { TICKS_PER_DAY } from "../model/constants";
import type { Agent, Commitment, Utterance, WorldState } from "../model/types";
import { emit, type EventOut } from "../sim/events";
import { recall, remember } from "./knowledge";

export const COMMITMENT_CAP = 8;

/** Trust moves (0..1000 scale). Losses outweigh gains: betrayal is remembered harder than reliability. */
export const TRUST_DELTA = {
  kept: 70,
  broke: -130,
  tookFromPlot: -90,
  tookFromStore: -40,
  /** Upper bound on what one piece of hearsay can move, before weighting by trust in the teller. */
  hearsay: 45,
  /** Below this trust in the teller, hearsay is ignored. */
  hearsayFloor: 350,
} as const;

/** Sensed outdoor temperature (tenths of °C) below which a day counts as cold. */
export const COLD_DAY = 45;
/** A cooling trend steeper than this (tenths of °C per day) is felt as "the cold is coming". */
export const COOLING_TREND = -8;

export function adjustTrust(a: Agent, other: number, delta: number): void {
  if (other < 0 || other >= a.mind.trust.length || other === a.id) return;
  a.mind.trust[other] = clampInt((a.mind.trust[other] as number) + delta, 0, 1000);
}

function addCommitment(a: Agent, c: Commitment): void {
  const list = a.mind.commitments;
  if (list.length >= COMMITMENT_CAP) {
    // forget a settled one first; otherwise the one due furthest in the future
    let drop = list.findIndex((x) => x.done);
    if (drop < 0) {
      drop = 0;
      for (let k = 1; k < list.length; k++) if (list[k]!.due > list[drop]!.due) drop = k;
    }
    list.splice(drop, 1);
  }
  list.push(c);
}

/** The speaker's own record of a promise it just made to a specific person. */
export function notePromiseMade(world: WorldState, speaker: Agent, u: Utterance): void {
  if (u.act.t !== "promise" || u.to < 0 || u.to === speaker.id) return;
  if (u.act.due <= world.tick) return;
  addCommitment(speaker, { id: u.id, dir: "owe", to: u.to, item: u.act.item, qty: u.act.qty, due: u.act.due, done: false });
}

/** What a listener makes of an utterance beyond storing it in the inbox. */
export function noteHeard(world: WorldState, hearer: Agent, u: Utterance, direct: boolean): void {
  const act = u.act;
  if (act.t === "promise") {
    // only a promise made to me, in my hearing, is something I can hold someone to
    if (direct && act.due > world.tick) {
      addCommitment(hearer, { id: u.id, dir: "due", to: u.from, item: act.item, qty: act.qty, due: act.due, done: false });
    }
    return;
  }
  if (act.t === "inform_agent") {
    const about = act.about;
    if (about === hearer.id || about === u.from) return; // self-praise and talk about me change nothing
    const m = hearer.mind;
    const faith = m.trust[u.from] as number;
    if (faith < TRUST_DELTA.hearsayFloor) return;
    if (world.tick - act.tick > 10 * TICKS_PER_DAY) return; // old news
    // the same teller repeating themselves about the same person within a day adds nothing
    for (const item of m.mem) {
      if (item.kind === "heard" && item.who === about && item.src === u.from && world.tick - item.tick < TICKS_PER_DAY) return;
    }
    const sign = act.claim === "took" || act.claim === "broke" ? -1 : 1;
    adjustTrust(hearer, about, sign * Math.round((TRUST_DELTA.hearsay * faith) / 1000));
    remember(world, hearer, "heard", { who: about, qty: sign, salience: 300, src: u.from });
  }
}

/**
 * A gift changed hands: settle any promise it fulfils. Called after the transfer, with the
 * quantity actually received.
 */
export function settleGift(world: WorldState, giver: Agent, receiver: Agent, item: number, qty: number, out: EventOut, parents: number[]): void {
  let left = qty;
  for (const c of giver.mind.commitments) {
    if (left <= 0) break;
    if (c.done || c.dir !== "owe" || c.to !== receiver.id || c.item !== item) continue;
    const used = Math.min(left, c.qty);
    c.qty -= used;
    left -= used;
    // the receiver's matching record, if they heard the promise
    const mine = receiver.mind.commitments.find((x) => x.id === c.id && x.dir === "due" && !x.done);
    if (mine) mine.qty = c.qty;
    if (c.qty > 0) continue;
    c.done = true;
    if (mine) {
      mine.done = true;
      receiver.mind.kept[giver.id] = clampInt((receiver.mind.kept[giver.id] as number) + 1, 0, 30000);
      adjustTrust(receiver, giver.id, TRUST_DELTA.kept);
      remember(world, receiver, "kept", { who: giver.id, item, qty: used, salience: 520 });
    }
    emit(world, out, "promise_kept", giver.id, { b: receiver.id, i: item, d: { u: c.id }, p: parents });
  }
}

/** Someone was seen taking what this agent planted or stored. */
export function noteTaking(witness: Agent, taker: number, fromPlot: boolean): void {
  adjustTrust(witness, taker, fromPlot ? TRUST_DELTA.tookFromPlot : TRUST_DELTA.tookFromStore);
}

/**
 * Per-tick reflection, cheap by construction: overdue promises are judged four times an
 * hour, the temperature is sampled every two hours while awake, and the day's impressions
 * are folded into long-run expectations once a day.
 */
export function reflect(world: WorldState, a: Agent, out: EventOut): void {
  const tick = world.tick;
  const m = a.mind;

  if ((tick + a.id) % 4 === 0 && m.commitments.length > 0) {
    for (const c of m.commitments) {
      if (c.done || tick <= c.due) continue;
      c.done = true;
      if (c.dir === "due") {
        m.broke[c.to] = clampInt((m.broke[c.to] as number) + 1, 0, 30000);
        adjustTrust(a, c.to, TRUST_DELTA.broke);
        remember(world, a, "broke", { who: c.to, item: c.item, qty: c.qty, salience: 720 });
        emit(world, out, "promise_broken", c.to, { b: a.id, i: c.item, q: c.qty, d: { u: c.id } });
      }
    }
  }

  if (!a.asleep && (tick + a.id) % 8 === 0) {
    const tile = a.y * world.terrain.w + a.x;
    m.tempSum += world.climate.temp - Math.floor(((world.terrain.height[tile] as number) * 40) / 1000);
    m.tempN++;
  }

  if ((tick + 1) % TICKS_PER_DAY === 0) {
    if (m.tempN > 0) {
      const mean = Math.round(m.tempSum / m.tempN);
      m.tempTrend = Math.round((2 * m.tempTrend + (mean - m.tempEma)) / 3);
      m.tempEma = Math.round((2 * m.tempEma + mean) / 3);
      if (mean < COLD_DAY) {
        m.coldRun++;
      } else {
        if (m.coldRun >= 4) m.wintersSeen++;
        m.coldRun = 0;
      }
      m.tempSum = 0;
      m.tempN = 0;
    }
    if (recall(world, a, "cold", TICKS_PER_DAY) > 0) m.coldNights++;
    if (recall(world, a, "hungry", TICKS_PER_DAY) > 0) m.hungerDays++;
    // settled promises older than a day no longer need a slot
    for (let k = m.commitments.length - 1; k >= 0; k--) {
      const c = m.commitments[k]!;
      if (c.done && tick - c.due > TICKS_PER_DAY) m.commitments.splice(k, 1);
    }
  }
}

/** Does this agent sense, from its own days, that cold is on its way or already here? */
export function sensesCold(a: Agent): 0 | 1 | 2 {
  const m = a.mind;
  if (m.coldRun >= 1 || m.tempEma < COLD_DAY + 20) return 2;
  if (m.tempTrend <= COOLING_TREND && m.tempEma < 235) return 1;
  return 0;
}
