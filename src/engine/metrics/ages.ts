/**
 * Ages and legacy: two readings of an island as a whole.
 *
 * They are the observer's, not the islanders'. No citizen is told that an age exists, nothing
 * a citizen can do is gated on one, and no mind — baseline or model — is shown either number.
 * An age is a threshold in what stands and what has been done, checked each morning from the
 * world's own state; the tick at which each was first passed is kept with the world so that a
 * save remembers when. Legacy is a sum over what is there now, never a running tally, so
 * tearing down and rebuilding, or waiting, adds nothing.
 *
 * Both are supplied by the designers and are listed as such in the affordance registry. They
 * say how far a people has come along a ladder the designers drew. They do not say that the
 * ladder is the only one, or that climbing it is good for anyone on it.
 */
import { AGES, AGE_COUNT, CRAFT_COUNT, StructureKind } from "../model/constants";
import { ACTOR_ENV, type WorldState } from "../model/types";
import { emit, type EventOut } from "../sim/events";
import { holdsGoods } from "../sim/works";

/** What an age asks for, as counted from the world. */
export interface AgeNeed {
  /** A stable key for the interface to word. */
  key: "fires" | "dwellings" | "stores" | "field_harvests" | "fields" | "houses" | "granaries" | "milled" | "mills" | "healing_houses" | "crafts_recorded";
  have: number;
  want: number;
}

export interface AgeReading {
  /** The highest age ever reached (index into AGES; 0 = foraging, where every island begins). */
  reached: number;
  /** The highest age whose own thresholds, and every earlier one's, hold this morning. */
  standing: number;
  /** The tick each age was first reached (-1 = not yet); index 0 is tick 0. */
  ticks: number[];
  /** What the next age after `reached` asks for, or null at the last. */
  next: { age: number; needs: AgeNeed[] } | null;
}

export interface Tally {
  living: number;
  fires: number;
  dwellings: number;
  stores: number;
  fields: number;
  granaries: number;
  houses: number;
  healingHouses: number;
  mills: number;
  recordHouses: number;
  /** The most crafts written down in any one record house. */
  recorded: number;
  /** Crafts written down in any record house, one bit each. */
  recordedLore: number;
  /** Crafts at least one living person knows, one bit each. */
  knownLore: number;
}

const bits = (x: number): number => {
  let n = 0;
  for (let c = 0; c < CRAFT_COUNT; c++) if (x & (1 << c)) n++;
  return n;
};

/** What stands and who knows what, counted once. */
export function tally(world: WorldState): Tally {
  const t: Tally = { living: 0, fires: 0, dwellings: 0, stores: 0, fields: 0, granaries: 0, houses: 0, healingHouses: 0, mills: 0, recordHouses: 0, recorded: 0, recordedLore: 0, knownLore: 0 };
  for (const a of world.agents) {
    if (!a.alive) continue;
    t.living++;
    t.knownLore |= a.lore;
  }
  for (const s of world.structures) {
    if (s.removed) continue;
    // a reaped field is still a field: it stands unsown until someone sows it again
    if (s.kind === StructureKind.field && s.builtTick >= 0) t.fields++;
    if (!s.complete) continue;
    switch (s.kind) {
      case StructureKind.campfire:
        t.fires++;
        break;
      case StructureKind.shelter:
        t.dwellings++;
        break;
      case StructureKind.house:
        t.dwellings++;
        t.houses++;
        break;
      case StructureKind.granary:
        t.granaries++;
        break;
      case StructureKind.healing_house:
        t.healingHouses++;
        break;
      case StructureKind.mill:
        t.mills++;
        break;
      case StructureKind.record_house:
        t.recordHouses++;
        t.recordedLore |= s.lore;
        if (bits(s.lore) > t.recorded) t.recorded = bits(s.lore);
        break;
    }
    if (holdsGoods(s.kind)) t.stores++;
  }
  return t;
}

/** What each age after the first asks for, from a tally and the world's counters. */
export function needsOf(world: WorldState, t: Tally, age: number): AgeNeed[] {
  const m = world.metrics;
  switch (age) {
    case 1:
      return [
        { key: "fires", have: t.fires, want: 5 },
        { key: "dwellings", have: t.dwellings, want: 8 },
        { key: "stores", have: t.stores, want: 2 },
      ];
    case 2:
      return [
        { key: "field_harvests", have: m.fieldHarvests, want: 3 },
        { key: "fields", have: t.fields, want: 3 },
      ];
    case 3:
      return [
        { key: "houses", have: t.houses, want: 4 },
        { key: "granaries", have: t.granaries, want: 1 },
      ];
    case 4:
      return [
        { key: "mills", have: t.mills, want: 1 },
        { key: "milled", have: m.milled, want: 30 },
        { key: "healing_houses", have: t.healingHouses, want: 1 },
      ];
    case 5:
      return [{ key: "crafts_recorded", have: t.recorded, want: 5 }];
    default:
      return [];
  }
}

