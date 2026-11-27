/**
 * How the aim on a scenario's card stands, counted from the world itself.
 *
 * Every scenario states one optional aim. Until phase 20 it was only a sentence on a card;
 * nothing ever said how it had gone (the charter said so, in as many words). This reads it off
 * the engine's own state: who is alive and when the others died, the calendar, the scheduled
 * drought, where the shores are. It asks the citizens nothing, tells them nothing and changes
 * nothing; it is the same kind of reading as the almanac. The same reading is made of the
 * untouched twin, which is the point: an aim is something the observer's hand can be measured
 * against.
 *
 * Three kinds of answer: an aim with a day of reckoning is **open** until that day and then
 * **met** or **lost** (and is lost early if too many have died for it to be met); an aim
 * without one (the gap between two shores) is a **reading**, never a verdict.
 *
 * Everything is decided from the state alone, so a world that was saved, opened from a file or
 * returned to in History gives the same answer as one that was watched all the way.
 */
import { AGE_COUNT, TICKS_PER_DAY, ageTitle, calendarAt, commonsHealthPermille, createWorld, needText, readAges, scenarioById, shoreSides, yearLength, type Agent, type WorldState } from "@/engine";
import type { AimPair, AimView, DaySample } from "./protocol";

/** The day a tick falls on, as the game shows days: the first day is day 1. */
const shownDay = (tick: number): number => Math.floor(tick / TICKS_PER_DAY) + 1;

