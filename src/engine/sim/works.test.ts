import { describe, expect, it } from "vitest";
import { Stream, u32 } from "../core/rng";
import { makeConfig, type WorldConfig } from "../model/config";
import {
  AGES,
  CARE_PER_UNIT,
  CRAFT_SPECS,
  Craft,
  FIELD_RESOW_LABOR,
  FIELD_RESOW_ROOTS,
  FIELD_YIELD,
  Item,
  MILL_PER_DAY,
  STRUCTURE_SPECS,
  StructureKind,
  TICKS_PER_DAY,
  Trait,
  Water,
} from "../model/constants";
import type { Agent, Intent, SimEvent, Structure, WorldState } from "../model/types";
import { legacyOf, needsOf, readAges, standingAge, tally } from "../metrics/ages";
import { buildObservation } from "../mind/observe";
import { restoreWorld, serializeWorld, worldDigest } from "../save/snapshot";
import { createWorld } from "../world/create";
import { agentCapacity, livingLimit } from "../world/population";
import { auditGoods, emptyInv, source } from "./inventory";
import { NO_ROUTE_SLOTS, indexAgents, scratchOf, structureAt } from "./scratch";
import { step } from "./step";
import { ARRIVAL_LARDER, besideStream, dailyInsight, demonstrate, knows, mayFound, visitRecords } from "./works";

/**
 * The rules added in engine 0.8.0, one at a time. Each test builds the smallest situation that
 * shows a rule and lets the real tick pipeline run it: nothing here calls a handler that the
 * engine itself would not call, except where a single function is the rule (insight, watching).
 */

const out: SimEvent[] = [];

function world(over: Partial<WorldConfig> = {}, seed = 3): WorldState {
  return createWorld(makeConfig("first_light", seed, { crafts: true, population: 6, policy: "reflex", institutions: "off", illness: 0, ...over }));
}

/** Step, keeping one person's body out of the way of what is being tested. */
function run(w: WorldState, ticks: number, keep: Agent[] = []): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const a of keep) {
      a.energy = 900;
      a.hydration = 900;
      a.warmth = 900;
    }
    step(w, out);
    all.push(...out);
    out.length = 0;
  }
  return all;
}

function give(w: WorldState, a: Agent, item: number, qty: number): void {
  a.inv[item] = (a.inv[item] as number) + qty;
  source(w, item, qty);
}

function teach(a: Agent, ...crafts: number[]): void {
  for (const c of crafts) a.lore |= 1 << c;
}

/** A free, walkable land tile satisfying `ok`, nearest the middle of the map. */
function freeTile(w: WorldState, ok: (x: number, y: number, tile: number) => boolean = () => true): { x: number; y: number } {
  const sc = scratchOf(w);
  const t = w.terrain;
  let best = -1;
  let bestD = Infinity;
  for (let tile = 0; tile < t.w * t.h; tile++) {
    if ((t.moveCost[tile] as number) === 0 || t.water[tile] !== Water.none || (w.nodes.atTile[tile] as number) >= 0 || structureAt(w, sc, tile) >= 0) continue;
    const x = tile % t.w;
    const y = (tile - x) / t.w;
    if (!ok(x, y, tile)) continue;
    const d = (x - t.w / 2) ** 2 + (y - t.h / 2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = tile;
    }
  }
  expect(best).toBeGreaterThanOrEqual(0);
  return { x: best % t.w, y: (best - (best % t.w)) / t.w };
}

function put(a: Agent, x: number, y: number): void {
  a.x = x;
  a.y = y;
  a.px = x;
  a.py = y;
  a.act = null;
  a.queue = [];
  a.path = [];
  a.pathKey = -1;
}

/** Stand a structure in the world as the engine would have left it. */
function raise(w: WorldState, kind: number, x: number, y: number, complete = true): Structure {
  const missing = emptyInv();
  if (!complete) for (const [item, qty] of STRUCTURE_SPECS[kind]!.materials) missing[item] = qty;
  const s: Structure = {
    id: w.structures.length,
    kind,
    x,
    y,
    foundedTick: w.tick,
    builtTick: complete ? w.tick : -1,
    founder: 0,
    contributors: [],
    contributions: [],
    builders: [0],
    missing,
    laborDone: complete ? STRUCTURE_SPECS[kind]!.labor : 0,
    laborNeeded: STRUCTURE_SPECS[kind]!.labor,
    complete,
    fuel: 0,
    inv: emptyInv(),
    open: emptyInv(),
    ripeTick: -1,
    occupants: 0,
    bound: -1,
    integrity: 1000,
    removed: false,
    lore: 0,
  };
  w.structures.push(s);
  w.nextStructure = w.structures.length;
  scratchOf(w).structDirty = true;
  return s;
}

