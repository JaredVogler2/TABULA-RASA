/**
 * Crafts and the works they open, and newcomers drawn by a thriving settlement.
 *
 * Everything in this file is behind one of two switches of the world's configuration,
 * `crafts` and `arrivals`. With both off nothing here runs and nothing it could build exists,
 * so such a world is stepped exactly as engine 0.7.0 stepped it (D-055).
 *
 * What is supplied and what is not. The ladder is the designers': six crafts, the work each
 * opens, what each work does to bodies and food. It is listed in the affordance registry as
 * supplied, like the recipes before it. Nothing here says who learns a craft, who is let near
 * a mill, who feeds the one who tends the sick, or whether a people keeps what it has learned:
 * a craft is known by persons, found by their own practice, taken in by those who watch them
 * work or read what was written down, and gone when the last who knows it is.
 */
import { Stream, below, chance } from "../core/rng";
import {
  CARE_MAX,
  CARE_PER_UNIT,
  CRAFT_COUNT,
  CRAFT_SPECS,
  Craft,
  FIELD_MIN_FERTILITY,
  FIRST_WORK_KIND,
  GRANARY_SPOIL_FACTOR,
  HERB_INSIGHT,
  ITEM_COUNT,
  Item,
  MILL_PER_DAY,
  STORE_SPOIL_FACTOR,
  STRUCTURE_SPECS,
  STUDY_LEARN,
  StructureKind,
  Trait,
  WATCH_LEARN,
  Water,
  Biome,
  craftFor,
  type CraftSpec,
} from "../model/constants";
import { ACTOR_ENV, type Agent, type Structure, type WorldState } from "../model/types";
import { droughtActive, sightRadius } from "../world/climate";
import { agentCapacity, createAgent, livingLimit } from "../world/population";
import { emit, type EventOut } from "./events";
import { foodEnergy, sink, source } from "./inventory";
import type { Scratch } from "./scratch";

// ───────────────────────── what a structure is for

export function knows(a: Agent, craft: number): boolean {
  return (a.lore & (1 << craft)) !== 0;
}

/** Beds in a structure of this kind (0 if it is not somewhere to sleep). */
export function bedsOf(kind: number): number {
  return kind === StructureKind.shelter || kind === StructureKind.house || kind === StructureKind.healing_house ? STRUCTURE_SPECS[kind]!.capacity : 0;
}

/**
 * Can an agreement take a structure of this kind under its control? A place that holds goods
 * or a home, as it always was — which in a world with crafts includes a granary, a mill and a
 * stone house. (A healing house cannot be closed to anyone: the sick are taken in.)
 */
export function bindable(kind: number): boolean {
  return holdsGoods(kind) || kind === StructureKind.shelter || kind === StructureKind.house;
}

/** Does a structure of this kind hold goods that can be put in and taken out? */
export function holdsGoods(kind: number): boolean {
  return kind === StructureKind.store || kind === StructureKind.granary || kind === StructureKind.mill;
}

/** The weight a goods-holding structure takes. */
export function goodsCapacity(kind: number): number {
  return STRUCTURE_SPECS[kind]!.capacity;
}

/** Spoilage multiplier (permille) for food kept in a structure of this kind. */
export function spoilFactor(kind: number): number {
  return kind === StructureKind.granary ? GRANARY_SPOIL_FACTOR : STORE_SPOIL_FACTOR;
}

/** Integrity lost to a day's weather, by kind (the first toolkit as it always was). */
export function dailyWear(kind: number): number {
  switch (kind) {
    case StructureKind.shelter:
      return 5;
    case StructureKind.store:
    case StructureKind.healing_house:
      return 3;
    case StructureKind.granary:
      return 2;
    case StructureKind.house:
    case StructureKind.mill:
    case StructureKind.record_house:
      return 1;
    default:
      return 0;
  }
}

/** Is a tile beside running water? (A mill's wheel has to stand in a stream.) */
export function besideStream(world: WorldState, sc: Scratch, x: number, y: number): boolean {
  const { w, h } = sc;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (world.terrain.water[yy * w + xx] === Water.stream) return true;
    }
  }
  return false;
}