const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
export function ordinal(n: number): string {
  if (n >= 1 && n < ORDINALS.length) return ORDINALS[n] as string;
  const teens = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teens ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/** The people the world began with. Newcomers brought by the observer's hand are not among those an aim counts. */
function founders(world: WorldState): Agent[] {
  return world.agents.filter((a) => a.id < world.config.population);
}

/** How many of `people` had not died before `tick`. */
function aliveBefore(people: readonly Agent[], tick: number): number {
  let n = 0;
  for (const a of people) if (a.diedTick < 0 || a.diedTick >= tick) n++;
  return n;
}

/**
 * The first tick of the first spring that follows a winter: where "the first winter" ends, and
 * for a world that starts in spring, where its first year does.
 */
export function firstWinterEnd(world: WorldState): number {
  const cfg = world.config;
  const limit = 3 * yearLength(cfg);
  for (let d = 1; d <= limit; d++) {
    if (calendarAt(cfg, d * TICKS_PER_DAY).season === 0 && calendarAt(cfg, (d - 1) * TICKS_PER_DAY).season === 3) return d * TICKS_PER_DAY;
  }
  return limit * TICKS_PER_DAY;
}

/**
 * The scenario's own drought: the tick it begins and the tick it ends, and whether it has begun.
 * Null if the scenario schedules none. (Before it begins, when it will is not to be told: the
 * scenario says it comes without warning.)
 */
export function scheduledDrought(world: WorldState): { start: number; end: number; begun: boolean } | null {
  const k = world.config.shocks.findIndex((s) => s.kind === "drought");
  if (k < 0) return null;
  const spec = world.config.shocks[k]!;
  const fired = world.interventions.find((iv) => iv.origin === "scenario" && iv.kind === "drought");
  if (fired) return { start: fired.tick, end: fired.tick + spec.days * TICKS_PER_DAY, begun: true };
  const start = world.shockTicks[k] ?? -1;
  return start >= 0 ? { start, end: start + spec.days * TICKS_PER_DAY, begun: false } : null;
}

interface Reckoning {
  /** The tick at which the aim is decided; null while that is not to be told. */
  horizon: number;
  /** Whether the day of reckoning may be named before it comes. */
  named: boolean;
  /** "the first winter ends", "the year ends", "the drought ends". */
  ends: string;
  /** "saw the winter out", "saw the year out", "saw the drought out". */
  saw: string;
  /** What is said while it is open and its day may not be named. */
  waiting?: string;
}

/** "Keep `num` in `den` of the people who began alive until the horizon." */
function survival(world: WorldState, id: string, text: string, num: number, den: number, r: Reckoning, share: string): AimView {
  const people = founders(world);
  const began = people.length;
  const need = Math.ceil((began * num) / den);
  const spare = began - need;
  const deaths = people
    .filter((a) => a.diedTick >= 0 && a.diedTick < r.horizon)
    .map((a) => a.diedTick)
    .sort((x, y) => x - y);
  const aliveNow = people.filter((a) => a.alive).length;
  if (deaths.length > spare) {
    // the death that left too few
    const at = deaths[spare] as number;
    const lines = [`Lost on day ${shownDay(at)}: the ${ordinal(spare + 1)} death left ${began - spare - 1} of the ${began} who began, and ${share} is ${need}.`];
    if (aliveNow !== began - spare - 1) lines.push(`${aliveNow} are alive now.`);
    return { id, text, state: "lost", decidedDay: shownDay(at), figure: `${aliveNow} of ${began} alive`, lines };
  }
  if (world.tick >= r.horizon) {
    const saw = aliveBefore(people, r.horizon);
    const lines = [`Met on day ${shownDay(r.horizon)}: ${saw} of the ${began} who began ${r.saw}. ${cap(share)} is ${need}.`];
    if (aliveNow !== saw) lines.push(`${aliveNow} are alive now.`);
    return { id, text, state: "met", decidedDay: shownDay(r.horizon), figure: `${saw} of ${began} ${r.saw}`, lines };
  }
  const lines = [`${aliveNow} of the ${began} who began are alive. ${cap(share)} is ${need}.`];
  lines.push(r.named ? `${cap(r.ends)} on the morning of day ${shownDay(r.horizon)}.` : (r.waiting ?? ""));
  return { id, text, state: "open", decidedDay: null, figure: `${aliveNow} of ${began} alive`, lines: lines.filter(Boolean) };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const COUNTS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** "eleven" for 11; the figure itself beyond twelve. */
const ordinalCount = (n: number): string => COUNTS[n] ?? String(n);

/** The commons as the almanac keeps them: how full on average now, and their emptiest morning on record. */
function commonsLine(world: WorldState, series: readonly DaySample[]): string {
  const now = Math.round(commonsHealthPermille(world) / 10);
  let lowest: DaySample | null = null;
  for (const s of series) if (typeof s.commons === "number" && (!lowest || s.commons < lowest.commons)) lowest = s;
  if (!lowest || Math.round(lowest.commons / 10) >= now) return `The groves and fishing waters are ${now}% full on average.`;
  return `The groves and fishing waters are ${now}% full on average; their emptiest morning on record was day ${lowest.day + 1}, at ${Math.round(lowest.commons / 10)}%.`;
}

/** Which shore each founder began on (1 or 2; 0 for neither), from the world as it was first made. One making per world. */
const homes = new Map<string, Uint8Array>();
function homeShores(world: WorldState): Uint8Array | null {
  const sides = shoreSides(world.config, world.terrain);
  if (!sides.shores) return null;
  const key = world.meta.configHash;
  let home = homes.get(key);
  if (!home) {
    const first = createWorld(world.config);
    home = new Uint8Array(first.agents.length);
    for (const a of first.agents) home[a.id] = sides.side[a.y * world.terrain.w + a.x] as number;
    if (homes.size > 8) homes.clear();
    homes.set(key, home);
  }
  return home;
}

/**
 * Well-being on each shore: for the people who began there, the lowest of their four needs, out
 * of 100, averaged — with the dead counted as nought, so that a shore does not look well
 * because its hungry have died.
 */
export function shoreWellBeing(world: WorldState): { a: number; b: number; aliveA: number; aliveB: number; beganA: number; beganB: number } | null {
  const home = homeShores(world);
  if (!home) return null;
  const sum = [0, 0, 0];
  const began = [0, 0, 0];
  const alive = [0, 0, 0];
  for (const a of founders(world)) {
    const side = home[a.id] ?? 0;
    began[side]!++;
    if (!a.alive) continue;
    alive[side]!++;
    sum[side]! += Math.min(a.energy, a.hydration, a.rest, a.warmth);
  }
  const mean = (side: number): number => (began[side] === 0 ? 0 : Math.round(sum[side]! / began[side]! / 10));
  return { a: mean(1), b: mean(2), aliveA: alive[1]!, aliveB: alive[2]!, beganA: began[1]!, beganB: began[2]! };
}

function shores(world: WorldState, id: string, text: string): AimView {
  const w = shoreWellBeing(world);
  if (!w) return { id, text, state: "reading", decidedDay: null, figure: "one shore", lines: ["This island came out with one shore: there is no gap to read."] };
  const gap = Math.abs(w.a - w.b);
  return {
    id,
    text,
    state: "reading",
    decidedDay: null,
    figure: `a gap of ${gap}`,
    lines: [
      `Well-being out of 100, for the people who began on each shore, the dead counted as nought: ${w.a} on the shore short of timber and food (${w.aliveA} of ${w.beganA} alive), ${w.b} on the shore short of stone and clay (${w.aliveB} of ${w.beganB} alive).`,
      `A gap of ${gap}. Whether that is narrow is for the untouched twin to say: this aim has no day of reckoning.`,
    ],
  };
}

/**
 * The Long Road's aim, in numbers: the last age by the end of this year of the island, with
 * this share of the people it began with alive on the morning it is reached (D-058). Set on
 * development seeds with scripted players (`scripts/hands.ts`), so that an island left alone
 * seldom meets it, a hand that only feeds is usually too slow, a hand that only teaches usually
 * loses too many, and a hand that reads the island and does both usually meets it.
 */
export const ROAD_AIM = { num: 4, den: 5, years: 5 } as const;

/**
 * "Bring four in five of the first fifty to the last age by the end of the fifth year."
 *
 * Met on the morning the last age is reached, if that is within the years allowed and enough of
 * the people the island began with are alive that morning. Lost on the day one founder too
 * many has died before then, or on the morning after the last year allowed if the age has not
 * come. Newcomers neither help nor hurt: the aim is about the people who were there on the
 * first morning. Everything is read from the state alone — who died when, and the tick each
 * age was first reached — so a saved world answers as a watched one does.
 */
function lastAgeInTime(world: WorldState, id: string, text: string): AimView {
  const { num, den, years } = ROAD_AIM;
  const people = founders(world);
  const began = people.length;
  const need = Math.ceil((began * num) / den);
  const spare = began - need;
  const share = "four in five";
  const last = AGE_COUNT - 1;
  const ages = readAges(world);
  const yearDays = yearLength(world.config);
  /** The first tick after the last day allowed. */
  const deadline = years * yearDays * TICKS_PER_DAY;
  const reached = world.metrics.ages[last] as number;
  const inTime = reached >= 0 && reached < deadline;
  // deaths count up to the morning that decides it: the age's morning if it came in time, else the deadline
  const horizon = inTime ? reached : deadline;
  const deaths = people
    .filter((a) => a.diedTick >= 0 && a.diedTick < horizon)
    .map((a) => a.diedTick)
    .sort((x, y) => x - y);
  const aliveNow = people.filter((a) => a.alive).length;
  const stands = `${ageTitle(ages.reached)}${ages.reached > 0 ? `, reached on day ${shownDay(ages.ticks[ages.reached] as number)}` : ""}`;
  const lastDay = years * yearDays;
  if (deaths.length > spare) {
    const at = deaths[spare] as number;
    const lines = [`Lost on day ${shownDay(at)}: the ${ordinal(spare + 1)} death left ${began - spare - 1} of the ${began} who began, and ${share} is ${need}. They had come as far as the ${stands}.`];
    // what they died of is the plainest thing this reading can say about why (the engine records it with each death)
    const lost = people.filter((a) => a.diedTick >= 0 && a.diedTick <= at);
    lines.push(`Those ${lost.length === spare + 1 ? ordinalCount(spare + 1) : lost.length} died: ${causesOf(lost)}.`);
    if (aliveNow !== began - spare - 1) lines.push(`${aliveNow} of them are alive now.`);
    return { id, text, state: "lost", decidedDay: shownDay(at), figure: `${aliveNow} of ${began} alive`, lines };
  }
  if (inTime) {
    const saw = aliveBefore(people, reached);
    const year = Math.floor(reached / (yearDays * TICKS_PER_DAY)) + 1;
    const lines = [`Met on day ${shownDay(reached)}: the ${ageTitle(last)} was reached in the ${ordinal(year)} year, with ${saw} of the ${began} who began alive. ${cap(share)} is ${need}; the ${ordinal(years)} year ends with day ${lastDay}.`];
    if (aliveNow !== saw) lines.push(`${aliveNow} of them are alive now.`);
    return { id, text, state: "met", decidedDay: shownDay(reached), figure: `${saw} of ${began} · day ${shownDay(reached)}`, lines };
  }
  if (world.tick >= deadline) {
    const lines = [`Lost on day ${shownDay(deadline)}: the ${ordinal(years)} year ended and they stood in the ${ageTitle(readAgeAt(world, deadline))}.${reached >= 0 ? ` The ${ageTitle(last)} came on day ${shownDay(reached)}, too late.` : ""}`];
    lines.push(`${aliveNow} of the ${began} who began are alive now.`);
    return { id, text, state: "lost", decidedDay: shownDay(deadline), figure: `${ageTitle(ages.reached)} · ${aliveNow} of ${began}`, lines };
  }
  const year = Math.floor(world.tick / (yearDays * TICKS_PER_DAY)) + 1;
  const left = lastDay - Math.floor(world.tick / TICKS_PER_DAY);
  const lines = [`They stand in the ${stands}.`];
  if (ages.next) lines.push(`The ${ageTitle(ages.next.age)} asks for ${ages.next.needs.map(needText).join(", ")}.`);
  lines.push(`${aliveNow} of the ${began} who began are alive. ${cap(share)} is ${need}${deaths.length > 0 ? `: ${spare - deaths.length === 0 ? "one more death loses it" : `${spare - deaths.length} more can be lost`}` : ""}.`);
  lines.push(`It is year ${year} of ${years}: the ${ordinal(years)} year ends with day ${lastDay}, ${left === 1 ? "1 day" : `${left} days`} from this morning.`);
  return { id, text, state: "open", decidedDay: null, figure: `${aliveNow} of ${began} · year ${year} of ${years}`, lines };
}

/**
 * What a group of the dead died of, most often first: "9 of hunger, 1 of cold and 1 of
 * thirst". The engine records one cause with each death; this only counts them.
 */
export function causesOf(dead: readonly Agent[]): string {
  const counts = new Map<string, number>();
  for (const a of dead) counts.set(a.deathCause || "unknown", (counts.get(a.deathCause || "unknown") ?? 0) + 1);
  const parts = [...counts.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([cause, n]) => `${n} of ${cause === "unknown" ? "causes not recorded" : cause}`);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The highest age that had been reached by a tick (from the ticks each was first reached at). */
function readAgeAt(world: WorldState, tick: number): number {
  let age = 0;
  for (let i = 1; i < AGE_COUNT; i++) {
    const t = world.metrics.ages[i] as number;
    if (t >= 0 && t < tick) age = i;
  }
  return age;
}

/** How the aim of this world's scenario stands. Null for a scenario with no aim this reader knows. */
export function readAim(world: WorldState, series: readonly DaySample[]): AimView | null {
  let objective: { id: string; text: string };
  try {
    objective = scenarioById(world.config.scenario).objective;
  } catch {
    return null;
  }
  const { id, text } = objective;
  switch (id) {
    case "winter_80":
      return survival(world, id, text, 4, 5, { horizon: firstWinterEnd(world), named: true, ends: "the first winter ends", saw: "saw the winter out" }, "four in five");
    case "spring_60":
      return survival(world, id, text, 3, 5, { horizon: firstWinterEnd(world), named: true, ends: "spring comes", saw: "saw the spring" }, "three in five");
    case "year_80": {
      const view = survival(world, id, text, 4, 5, { horizon: yearLength(world.config) * TICKS_PER_DAY, named: true, ends: "the year ends", saw: "saw the year out" }, "four in five");
      view.lines.push(commonsLine(world, series));
      return view;
    }
    case "drought_80": {
      const d = scheduledDrought(world);
      if (!d) return null;
      const view = survival(
        world,
        id,
        text,
        4,
        5,
        { horizon: d.end, named: false, ends: "the drought ends", saw: "saw the drought out", waiting: d.begun ? `The drought began on day ${shownDay(d.start)} and has not ended.` : "The drought has not come yet." },
        "four in five",
      );
      return view;
    }
    case "shores_gap":
      return shores(world, id, text);
    case "letters_in_time":
      return lastAgeInTime(world, id, text);
    default:
      return null;
  }
}

export function readAims(world: WorldState, series: readonly DaySample[], twin: WorldState | null, twinSeries: readonly DaySample[]): AimPair {
  return { yours: readAim(world, series), twin: twin ? readAim(twin, twinSeries) : null };
}