function stock(w: WorldState, s: Structure, item: number, qty: number): void {
  s.inv[item] = (s.inv[item] as number) + qty;
  source(w, item, qty);
}

/** Give one person a plan and run until it is done, refused, or time is up. */
function doPlan(w: WorldState, a: Agent, intents: Intent[], limit = 400): SimEvent[] {
  a.queue = intents.slice();
  a.act = null;
  a.progress = 0;
  const all: SimEvent[] = [];
  for (let i = 0; i < limit; i++) {
    all.push(...run(w, 1, [a]));
    if (a.queue.length === 0 && a.act === null) break;
    if (all.some((e) => e.k === "rejected" && e.a === a.id)) break;
  }
  return all;
}

const refusal = (events: SimEvent[], a: Agent): string | undefined => events.find((e) => e.k === "rejected" && e.a === a.id)?.r;

describe("laying out a work takes its craft", () => {
  it("is refused to someone who does not know it, and to everyone in a world without crafts", () => {
    const w = world();
    const a = w.agents[0]!;
    const fertile = (_x: number, _y: number, tile: number): boolean => (w.terrain.fertility[tile] as number) >= 60;
    const spot = freeTile(w, fertile);
    put(a, spot.x, spot.y + 1 < w.terrain.h ? spot.y : spot.y);
    give(w, a, Item.root, 4);
    give(w, a, Item.wood, 4);
    expect(refusal(doPlan(w, a, [{ k: "build", kind: StructureKind.field, x: spot.x, y: spot.y }]), a)).toBe("unknown_craft");
    expect(w.structures.length).toBe(0);

    teach(a, Craft.tillage);
    const events = doPlan(w, a, [{ k: "build", kind: StructureKind.field, x: spot.x, y: spot.y }]);
    expect(refusal(events, a)).toBeUndefined();
    expect(w.structures[0]?.kind).toBe(StructureKind.field);

    const old = createWorld(makeConfig("first_light", 3, { population: 6, policy: "reflex", institutions: "off" }));
    const b = old.agents[0]!;
    teach(b, Craft.tillage); // even with the bit set by hand: the world itself has no crafts
    const there = freeTile(old, (_x, _y, tile) => (old.terrain.fertility[tile] as number) >= 60);
    put(b, there.x, there.y);
    give(old, b, Item.root, 4);
    give(old, b, Item.wood, 4);
    expect(refusal(doPlan(old, b, [{ k: "build", kind: StructureKind.field, x: there.x, y: there.y }]), b)).toBe("disabled");
  });

  it("but carrying to a work someone else laid out, and working on it, takes none", () => {
    const w = world();
    const [knower, helper] = [w.agents[0]!, w.agents[1]!];
    teach(knower, Craft.storekeeping);
    const spot = freeTile(w);
    put(knower, spot.x, spot.y);
    give(w, knower, Item.wood, 1);
    doPlan(w, knower, [{ k: "build", kind: StructureKind.granary, x: spot.x, y: spot.y }], 6);
    const site = w.structures[0]!;
    expect(site.kind).toBe(StructureKind.granary);
    expect(site.complete).toBe(false);
    // the helper knows nothing, brings everything, and finishes it
    knower.queue = [];
    put(helper, spot.x, spot.y);
    for (const [item, qty] of STRUCTURE_SPECS[StructureKind.granary]!.materials) give(w, helper, item, qty);
    helper.phys[0] = 95;
    const events = doPlan(w, helper, [{ k: "build", kind: StructureKind.granary, x: spot.x, y: spot.y }], 600);
    expect(refusal(events, helper)).toBeUndefined();
    expect(site.complete).toBe(true);
    expect(knows(helper, Craft.storekeeping)).toBe(false); // helping teaches nothing by itself: only watching one who knows does
    expect(auditGoods(w)).toBeNull();
  });

  it("a mill has to stand beside a stream", () => {
    const w = world();
    const a = w.agents[0]!;
    teach(a, Craft.millwrighting);
    const sc = scratchOf(w);
    const dry = freeTile(w, (x, y) => !besideStream(w, sc, x, y));
    const wet = freeTile(w, (x, y) => besideStream(w, sc, x, y));
    expect(mayFound(w, sc, a, StructureKind.mill, dry.x, dry.y)).toBe("no_stream");
    expect(mayFound(w, sc, a, StructureKind.mill, wet.x, wet.y)).toBeNull();
  });
});