/** Does the water beside a mill run today? Not in a drought where the stream is a seasonal one, and not in a hard frost. */
export function streamRuns(world: WorldState, sc: Scratch, s: Structure): boolean {
  if (world.climate.temp < -20) return false;
  const { w, h } = sc;
  const dry = droughtActive(world);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = s.x + dx;
      const yy = s.y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const tile = yy * w + xx;
      if (world.terrain.water[tile] !== Water.stream) continue;
      if (!dry || (world.terrain.fresh[tile] as number) === 2) return true;
    }
  }
  return false;
}

/**
 * May this person lay out a new structure of this kind on this tile? Null if so, otherwise the
 * reason the world gives. (Carrying materials to a site someone else laid out, and working on
 * it, takes no craft: that is how a work gets raised by many hands, and how they come to learn it.)
 */
export function mayFound(world: WorldState, sc: Scratch, a: Agent, kind: number, x: number, y: number): string | null {
  if (kind < FIRST_WORK_KIND) return null;
  if (!world.config.crafts) return "disabled";
  if (!knows(a, craftFor(kind))) return "unknown_craft";
  if (kind === StructureKind.field && (world.terrain.fertility[y * sc.w + x] as number) < FIELD_MIN_FERTILITY) return "infertile";
  if (kind === StructureKind.mill && !besideStream(world, sc, x, y)) return "no_stream";
  return null;
}

// ───────────────────────── how a craft comes to a person

function hasNeeds(a: Agent, c: CraftSpec): boolean {
  for (const need of c.needs) if (!knows(a, need)) return false;
  return true;
}

/** Has this person practised enough for the craft to come to them? */
export function practised(a: Agent, c: CraftSpec): boolean {
  if (!hasNeeds(a, c)) return false;
  for (const [cls, ticks] of c.practice) if ((a.stats.activity[cls] as number) < ticks) return false;
  if (c.skill && (a.skills[c.skill[0]] as number) < c.skill[1]) return false;
  return true;
}

/** How a chance is scaled by who the person is and by the world's learning rate: ×0.5 for the least curious, ×1.5 for the most. */
function keen(world: WorldState, a: Agent, base: number): number {
  return Math.round((base * (50 + (a.traits[Trait.curiosity] as number)) * world.config.learningRate) / 100_000);
}

/** The chance of finding a craft by oneself: `keen`, scaled by how readily this world's practice turns into know-how. */
function alone(world: WorldState, a: Agent, base: number): number {
  return Math.round((keen(world, a, base) * world.config.discovery) / 1000);
}

function take(world: WorldState, a: Agent, craft: number): void {
  a.lore |= 1 << craft;
}

/** Each morning: those whose practice has earned a craft may find it. One craft a person a day. */
export function dailyInsight(world: WorldState, out: EventOut, day: number): void {
  const seed = world.config.seed;
  const epoch = world.meta.branch.rngEpoch;
  for (const a of world.agents) {
    if (!a.alive) continue;
    for (const c of CRAFT_SPECS) {
      if (c.insight <= 0 || knows(a, c.id) || !practised(a, c)) continue;
      if (!chance(alone(world, a, c.insight), 1_000_000, seed, Stream.Crafts, day, a.id, c.id, epoch)) continue;
      take(world, a, c.id);
      world.metrics.discoveries++;
      emit(world, out, "discovered", a.id, { q: c.id, x: a.x, y: a.y, r: "practice" });
      break;
    }
  }
}

/** Getting over an illness can show a practised forager which plants eased it. */
export function insightOnRecovery(world: WorldState, a: Agent, out: EventOut): void {
  if (!world.config.crafts || knows(a, Craft.herb_lore)) return;
  const c = CRAFT_SPECS[Craft.herb_lore]!;
  if (!practised(a, c)) return;
  if (!chance(alone(world, a, HERB_INSIGHT), 1000, world.config.seed, Stream.Crafts, world.tick, a.id, 90, world.meta.branch.rngEpoch)) return;
  take(world, a, c.id);
  world.metrics.discoveries++;
  emit(world, out, "discovered", a.id, { q: c.id, x: a.x, y: a.y, r: "illness" });
}

/**
 * Someone who knows a craft has just used it where others can see: those awake and in sight
 * who do not know it, and are ready for it, may take it in.
 */
