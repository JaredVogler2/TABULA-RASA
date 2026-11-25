/**
 * The scripted positive control (treatment `scripted_control`).
 *
 * A designer-authored charter is put before the population once, so that a study can check
 * that institutions have something to do in this world at all. It is NOT emergence and is
 * never counted as such: its origin is recorded as "scripted" on the proposal, on the
 * institution and on every report that mentions it.
 *
 * Even here nobody is enrolled. The charter is attributed to an agent who built a store, it
 * is announced aloud, and every membership is that person's own recorded act of consent.
 */
import { Item, StructureKind, TICKS_PER_DAY } from "../model/constants";
import type { WorldState } from "../model/types";
import type { EventOut } from "../sim/events";
import type { Scratch } from "../sim/scratch";
import { propose } from "./engine";
import { GRAMMAR_VERSION, type Charter } from "./types";

/**
 * The control charter: a common larder with a modest due, a hunger-tested ration and a small
 * bond — and, where a hearth stands beside the store, an undertaking to keep it in fuel
 * through the winter. Pooling food only moves it about; a fire that does not go out is the
 * one thing in a hard winter that many hands provide better than each alone.
 */
export function controlCharter(store: number, hearth = -1): Charter {
  const keepFire: Charter["rules"] =
    hearth >= 0 ? [{ r: "must_supply", who: { t: "all" }, structure: hearth, worth: { c: 8 }, when: { o: "eq", a: { v: "season" }, b: { c: 3 } }, else: { t: "suspend", periods: 1 } }] : [];
  return {
    grammar: GRAMMAR_VERSION,
    name: hearth >= 0 ? "Hearth and larder" : "Common larder",
    purpose: hearth >= 0 ? "Each member puts by a little food while the days are warm and brings wood to the fire in winter; anyone may draw a ration in winter or when visibly hungry." : "Each member puts by a little food while the days are warm; anyone may draw a ration in winter or when visibly hungry.",
    minFounders: 3,
    maxMembers: 40,
    entry: "open",
    bond: { item: Item.root, qty: 1 },
    roles: [],
    decide: { rule: "majority", quorum: 500 },
    period: TICKS_PER_DAY,
    stores: [store],
    rules: [
      ...keepFire,
      // must: one unit of food a day outside winter, or be suspended for two days
      { r: "must_deposit", who: { t: "all" }, item: -1, qty: { c: 1 }, when: { o: "lt", a: { v: "season" }, b: { c: 3 } }, else: { t: "suspend", periods: 2 } },
      // may: two units a day in winter; three on any day one looks hungry; otherwise nothing
      {
        r: "may_withdraw",
        who: { t: "all" },
        item: -1,
        quota: { o: "if", a: { o: "ge", a: { v: "hunger" }, b: { c: 2 } }, b: { c: 3 }, e: { o: "if", a: { o: "eq", a: { v: "season" }, b: { c: 3 } }, b: { c: 2 }, e: { c: 0 } } },
      },
    ],
    days: 0,
  };
}

/** Day on which the control charter is first put forward (it waits for a store to exist). */
const CONTROL_FROM_DAY = 3;

export function tickScripted(world: WorldState, _sc: Scratch, out: EventOut): void {
  if (world.config.institutions !== "scripted_control") return;
  if (world.tick % 24 !== 0 || world.tick < CONTROL_FROM_DAY * TICKS_PER_DAY) return;
  if (world.inst.proposals.some((p) => p.origin === "scripted" && p.state !== "lapsed")) return;
  // attribute it to the living founder of a finished, uncontrolled store — one raised by few hands
  // first, since a store can be put under lock only when everyone who raised it has signed
  const candidates = world.structures.filter((s) => !s.removed && s.complete && s.kind === StructureKind.store && s.bound < 0).sort((p, q) => p.builders.length - q.builders.length || p.id - q.id);
  for (const s of candidates) {
    const founder = world.agents[s.founder];
    if (!founder || !founder.alive || founder.asleep) continue;
    if ((founder.inv[Item.root] as number) < 1) continue;
    // a finished hearth within three tiles of the store, if there is one
    let hearth = -1;
    for (const f of world.structures) {
      if (f.removed || !f.complete || f.kind !== StructureKind.campfire) continue;
      if (Math.max(Math.abs(f.x - s.x), Math.abs(f.y - s.y)) <= 3) {
        hearth = f.id;
        break;
      }
    }
    if (propose(world, founder, controlCharter(s.id, hearth), out, "scripted") === "done") {
      const id = world.inst.proposals[world.inst.proposals.length - 1]!.id;
      // spoken aloud where the founder stands; only those in earshot learn of it, and they may tell others
      world.speech.push({ id: world.nextUtterance++, tick: world.tick, from: founder.id, to: -1, x: founder.x, y: founder.y, act: { t: "announce", proposal: id } });
      world.metrics.utterances++;
      return;
    }
  }
}