describe("a field", () => {
  it("is sown, ripens, is reaped for more than a plot gives, and stands to be sown again", () => {
    const w = world();
    const a = w.agents[0]!;
    teach(a, Craft.tillage);
    const spot = freeTile(w, (_x, _y, tile) => (w.terrain.fertility[tile] as number) >= 45 && (w.terrain.fertility[tile] as number) < 70);
    put(a, spot.x, spot.y);
    const had = a.inv[Item.root] as number; // people start with a root or two of their own
    give(w, a, Item.root, 2);
    give(w, a, Item.wood, 2);
    a.skills[6] = 100;
    doPlan(w, a, [{ k: "build", kind: StructureKind.field, x: spot.x, y: spot.y }]);
    const field = w.structures[0]!;
    expect(field.complete).toBe(true);
    expect(field.ripeTick).toBeGreaterThan(w.tick);
    expect(a.inv[Item.root]).toBe(had);
    const made = field.builtTick;

    expect(refusal(doPlan(w, a, [{ k: "harvest", structure: field.id }], 20), a)).toBe("not_ripe");
    field.ripeTick = w.tick; // the days pass
    const events = doPlan(w, a, [{ k: "harvest", structure: field.id }], 40);
    expect(events.find((e) => e.k === "harvest")?.q).toBe(FIELD_YIELD);
    expect(a.inv[Item.root]).toBe(had + FIELD_YIELD);
    expect(field.removed).toBe(false);
    expect(field.complete).toBe(false);
    expect(field.missing[Item.root]).toBe(FIELD_RESOW_ROOTS);
    expect(field.laborNeeded).toBe(FIELD_RESOW_LABOR);
    expect(w.metrics.fieldHarvests).toBe(1);

    // sown again by building on its site with seed alone: no wood this time
    const again = doPlan(w, a, [{ k: "build", kind: StructureKind.field, x: spot.x, y: spot.y }]);
    expect(again.some((e) => e.k === "plant" && e.s === field.id)).toBe(true);
    expect(field.complete).toBe(true);
    expect(field.builtTick).toBe(made);
    expect(a.inv[Item.root]).toBe(had + FIELD_YIELD - FIELD_RESOW_ROOTS);
    expect(auditGoods(w)).toBeNull();
  });
});