export function demonstrate(world: WorldState, doer: Agent, craft: number, out: EventOut): void {
  if (!world.config.crafts || !knows(doer, craft)) return;
  const c = CRAFT_SPECS[craft]!;
  const r = sightRadius(world);
  const r2 = r * r + r;
  const seed = world.config.seed;
  for (const o of world.agents) {
    if (!o.alive || o.asleep || o.id === doer.id || knows(o, craft)) continue;
    const dx = o.x - doer.x;
    const dy = o.y - doer.y;
    if (dx * dx + dy * dy > r2) continue;
    if (!hasNeeds(o, c)) continue;
    if (!chance(keen(world, o, WATCH_LEARN), 1000, seed, Stream.Crafts, world.tick, o.id, 100 + craft, doer.id)) continue;
    take(world, o, craft);
    world.metrics.learned++;
    emit(world, out, "learned", o.id, { b: doer.id, q: craft, x: o.x, y: o.y, r: "watching" });
  }
}

/**
 * A visit to a record house. Someone who keeps records writes down one craft they know and
 * it lacks; anyone else reads, and may come away with one craft it holds that they are ready
 * for. Returns true if anything was written or learned.
 */
export function visitRecords(world: WorldState, a: Agent, s: Structure, out: EventOut): boolean {
  if (!world.config.crafts || s.kind !== StructureKind.record_house || !s.complete || s.removed) return false;
  if (knows(a, Craft.record_keeping)) {
    const add = a.lore & ~s.lore;
    for (let c = 0; c < CRAFT_COUNT; c++) {
      if ((add & (1 << c)) === 0) continue;
      s.lore |= 1 << c;
      world.metrics.inscribed++;
      emit(world, out, "inscribed", a.id, { s: s.id, q: c, x: s.x, y: s.y });
      demonstrate(world, a, Craft.record_keeping, out);
      return true;
    }
  }
  for (const c of CRAFT_SPECS) {
    if ((s.lore & (1 << c.id)) === 0 || knows(a, c.id) || !hasNeeds(a, c)) continue;
    if (!chance(keen(world, a, STUDY_LEARN), 1000, world.config.seed, Stream.Crafts, world.tick, a.id, 200 + c.id, s.id)) return false;
    take(world, a, c.id);
    world.metrics.learned++;
    emit(world, out, "learned", a.id, { s: s.id, q: c.id, x: s.x, y: s.y, r: "reading" });
    return true;
  }
  return false;
}

// ───────────────────────── what the works do

/** Units of an item a healing house can turn into care (berries and fibre: what a herb-gatherer brings). */
export function isRemedy(item: number): boolean {
  return item === Item.berry || item === Item.fiber;
}

/**
 * Lay up care in a healing house from berries or fibre: only someone who knows herbs can.
 * Returns the units used (0 if the house is full).
 */
export function layUpCare(world: WorldState, a: Agent, s: Structure, item: number, qty: number, out: EventOut, parents: number[]): number {
  const room = Math.floor((CARE_MAX - s.fuel) / CARE_PER_UNIT);
  const q = Math.min(qty, a.inv[item] as number, room);
  if (q <= 0) return 0;
  a.inv[item] = (a.inv[item] as number) - q;
  sink(world, item, q);
  s.fuel += q * CARE_PER_UNIT;
  world.metrics.careLaid += q;
  emit(world, out, "tended", a.id, { s: s.id, i: item, q, x: s.x, y: s.y, p: parents });
  demonstrate(world, a, Craft.herb_lore, out);
  return q;
}

/**
 * One tick asleep in a healing house, for someone ill or hurt. Rest alone halves an illness;
 * with care laid up it passes four times as fast and health comes back. Returns the health
 * to add this tick (the caller adds it only if nothing is harming the body).
 */
export function healIn(world: WorldState, a: Agent, s: Structure): number {
  if (a.ill <= 0 && a.health >= 1000) return 0;
  let cared = false;
  if (s.fuel > 0) {
    s.fuel--;
    world.metrics.careSpent++;
    cared = true;
  }
  // the illness is never ended here: its own clock runs it out, and says so
  if (a.ill > 1) a.ill = Math.max(1, a.ill - (cared ? 3 : 1));
  return cared ? 2 : 0;
}

/** Each morning a mill whose stream runs turns roots into rations, one for one. */
function grind(world: WorldState, sc: Scratch, out: EventOut): void {
  for (const s of world.structures) {
    if (s.removed || !s.complete || s.kind !== StructureKind.mill) continue;
    const roots = s.inv[Item.root] as number;
    if (roots <= 0 || !streamRuns(world, sc, s)) continue;
    const q = Math.min(roots, MILL_PER_DAY);
    s.inv[Item.root] = roots - q;
    sink(world, Item.root, q);
    s.inv[Item.ration] = (s.inv[Item.ration] as number) + q;
    source(world, Item.ration, q);
    world.metrics.milled += q;
    emit(world, out, "milled", ACTOR_ENV, { s: s.id, q, x: s.x, y: s.y });
  }
}

