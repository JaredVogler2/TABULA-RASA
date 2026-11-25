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
import { TICKS_PER_DAY, calendarAt, commonsHealthPermille, createWorld, scenarioById, shoreSides, yearLength, type Agent, type WorldState } from "@/engine";
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
    default:
      return null;
  }
}

export function readAims(world: WorldState, series: readonly DaySample[], twin: WorldState | null, twinSeries: readonly DaySample[]): AimPair {
  return { yours: readAim(world, series), twin: twin ? readAim(twin, twinSeries) : null };
}