const met = (needs: AgeNeed[]): boolean => needs.every((n) => n.have >= n.want);

/** The highest age whose thresholds, and every earlier age's, hold now. */
export function standingAge(world: WorldState, t: Tally = tally(world)): number {
  let age = 0;
  while (age + 1 < AGE_COUNT && met(needsOf(world, t, age + 1))) age++;
  return age;
}

export function readAges(world: WorldState): AgeReading {
  const t = tally(world);
  const ticks = world.metrics.ages.slice();
  ticks[0] = 0;
  let reached = 0;
  for (let i = 1; i < AGE_COUNT; i++) if ((ticks[i] as number) >= 0) reached = i;
  return { reached, standing: standingAge(world, t), ticks, next: reached + 1 < AGE_COUNT ? { age: reached + 1, needs: needsOf(world, t, reached + 1) } : null };
}

/** Each morning (worlds with crafts): note any age reached for the first time, in order, and log it once. */
export function noteAges(world: WorldState, out: EventOut): void {
  const standing = standingAge(world);
  const ages = world.metrics.ages;
  if ((ages[0] as number) < 0) ages[0] = 0;
  for (let i = 1; i <= standing; i++) {
    if ((ages[i] as number) >= 0) continue;
    ages[i] = world.tick;
    emit(world, out, "age", ACTOR_ENV, { q: i, r: AGES[i] as string });
  }
}

/** "Age of Fields": what an age is called on the observer's page. */
export function ageTitle(age: number): string {
  const name = AGES[Math.max(0, Math.min(AGE_COUNT - 1, age))] as string;
  return `Age of ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

const NEED_WORDS: Record<AgeNeed["key"], string> = {
  fires: "fires",
  dwellings: "dwellings",
  stores: "stores",
  field_harvests: "harvests from fields",
  fields: "fields",
  houses: "stone houses",
  granaries: "granaries",
  milled: "roots ground at a mill",
  mills: "mills",
  healing_houses: "healing houses",
  crafts_recorded: "crafts written in one record house",
};

/** "3 of 5 fires": one threshold, as counted. */
export function needText(n: AgeNeed): string {
  return `${Math.min(n.have, n.want)} of ${n.want} ${NEED_WORDS[n.key]}`;
}

export interface Legacy {
  total: number;
  people: number;
  crafts: number;
  works: number;
  ages: number;
}

/** Points per part. Published in the registry; changing them is a new affordance version. */
export const LEGACY_POINTS = {
  person: 10,
  craftKnown: 60,
  craftRecorded: 40,
  age: 150,
  /** Points for one standing work of each kind, and the most of that kind that count. */
  work: { field: [4, 25], granary: [20, 5], house: [15, 20], healingHouse: [40, 2], mill: [60, 2], recordHouse: [60, 1] },
} as const;

/**
 * Legacy: what a people has to show, this morning. People alive; crafts someone living knows,
 * and crafts written down; works standing (each kind counted up to a limit, so that a hundred
 * fields are not a civilisation); ages reached.
 */
export function legacyOf(world: WorldState): Legacy {
  const t = tally(world);
  const P = LEGACY_POINTS;
  const people = t.living * P.person;
  const crafts = bits(t.knownLore) * P.craftKnown + bits(t.recordedLore) * P.craftRecorded;
  const count = (n: number, [points, most]: readonly [number, number]): number => Math.min(n, most) * points;
  const works =
    count(t.fields, P.work.field) + count(t.granaries, P.work.granary) + count(t.houses, P.work.house) + count(t.healingHouses, P.work.healingHouse) + count(t.mills, P.work.mill) + count(t.recordHouses, P.work.recordHouse);
  let reached = 0;
  for (let i = 1; i < AGE_COUNT; i++) if ((world.metrics.ages[i] as number) >= 0) reached++;
  const ages = reached * P.age;
  return { total: people + crafts + works + ages, people, crafts, works, ages };
}