describe("how a craft comes to a person", () => {
  it("from practice: the practised find it, the unpractised never do", () => {
    const w = world({ learningRate: 4000 });
    const [practised, idle] = [w.agents[0]!, w.agents[1]!];
    const spec = CRAFT_SPECS[Craft.tillage]!;
    for (const [cls, ticks] of spec.practice) practised.stats.activity[cls] = ticks;
    practised.skills[spec.skill![0]] = spec.skill![1];
    practised.traits[Trait.curiosity] = 90;
    idle.traits[Trait.curiosity] = 98;
    idle.skills[6] = 0;
    const events: SimEvent[] = [];
    for (let day = 1; day <= 120 && !knows(practised, Craft.tillage); day++) dailyInsight(w, events, day);
    expect(knows(practised, Craft.tillage)).toBe(true);
    expect(knows(idle, Craft.tillage)).toBe(false);
    expect(events.filter((e) => e.k === "discovered")).toHaveLength(1);
    expect(w.metrics.discoveries).toBe(1);
  });

  it("a craft that rests on others does not come without them, however much is practised", () => {
    const w = world({ learningRate: 4000 });
    const a = w.agents[0]!;
    const spec = CRAFT_SPECS[Craft.millwrighting]!;
    for (const [cls, ticks] of spec.practice) a.stats.activity[cls] = ticks * 3;
    a.traits[Trait.curiosity] = 98;
    const events: SimEvent[] = [];
    for (let day = 1; day <= 400; day++) dailyInsight(w, events, day);
    expect(knows(a, Craft.millwrighting)).toBe(false);
    teach(a, Craft.masonry, Craft.tillage);
    for (let day = 401; day <= 800 && !knows(a, Craft.millwrighting); day++) dailyInsight(w, events, day);
    expect(knows(a, Craft.millwrighting)).toBe(true);
  });

  it("from watching: those in sight and ready take it in; the unready, the sleeping and the far away do not", () => {
    const w = world({ learningRate: 4000, population: 8 });
    const [doer, ready, unready, asleep, far] = [w.agents[0]!, w.agents[1]!, w.agents[2]!, w.agents[3]!, w.agents[4]!];
    const spot = freeTile(w);
    for (const a of [doer, ready, unready, asleep]) put(a, spot.x, spot.y);
    const sight = w.config.sightRadius;
    far.x = Math.min(w.terrain.w - 1, spot.x + sight * 3);
    teach(doer, Craft.millwrighting);
    teach(ready, Craft.masonry, Craft.tillage);
    teach(asleep, Craft.masonry, Craft.tillage);
    teach(far, Craft.masonry, Craft.tillage);
    asleep.asleep = true;
    for (const a of w.agents) a.traits[Trait.curiosity] = 98;
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && !knows(ready, Craft.millwrighting); i++) {
      w.tick++;
      demonstrate(w, doer, Craft.millwrighting, events);
    }
    expect(knows(ready, Craft.millwrighting)).toBe(true);
    expect(knows(unready, Craft.millwrighting)).toBe(false);
    expect(knows(asleep, Craft.millwrighting)).toBe(false);
    expect(knows(far, Craft.millwrighting)).toBe(false);
    const learned = events.filter((e) => e.k === "learned");
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({ a: ready.id, b: doer.id, q: Craft.millwrighting, r: "watching" });
  });

  it("from a record house: what is written there can be read by anyone ready for it, and only a record keeper can write", () => {
    const w = world({ learningRate: 4000 });
    const [keeper, reader, stranger] = [w.agents[0]!, w.agents[1]!, w.agents[2]!];
    const spot = freeTile(w);
    const house = raise(w, StructureKind.record_house, spot.x, spot.y);
    teach(keeper, Craft.record_keeping, Craft.masonry, Craft.storekeeping, Craft.tillage);
    teach(stranger, Craft.herb_lore);
    for (const a of w.agents) a.traits[Trait.curiosity] = 98;
    const events: SimEvent[] = [];
    // someone who cannot write leaves nothing, whatever they know
    expect(visitRecords(w, stranger, house, events)).toBe(false);
    expect(house.lore).toBe(0);
    // the keeper writes one craft a visit
    let visits = 0;
    while (visitRecords(w, keeper, house, events) && visits < 10) visits++;
    expect(visits).toBe(4);
    expect(house.lore).toBe(keeper.lore);
    expect(w.metrics.inscribed).toBe(4);
    // a reader comes away, sooner or later, with what they are ready for — never with what rests on crafts they lack
    for (let i = 0; i < 60; i++) {
      w.tick++;
      visitRecords(w, reader, house, events);
    }
    expect(knows(reader, Craft.tillage)).toBe(true);
    expect(knows(reader, Craft.masonry)).toBe(true);
    expect(knows(reader, Craft.storekeeping)).toBe(true);
    expect(knows(reader, Craft.record_keeping)).toBe(true); // it rests on the two above, which the reader has by now
    expect(knows(reader, Craft.herb_lore)).toBe(false); // the stranger could not write it down
  });
});