/** The works' share of a morning (worlds with crafts). */
export function dailyWorks(world: WorldState, sc: Scratch, out: EventOut, day: number): void {
  grind(world, sc, out);
  dailyInsight(world, out, day);
}

// ───────────────────────── newcomers drawn by a thriving settlement

/** Food laid up, in energy a head, before anyone is drawn: five days of an adult's eating. */
export const ARRIVAL_LARDER = 1550;
/** Beds that must stand empty. */
export const ARRIVAL_SPARE_BEDS = 2;
/** The chance in a thousand, on a morning when both hold, that a boat comes. */
export const ARRIVAL_CHANCE = 200;

/**
 * A settlement with beds to spare and food laid up draws newcomers: one to three adults who
 * know nothing of the island and no craft, landed on the shore nearest its fullest larder.
 * Boats come only in spring and summer: what is laid up in autumn is for the winter, and a
 * larder that is still full when the warm days return is a larder with something to spare.
 * Bounded by the room the world's record has and by the most who may be alive at once.
 */
export function drawNewcomers(world: WorldState, sc: Scratch, out: EventOut, day: number, season: number): void {
  const cfg = world.config;
  if (season > 1) return;
  let living = 0;
  for (const a of world.agents) if (a.alive) living++;
  if (living === 0) return;
  const room = Math.min(agentCapacity(cfg) - world.agents.length, livingLimit(cfg) - living);
  if (room <= 0) return;
  let beds = 0;
  let larder = 0;
  let best: Structure | null = null;
  let bestFood = -1;
  for (const s of world.structures) {
    if (s.removed || !s.complete) continue;
    if (s.kind === StructureKind.shelter || s.kind === StructureKind.house) beds += STRUCTURE_SPECS[s.kind]!.capacity;
    if (!holdsGoods(s.kind)) continue;
    const food = foodEnergy(s.inv);
    larder += food;
    if (food > bestFood) {
      bestFood = food;
      best = s;
    }
  }
  const spare = beds - living;
  if (spare < ARRIVAL_SPARE_BEDS || larder < living * ARRIVAL_LARDER || !best) return;
  const seed = cfg.seed;
  const epoch = world.meta.branch.rngEpoch;
  if (!chance(ARRIVAL_CHANCE, 1000, seed, Stream.Arrivals, day, epoch)) return;
  const count = Math.min(room, spare >> 1, 1 + below(3, seed, Stream.Arrivals, day, epoch, 1));
  if (count <= 0) return;

  // the shore tiles nearest that larder, nearest first (ties by tile index)
  const { w, h } = sc;
  const terrain = world.terrain;
  const shore: { tile: number; d: number }[] = [];
  for (let tile = 0; tile < w * h; tile++) {
    if (terrain.biome[tile] !== Biome.shore || (terrain.moveCost[tile] as number) === 0 || terrain.water[tile] !== Water.none) continue;
    const x = tile % w;
    const y = (tile - x) / w;
    const dx = x - best.x;
    const dy = y - best.y;
    shore.push({ tile, d: dx * dx + dy * dy });
  }
  if (shore.length === 0) return;
  shore.sort((p, q) => p.d - q.d || p.tile - q.tile);
  const taken = new Set(world.agents.map((a) => a.name));
  for (let k = 0; k < count; k++) {
    const tile = shore[Math.min(k, shore.length - 1)]!.tile;
    const x = tile % w;
    const id = world.agents.length;
    const a = createAgent(cfg, terrain, world.nodes, id, x, (tile - x) / w, taken);
    a.since = world.tick;
    world.agents.push(a);
    for (let i = 0; i < ITEM_COUNT; i++) source(world, i, a.inv[i] as number);
    // they come ashore knowing the air of the day they land in, as the founders did
    a.mind.tempEma = world.climate.temp - Math.floor(((terrain.height[tile] as number) * 40) / 1000);
    world.metrics.arrivals++;
    emit(world, out, "arrival", a.id, { x: a.x, y: a.y, r: "drawn", s: best.id });
  }
}