describe("what the works do", () => {
  it("a granary keeps food longer than a store", () => {
    const w = world({ population: 2 });
    const p = freeTile(w);
    const store = raise(w, StructureKind.store, p.x, p.y);
    const q = freeTile(w);
    const granary = raise(w, StructureKind.granary, q.x, q.y);
    stock(w, store, Item.berry, 240);
    stock(w, granary, Item.berry, 240);
    run(w, 6 * TICKS_PER_DAY);
    const lostStore = 240 - (store.inv[Item.berry] as number);
    const lostGranary = 240 - (granary.inv[Item.berry] as number);
    expect(lostStore).toBeGreaterThan(40);
    expect(lostGranary).toBeGreaterThan(0);
    expect(lostGranary * 2).toBeLessThan(lostStore);
    expect(auditGoods(w)).toBeNull();
  });

  it("a mill beside a running stream turns roots into rations, a day's worth each morning", () => {
    const w = world({ population: 2 });
    const sc = scratchOf(w);
    const wet = freeTile(w, (x, y) => besideStream(w, sc, x, y));
    const mill = raise(w, StructureKind.mill, wet.x, wet.y);
    stock(w, mill, Item.root, 50);
    const events = run(w, TICKS_PER_DAY + 1);
    expect(events.filter((e) => e.k === "milled").map((e) => e.q)).toEqual([MILL_PER_DAY]);
    expect(mill.inv[Item.ration]).toBe(MILL_PER_DAY);
    expect((mill.inv[Item.root] as number) + (mill.inv[Item.ration] as number)).toBeLessThanOrEqual(50); // some roots spoil on the way; none appear
    expect(w.metrics.milled).toBe(MILL_PER_DAY);
    expect(auditGoods(w)).toBeNull();
  });

  it("a stone house is warmer than a shelter and sleeps six", () => {
    expect(STRUCTURE_SPECS[StructureKind.house]!.capacity).toBe(6);
    const w = world({ population: 14, startDay: 34 }); // deep winter
    const p = freeTile(w);
    raise(w, StructureKind.house, p.x, p.y);
    const q = freeTile(w, (x, y) => Math.abs(x - p.x) > 3 || Math.abs(y - p.y) > 3);
    raise(w, StructureKind.shelter, q.x, q.y);
    const inHouse = w.agents.slice(0, 7);
    const inShelter = w.agents.slice(7, 12);
    for (const a of inHouse) put(a, p.x, p.y);
    for (const a of inShelter) put(a, q.x, q.y);
    for (const a of [...inHouse, ...inShelter]) {
      a.rest = 100;
      a.warmth = 600;
      a.queue = [{ k: "rest", ticks: 40 }];
    }
    run(w, 3);
    // six find a bed in the house and the seventh lies outside it; four in the shelter and the fifth outside
    expect(inHouse.filter((a) => a.shelter === 0)).toHaveLength(6);
    expect(inShelter.filter((a) => a.shelter === 1)).toHaveLength(4);
    run(w, 30);
    const mean = (xs: Agent[]): number => xs.reduce((s, a) => s + a.warmth, 0) / xs.length;
    expect(mean(inHouse.filter((a) => a.shelter === 0))).toBeGreaterThan(mean(inShelter.filter((a) => a.shelter === 1)));
  });

  it("a healing house takes in only the ill or hurt, mends them faster, and faster still with care laid up by someone who knows herbs", () => {
    const w = world({ population: 8 });
    const p = freeTile(w);
    const plain = raise(w, StructureKind.healing_house, p.x, p.y);
    const q = freeTile(w, (x, y) => Math.abs(x - p.x) > 3 || Math.abs(y - p.y) > 3);
    const cared = raise(w, StructureKind.healing_house, q.x, q.y);
    const r = freeTile(w, (x, y) => (Math.abs(x - p.x) > 3 || Math.abs(y - p.y) > 3) && (Math.abs(x - q.x) > 3 || Math.abs(y - q.y) > 3));
    raise(w, StructureKind.shelter, r.x, r.y);
    const [inPlain, inCared, inShelter, well, healer, layman] = [w.agents[0]!, w.agents[1]!, w.agents[2]!, w.agents[3]!, w.agents[4]!, w.agents[5]!];

    // care: only someone who knows herbs can lay it up, and only from berries or fibre
    put(layman, q.x, q.y);
    give(w, layman, Item.berry, 6);
    expect(refusal(doPlan(w, layman, [{ k: "deposit", structure: cared.id, item: Item.berry, qty: 6 }], 10), layman)).toBe("unknown_craft");
    put(healer, q.x, q.y);
    teach(healer, Craft.herb_lore);
    give(w, healer, Item.berry, 6);
    give(w, healer, Item.wood, 2);
    expect(refusal(doPlan(w, healer, [{ k: "deposit", structure: cared.id, item: Item.wood, qty: 2 }], 10), healer)).toBe("not_a_remedy");
    const laid = doPlan(w, healer, [{ k: "deposit", structure: cared.id, item: Item.berry, qty: 6 }], 10);
    expect(laid.find((e) => e.k === "tended")?.q).toBe(6);
    expect(cared.fuel).toBe(6 * CARE_PER_UNIT);
    expect(w.metrics.careLaid).toBe(6);

    for (const [a, at] of [[inPlain, p], [inCared, q], [inShelter, r], [well, p]] as const) {
      put(a, at.x, at.y);
      a.rest = 200; // tired enough to sleep the whole while, not so tired that the body takes over
      a.queue = [{ k: "rest", ticks: 60 }];
    }
    for (const a of [inPlain, inCared, inShelter]) {
      a.ill = 400;
      a.health = 500;
    }
    run(w, 2, [inPlain, inCared, inShelter, well]);
    expect(inPlain.shelter).toBe(plain.id);
    expect(inCared.shelter).toBe(cared.id);
    expect(well.shelter).toBe(-1); // nothing wrong with them: they are not taken in
    const before = { plain: inPlain.ill, cared: inCared.ill, shelter: inShelter.ill };
    const careBefore = cared.fuel;
    run(w, 30, [inPlain, inCared, inShelter, well]);
    expect([inPlain.asleep, inCared.asleep, inShelter.asleep]).toEqual([true, true, true]);
    const gone = { plain: before.plain - inPlain.ill, cared: before.cared - inCared.ill, shelter: before.shelter - inShelter.ill };
    // an illness runs out a tick at a time; twice as fast lying in a healing house; four times with care
    expect(gone.shelter).toBe(30);
    expect(gone.plain).toBe(60);
    expect(gone.cared).toBe(120);
    expect(inCared.health).toBeGreaterThan(inPlain.health);
    expect(careBefore - cared.fuel).toBe(30); // a tick of care for each tick it was given
    expect(auditGoods(w)).toBeNull();
  });
});

describe("newcomers drawn by a thriving settlement", () => {
  function fedAndHoused(over: Partial<WorldConfig> = {}): WorldState {
    const w = world({ arrivals: true, crafts: false, population: 10, ...over });
    for (let i = 0; i < 6; i++) {
      const at = freeTile(w);
      raise(w, StructureKind.shelter, at.x, at.y);
    }
    const at = freeTile(w);
    const store = raise(w, StructureKind.store, at.x, at.y);
    stock(w, store, Item.ration, 110); // 25,300 energy: well over five days each for ten
    expect(110 * 230).toBeGreaterThan(10 * ARRIVAL_LARDER);
    return w;
  }

  it("come in spring, with beds to spare and food laid up — and not to an island that is short of either", () => {
    const w = fedAndHoused();
    const events = run(w, 9 * TICKS_PER_DAY, w.agents.slice());
    const arrivals = events.filter((e) => e.k === "arrival");
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.every((e) => e.r === "drawn")).toBe(true);
    expect(w.metrics.arrivals).toBe(arrivals.length);
    expect(w.agents.length).toBe(10 + arrivals.length);
    // every newcomer is a whole person with a mind of the world's size, and the world can be saved and opened
    const cap = agentCapacity(w.config);
    for (const a of w.agents.slice(10)) expect([a.mind.trust.length, a.mind.metTick.length, a.lore]).toEqual([cap, cap, 0]);
    expect(worldDigest(restoreWorld(serializeWorld(w)))).toBe(worldDigest(w));
    expect(auditGoods(w)).toBeNull();

    const hungry = fedAndHoused();
    for (const s of hungry.structures) s.inv = emptyInv();
    hungry.metrics.sources[Item.ration] = 0;
    expect(run(hungry, 9 * TICKS_PER_DAY, hungry.agents.slice()).some((e) => e.k === "arrival")).toBe(false);

    const crowded = fedAndHoused();
    for (const s of crowded.structures) if (s.kind === StructureKind.shelter) s.removed = true;
    scratchOf(crowded).structDirty = true;
    expect(run(crowded, 9 * TICKS_PER_DAY, crowded.agents.slice()).some((e) => e.k === "arrival")).toBe(false);
  });

  it("do not come in autumn or winter, nor to a world that does not draw them", () => {
    const autumn = fedAndHoused({ startDay: 20 });
    expect(run(autumn, 19 * TICKS_PER_DAY, autumn.agents.slice()).some((e) => e.k === "arrival")).toBe(false);
    const closed = fedAndHoused({ arrivals: false });
    expect(run(closed, 9 * TICKS_PER_DAY, closed.agents.slice()).some((e) => e.k === "arrival")).toBe(false);
  });

  it("never beyond two and a half times the founders alive, nor beyond the room the world's record has", () => {
    const w = fedAndHoused({ population: 4 });
    expect(livingLimit(w.config)).toBe(10);
    for (let i = 0; i < 40; i++) {
      const at = freeTile(w);
      raise(w, StructureKind.shelter, at.x, at.y);
    }
    for (let day = 0; day < 19; day++) {
      // keep the larder full whatever is eaten, so that only the limits can stop them
      const store = w.structures.find((s) => s.kind === StructureKind.store)!;
      stock(w, store, Item.ration, 100);
      run(w, TICKS_PER_DAY, w.agents.slice());
    }
    const living = w.agents.filter((a) => a.alive).length;
    expect(living).toBeGreaterThan(4);
    expect(living).toBeLessThanOrEqual(10);
    expect(w.agents.length).toBeLessThanOrEqual(agentCapacity(w.config));
  });

  it("however many come ashore within one step, the step ends (the tables hold everyone a world can)", () => {
    // Found by a ten-year run that never came back: the tile lists had sixty-four places to spare,
    // the sixty-fifth person arrived in the middle of a step, and the walk along a list read past
    // the end of its table and went round for ever. Eighty arrive here in one step.
    const shocks = Array.from({ length: 16 }, () => ({ kind: "newcomers" as const, minDay: 1, maxDay: 1, days: 0, magnitude: 1000 }));
    const w = world({ arrivals: true, shocks });
    expect(agentCapacity(w.config)).toBeGreaterThanOrEqual(6 + 80);
    run(w, TICKS_PER_DAY + 8);
    expect(w.agents.length).toBe(6 + 80);
    expect(scratchOf(w).next.length).toBeGreaterThanOrEqual(agentCapacity(w.config));
    // and they are in the tile lists (drawn up afresh, since people have walked on since the
    // step's own were made): the last to arrive can be found where they stand
    const last = w.agents[w.agents.length - 1]!;
    const sc = scratchOf(w);
    indexAgents(w, sc);
    let found = false;
    for (let id = sc.head[last.y * sc.w + last.x] as number; id >= 0; id = sc.next[id] as number) if (id === last.id) found = true;
    expect(found).toBe(last.alive);
  });

  it("and a table found too short is made longer, keeping what it held", () => {
    const w = world({ arrivals: true });
    run(w, 2);
    const sc = scratchOf(w);
    const n = w.agents.length;
    // exactly full: no place for one more
    sc.next = new Int32Array(n).fill(-1);
    sc.noRouteFrom = new Int32Array(n).fill(-1);
    sc.noRouteFrom[0] = 1234;
    sc.noRouteKeys = new Int32Array(n * NO_ROUTE_SLOTS);
    sc.noRouteCount = new Uint8Array(n);
    w.agents.push({ ...structuredClone(w.agents[0]!), id: n, name: "Extra" });
    indexAgents(w, sc);
    expect(sc.next.length).toBeGreaterThanOrEqual(agentCapacity(w.config));
    expect(sc.noRouteFrom.length).toBe(sc.next.length);
    expect(sc.noRouteCount.length).toBe(sc.next.length);
    expect(sc.noRouteKeys.length).toBe(sc.next.length * NO_ROUTE_SLOTS);
    expect(sc.noRouteFrom[0]).toBe(1234);
    // both who stand on that tile are in its list, and the list ends
    const first = w.agents[0]!;
    const here: number[] = [];
    for (let id = sc.head[first.y * sc.w + first.x] as number; id >= 0 && here.length < 99; id = sc.next[id] as number) here.push(id);
    expect(here).toContain(0);
    expect(here).toContain(n);
    expect(here.length).toBeLessThan(99);
  });
});

describe("ages and legacy: the observer's readings", () => {
  it("an age is reached only when every earlier one is, is noted once, and stays reached", () => {
    const w = world({ population: 2 });
    expect(readAges(w)).toMatchObject({ reached: 0, standing: 0 });
    expect(readAges(w).next?.needs.map((n) => `${n.key} ${n.have}/${n.want}`)).toEqual(["fires 0/5", "dwellings 0/8", "stores 0/2"]);
    const place = (kind: number, n: number): Structure[] => Array.from({ length: n }, () => {
      const at = freeTile(w);
      return raise(w, kind, at.x, at.y);
    });
    // stone houses and a granary, but no hearths yet: nothing is reached, because hearths come first
    place(StructureKind.house, 4);
    place(StructureKind.granary, 1);
    expect(standingAge(w)).toBe(0);
    const fires = place(StructureKind.campfire, 5);
    place(StructureKind.shelter, 4);
    place(StructureKind.store, 1);
    expect(standingAge(w)).toBe(1); // four houses and four shelters are eight dwellings; a granary and a store are two stores
    place(StructureKind.field, 3);
    w.metrics.fieldHarvests = 3;
    expect(standingAge(w)).toBe(3); // fields, and stone with them: its houses and its granary already stood
    const events = run(w, TICKS_PER_DAY + 1);
    expect(events.filter((e) => e.k === "age").map((e) => e.q)).toEqual([1, 2, 3]);
    expect(events.filter((e) => e.k === "age").map((e) => e.r)).toEqual([AGES[1], AGES[2], AGES[3]]);
    expect(run(w, TICKS_PER_DAY).filter((e) => e.k === "age")).toEqual([]); // once
    // the fires go: the island no longer stands where it stood, and has still reached what it reached
    for (const f of fires) f.removed = true;
    const reading = readAges(w);
    expect(reading.standing).toBe(0);
    expect(reading.reached).toBe(3);
    expect(reading.next?.age).toBe(4);
    expect(needsOf(w, tally(w), 4).map((n) => n.key)).toEqual(["mills", "milled", "healing_houses"]);
  });

  it("legacy counts what is there this morning: people, crafts known and written, works up to a limit, ages", () => {
    const w = world({ population: 5 });
    expect(legacyOf(w)).toEqual({ total: 50, people: 50, crafts: 0, works: 0, ages: 0 });
    teach(w.agents[0]!, Craft.tillage, Craft.masonry);
    teach(w.agents[1]!, Craft.tillage);
    const at = freeTile(w);
    const records = raise(w, StructureKind.record_house, at.x, at.y);
    records.lore = 1 << Craft.tillage;
    for (let i = 0; i < 30; i++) {
      const f = freeTile(w);
      raise(w, StructureKind.field, f.x, f.y);
    }
    w.metrics.ages[1] = 10;
    expect(legacyOf(w)).toEqual({ total: 50 + (2 * 60 + 40) + (25 * 4 + 60) + 150, people: 50, crafts: 160, works: 160, ages: 150 });
    // the dead take what only they knew with them; what is written stays
    w.agents[0]!.alive = false;
    expect(legacyOf(w).crafts).toBe(60 + 40);
    expect(legacyOf(w).people).toBe(40);
  });
});

describe("a world with crafts and newcomers is still a deterministic, balanced, saveable world", () => {
  it("replays to the same digests, conserves every unit, and opens from its own save", () => {
    const cfg = makeConfig("first_light", 21, { crafts: true, arrivals: true });
    const [a, b] = [createWorld(cfg), createWorld(cfg)];
    // start it with something to do: a few people who already know crafts
    for (const w of [a, b]) {
      for (let i = 0; i < 12; i++) w.agents[i]!.lore = 1 + (u32(21, Stream.Lab, i) % 63);
    }
    const digests: string[][] = [[], []];
    [a, b].forEach((w, k) => {
      for (let day = 0; day < 14; day++) {
        run(w, TICKS_PER_DAY);
        digests[k]!.push(worldDigest(w));
      }
    });
    expect(digests[0]).toEqual(digests[1]);
    expect(new Set(digests[0]).size).toBe(14);
    expect(auditGoods(a)).toBeNull();
    const opened = restoreWorld(serializeWorld(a));
    expect(worldDigest(opened)).toBe(worldDigest(a));
    run(a, 200);
    run(opened, 200);
    expect(worldDigest(opened)).toBe(worldDigest(a));
    expect(a.structures.some((s) => s.kind >= StructureKind.field)).toBe(true);
  }, 120_000);

  it("its digest covers what crafts hold: one bit of know-how changed is another world", () => {
    const w = world();
    const before = worldDigest(w);
    w.agents[0]!.lore = 1;
    expect(worldDigest(w)).not.toBe(before);
    // while in a world without the new rules the same field is not part of the digest at all
    const old = createWorld(makeConfig("first_light", 3, { population: 6 }));
    const was = worldDigest(old);
    old.agents[0]!.lore = 1;
    expect(worldDigest(old)).toBe(was);
  });
});

describe("what an outside mind is offered", () => {
  it("a work is on the list only for someone who knows its craft, in a world that has crafts", () => {
    const w = world();
    const a = w.agents[0]!;
    for (const [item, qty] of STRUCTURE_SPECS[StructureKind.mill]!.materials) give(w, a, item, qty);
    give(w, a, Item.root, 2);
    const kinds = (): number[] => (buildObservation(w, scratchOf(w), a).actions.find((o) => o.k === "build") as { kinds: number[] } | undefined)?.kinds ?? [];
    expect(kinds().every((k) => k < StructureKind.field)).toBe(true);
    expect(buildObservation(w, scratchOf(w), a).self.crafts).toEqual([]);
    teach(a, Craft.millwrighting, Craft.tillage);
    expect(kinds()).toContain(StructureKind.mill);
    expect(kinds()).toContain(StructureKind.field);
    expect(kinds()).not.toContain(StructureKind.house);
    expect(buildObservation(w, scratchOf(w), a).self.crafts).toEqual(["tillage", "millwrighting"]);

    const old = createWorld(makeConfig("first_light", 3, { population: 6 }));
    const b = old.agents[0]!;
    teach(b, Craft.millwrighting);
    for (const [item, qty] of STRUCTURE_SPECS[StructureKind.mill]!.materials) give(old, b, item, qty);
    const obs = buildObservation(old, scratchOf(old), b);
    expect((obs.actions.find((o) => o.k === "build") as { kinds: number[] }).kinds.every((k) => k < StructureKind.field)).toBe(true);
    expect("crafts" in obs.self).toBe(false);
  });
});
