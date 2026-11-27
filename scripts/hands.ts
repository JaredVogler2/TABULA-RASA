/**
 * What is a hand worth? The same islands, lived again under scripted "players" of different
 * skill, each allowed what the scenario allows the observer (so many changes a season), and
 * each seeing only what the observer's own pages show: the season, how many are alive, the
 * age and what the next one asks for, who knows which craft, what is written down.
 *
 *   pnpm exec tsx scripts/hands.ts --seeds 1-12 --years 10 [--scenario long_road]
 *                                  [--players none,bounty,savvy] [--per-season 1] [--stop-at-aim | --stop-at-letters]
 *                                  [--bank 3] (changes can be saved up, to this many)
 *                                  [--rest 4] (a kind of change rests this many seasons after use)
 *                                  [--json out.json] [--set key=value ...]
 *
 * A game has room for skill when three things hold at once: an island left alone usually
 * fails, a hand used without thought does little better, and a hand used with thought does
 * much better. This script measures all three, against the aim on the scenario's card as the
 * game itself reads it. It cannot say whether a person enjoys it.
 *
 * The players, from no skill to some:
 *   none       never touches the island (the untouched twin of every other row)
 *   random     one change a season, drawn by lot from everything on offer
 *   bounty     the obvious kindness: restores wild food on the first morning of every season
 *   newcomers  five strangers every season: tries to buy the head-count
 *   strangers  each season, someone who knows the first craft on the ladder nobody living knows
 *   savvy      reads the pages: brings the craft the next age is waiting for, then a second
 *              knower for a craft held by one person and not written down, fills the larders
 *              before winter, and makes up the number once the last age is reached
 *   scholar    as savvy, and knows the ladder: asks for the crafts that bring others with them
 *   balanced   the scholar's asks in spring and summer, food in autumn and winter
 *   steward    as scholar, but keeps the hand for when it is needed (differs only where changes can be saved up)
 *   saboteur   blight in the growing seasons, a cold snap in the others
 *
 * A change is applied exactly as the game's worker applies the observer's (`applyIntervention`,
 * origin "observer"), on the same seed and luck. Development seeds only (1–999). It costs
 * nothing: no mind here is a model.
 */
import { writeFileSync } from "node:fs";
import { AGES, CRAFT_COUNT, CRAFT_SPECS, TICKS_PER_DAY, applyIntervention, calendarAt, createWorld, makeConfig, scenarioById, scratchOf, step, type SimEvent, type WorldConfig, type WorldState } from "../src/engine";
import { legacyOf, readAges, tally, type AgeNeed } from "../src/engine/metrics/ages";
import { readAim } from "../src/worker/aims";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

function seedsOf(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let s = a as number; s <= (b ?? (a as number)); s++) out.push(s);
  }
  return out;
}

function overrides(): Partial<WorldConfig> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== "--set") continue;
    const kv = process.argv[i + 1] ?? "";
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const raw = kv.slice(eq + 1);
    out[kv.slice(0, eq)] = raw === "true" ? true : raw === "false" ? false : /^-?\d+$/.test(raw) ? Number(raw) : raw;
  }
  return out as Partial<WorldConfig>;
}

/** What a player may look at: nothing here is hidden from the observer in the game. */
export interface Reading {
  day: number;
  /** 0 spring, 1 summer, 2 autumn, 3 winter. */
  season: number;
  year: number;
  /** True on the first morning of a season. */
  turned: boolean;
  living: number;
  began: number;
  /** How many were alive on the first morning of this season. */
  seasonBegan: number;
  /** Changes this player has made this season that were of food (a bounty or a windfall). */
  fed: number;
  reached: number;
  next: { age: number; needs: AgeNeed[] } | null;
  /** Living people who know each craft. */
  knowers: number[];
  /** Crafts written in any record house, one bit each. */
  written: number;
  /** A number in [0, 1) from the player's own lot (never from the world's luck). */
  lot: () => number;
}

export interface Move {
  kind: string;
  params: Record<string, number>;
}

/**
 * What a player would do this morning, most wanted first. The rules of the hand decide which
 * of them is allowed (a kind of change may be resting); the first allowed one is made. An empty
 * list is "nothing today".
 */
export type Player = (r: Reading) => Move[];

const BOUNTY: Move = { kind: "bounty", params: { magnitude: 1000 } };
const BLIGHT: Move = { kind: "blight", params: { magnitude: 1000 } };
const COLD: Move = { kind: "cold_snap", params: { days: 3, magnitude: 1000 } };
const NEWCOMERS: Move = { kind: "newcomers", params: { count: 5 } };
const stranger = (craft: number): Move => ({ kind: "stranger", params: { craft } });

/** Everything on the Intervene panel of a world with crafts, with the panel's own parameters. */
const OFFERED: Move[] = [
  COLD,
  { kind: "drought", params: { days: 6, magnitude: 1000 } },
  BLIGHT,
  { kind: "rain", params: { days: 2, magnitude: 1000 } },
  BOUNTY,
  { kind: "windfall", params: { magnitude: 1000 } },
  NEWCOMERS,
  { kind: "hush", params: { days: 4, radius: 1 } },
  stranger(-1),
];

/** The first craft, in the ladder's order, that nobody living knows; -1 if every craft has a knower. */
function missing(r: Reading): number {
  for (let c = 0; c < CRAFT_COUNT; c++) if ((r.knowers[c] as number) === 0) return c;
  return -1;
}

const WINDFALL: Move = { kind: "windfall", params: { magnitude: 1000 } };
const RAIN: Move = { kind: "rain", params: { days: 2, magnitude: 1000 } };

/** What a reader of the pages asks for, in order: the knowledge the ladder is waiting for, then people, then food. */
function thoughtful(r: Reading, tree: boolean): Move[] {
  const want: Move[] = [];
  const k = r.knowers as [number, number, number, number, number, number];
  if (tree) {
    // knows the ladder: a millwright also knows tillage and masonry, a record keeper also storekeeping and
    // masonry — so three strangers bring all six crafts, where one by one takes six
    if (k[4] === 0 && (k[0] === 0 || k[2] === 0)) want.push(stranger(4));
    if (k[5] === 0 && (k[1] === 0 || k[2] === 0)) want.push(stranger(5));
  }
  // a craft nobody knows: the ladder cannot be climbed past it
  const none = missing(r);
  if (none >= 0) want.push(stranger(none));
  // a craft that would die with one person, and is not written down
  for (let c = 0; c < CRAFT_COUNT; c++) if ((r.knowers[c] as number) === 1 && (r.written & (1 << c)) === 0) want.push(stranger(c));
  // the last age is reached and the number is wanting: bring people while there is a growing season to feed them
  if (r.reached === AGES.length - 1 && r.living < r.began && r.season <= 1) want.push(NEWCOMERS);
  // otherwise food — the whole island's first, one beach's if that is resting
  want.push(BOUNTY, WINDFALL);
  return want;
}

export const PLAYERS: Record<string, Player> = {
  none: () => [],
  random: (r) => {
    if (!r.turned) return [];
    // a lot drawn for every kind, so that a resting kind gives way to the next by lot, not by order
    return OFFERED.map((m) => ({ m, at: r.lot() })).sort((a, b) => a.at - b.at).map((x) => x.m);
  },
  bounty: (r) => (r.turned ? [BOUNTY, WINDFALL] : []),
  newcomers: (r) => (r.turned ? [NEWCOMERS] : []),
  strangers: (r) => (r.turned ? [stranger(missing(r))] : []),
  savvy: (r) => (r.turned ? thoughtful(r, false) : []),
  scholar: (r) => (r.turned ? thoughtful(r, true) : []),
  /**
   * Knowledge in the growing seasons, food before and through the winter: the scholar's asks in
   * spring and summer, a bounty (or, if that is resting, a windfall) in autumn and winter.
   */
  balanced: (r) => (!r.turned ? [] : r.season >= 2 ? [BOUNTY, WINDFALL] : thoughtful(r, true)),
  /**
   * As the scholar, but keeps the hand for when it is needed (only different where a change can
   * be saved up): spends at once on knowledge, and on food only before winter or when people
   * are dying — a tenth fewer alive than at the start of the season.
   */
  steward: (r) => {
    const want = thoughtful(r, true);
    const food = (m: Move): boolean => m.kind === "bounty" || m.kind === "windfall";
    const urgent = r.fed === 0 && (r.season === 2 || r.living * 10 <= r.seasonBegan * 9);
    return want.filter((m) => !food(m) || urgent);
  },
  saboteur: (r) => (r.turned ? (r.season <= 1 ? [BLIGHT, COLD] : [COLD, BLIGHT]) : []),
};

void RAIN;

export interface HandRun {
  scenario: string;
  seed: number;
  player: string;
  /**
   * How the aim on the scenario's card came out, as the game itself reads it (`src/worker/aims.ts`):
   * met or lost, and the day (counted from 0) it was decided; "open" if the run ended first.
   */
  aim: { state: "met" | "lost" | "open" | "reading"; day: number };
  /**
   * The first day the last age had been reached with no fewer alive than began (-1 = never): The
   * Long Road's aim as first written (D-056), kept because the first measurements were of it.
   * (In the files of 2026-11-27 this is the field `aimDay`.)
   */
  wholeDay: number;
  /** The day each age was first reached (-1 = never); index 0 is day 0. */
  ageDays: number[];
  /** Legacy at the end of each year. */
  legacy: number[];
  /** Living at the end of each year. */
  living: number[];
  fewest: number;
  people: number;
  moves: { day: number; kind: string; craft?: number }[];
  /** True if the run was ended early, on the morning the aim was met or the last age reached (its yearly figures then stop there). */
  stopped: boolean;
  /** The day each of the founders who died, died — in order. (Founders: the people the island began with.) */
  founderDeaths: number[];
  /** How many were alive, and how many of them founders, on the morning the last age was reached (-1 = never). */
  livingAtLetters: number;
  foundersAtLetters: number;
  seconds: number;
}

/** A small generator for a player's own lot: the world's luck is never touched by it. */
function lotOf(seed: number, salt: number): () => number {
  let x = (seed * 2654435761 + salt * 40503 + 12345) >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

function readingOf(world: WorldState, turned: boolean, seasonBegan: number, fed: number, lot: () => number): Reading {
  const cfg = world.config;
  const cal = calendarAt(cfg, world.tick);
  const t = tally(world);
  const ages = readAges(world);
  const knowers = new Array<number>(CRAFT_COUNT).fill(0);
  for (const a of world.agents) {
    if (!a.alive || a.lore === 0) continue;
    for (let c = 0; c < CRAFT_COUNT; c++) if (a.lore & (1 << c)) knowers[c] = (knowers[c] as number) + 1;
  }
  return { day: Math.floor(world.tick / TICKS_PER_DAY), season: cal.season, year: cal.year, turned, living: t.living, began: cfg.population, seasonBegan, fed, reached: ages.reached, next: ages.next, knowers, written: t.recordedLore, lot };
}

/**
 * `stopAtAim`: end the run on the morning the aim is met. A thriving island is the slowest
 * thing here to step (a hundred and twenty-five people), and how often and how soon the aim is
 * met is known by then; what such an island is worth at the end of the tenth year is not.
 */
/** The rules of the observer's hand that this script can try (the game has the first; the others are proposals). */
export interface HandRules {
  /** Changes earned each season. */
  perSeason: number;
  /** The most that can be held: equal to `perSeason` if nothing can be saved up. */
  bank: number;
  /** Seasons a kind of change rests after it is used (0 = none; 4 = once a year each). */
  rest: number;
}

export function play(scenario: string, seed: number, years: number, over: Partial<WorldConfig>, name: string, rules: HandRules | number, stopAt: false | true | "aim" | "letters" = false): HandRun {
  const stopAtAim = stopAt === true || stopAt === "aim";
  const stopAtLetters = stopAt === "letters";
  const hand: HandRules = typeof rules === "number" ? { perSeason: rules, bank: rules, rest: 0 } : rules;
  const player = PLAYERS[name];
  if (!player) throw new Error(`no such player: ${name}`);
  const cfg = makeConfig(scenario, seed, over);
  const world = createWorld(cfg);
  const yearDays = cfg.seasonDays.reduce((a, b) => a + b, 0);
  const out: SimEvent[] = [];
  const lot = lotOf(seed, name.length * 7 + name.charCodeAt(0));
  const moves: HandRun["moves"] = [];
  const legacy: number[] = [];
  const living: number[] = [];
  let wholeDay = -1;
  let aim: HandRun["aim"] = { state: "open", day: -1 };
  let fewest = cfg.population;
  let seasonKey = -1;
  let held = 0;
  let seasonBegan = cfg.population;
  let fed = 0;
  /** The season in which each kind of change was last made. */
  const lastUse = new Map<string, number>();
  const started = Date.now();
  let livingAtLetters = -1;
  let foundersAtLetters = -1;
  const done = (): boolean => (stopAtAim && aim.state === "met") || (stopAtLetters && livingAtLetters >= 0);
  for (let y = 0; y < years && !done(); y++) {
    for (let t = 0; t < yearDays * TICKS_PER_DAY; t++) {
      if (done()) break;
      if (world.tick % TICKS_PER_DAY === 0) {
        const cal = calendarAt(cfg, world.tick);
        const key = cal.year * 4 + cal.season;
        const turned = key !== seasonKey;
        let alive = 0;
        for (const a of world.agents) if (a.alive) alive++;
        if (turned) {
          seasonKey = key;
          held = Math.min(hand.bank, held + hand.perSeason);
          seasonBegan = alive;
          fed = 0;
        }
        if (alive < fewest) fewest = alive;
        if (livingAtLetters < 0 && (world.metrics.ages[AGES.length - 1] as number) >= 0) {
          livingAtLetters = alive;
          foundersAtLetters = 0;
          for (let i = 0; i < cfg.population; i++) if (world.agents[i]!.alive) foundersAtLetters++;
        }
        if (wholeDay < 0 && (world.metrics.ages[AGES.length - 1] as number) >= 0 && alive >= cfg.population) wholeDay = Math.floor(world.tick / TICKS_PER_DAY);
        if (aim.state === "open") {
          const now = readAim(world, []);
          if (now && (now.state === "met" || now.state === "lost")) aim = { state: now.state, day: (now.decidedDay ?? 1) - 1 };
          else if (now && now.state === "reading") aim = { state: "reading", day: -1 };
        }
        if (alive > 0 && held > 0) {
          const wanted = player(readingOf(world, turned, seasonBegan, fed, lot));
          const move = wanted.find((m) => hand.rest <= 0 || !lastUse.has(m.kind) || key - (lastUse.get(m.kind) as number) >= hand.rest);
          if (move) {
            // a stranger asked for with no craft named brings what the engine picks; a named one brings that
            const params = move.kind === "stranger" && (move.params.craft as number) < 0 ? {} : { ...move.params };
            applyIntervention(world, scratchOf(world), out, { tick: world.tick, kind: move.kind as never, params, origin: "observer" });
            held--;
            if (move.kind === "bounty" || move.kind === "windfall") fed++;
            lastUse.set(move.kind, key);
            moves.push({ day: Math.floor(world.tick / TICKS_PER_DAY), kind: move.kind, ...(move.kind === "stranger" ? { craft: move.params.craft as number } : {}) });
            out.length = 0;
          }
        }
      }
      step(world, out);
      out.length = 0;
    }
    legacy.push(legacyOf(world).total);
    let alive = 0;
    for (const a of world.agents) if (a.alive) alive++;
    living.push(alive);
    if (alive === 0) break;
  }
  return {
    scenario,
    seed,
    player: name,
    aim,
    wholeDay,
    ageDays: world.metrics.ages.map((tick) => (tick < 0 ? -1 : Math.floor(tick / TICKS_PER_DAY))),
    legacy,
    living,
    fewest,
    people: world.agents.length,
    moves,
    stopped: done(),
    founderDeaths: world.agents
      .slice(0, cfg.population)
      .filter((a) => !a.alive)
      .map((a) => Math.floor(a.diedTick / TICKS_PER_DAY))
      .sort((a, b) => a - b),
    livingAtLetters,
    foundersAtLetters,
    seconds: (Date.now() - started) / 1000,
  };
}

const median = (xs: number[]): number => {
  if (!xs.length) return Number.NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
};

/** One line a player: how the card's aim came out, when, and how it compares with the untouched island. */
export function summarize(runs: HandRun[]): string[] {
  const players = [...new Set(runs.map((r) => r.player))];
  const seeds = [...new Set(runs.map((r) => r.seed))];
  const of = (p: string, s: number): HandRun | undefined => runs.find((r) => r.player === p && r.seed === s);
  const letters = (r: HandRun): number => r.ageDays[AGES.length - 1] as number;
  const lines: string[] = [];
  lines.push(`${"player".padEnd(10)} aim met   median day  lost by deaths  lost by time   last age reached  median day  founders then  turned  changes made`);
  for (const p of players) {
    const mine = seeds.map((s) => of(p, s)).filter((r): r is HandRun => !!r);
    const met = mine.filter((r) => r.aim.state === "met");
    const lost = mine.filter((r) => r.aim.state === "lost");
    // lost by deaths: decided before the last age came (or it never came) and before the run's own end by the calendar
    const byDeaths = lost.filter((r) => r.founderDeaths.length > 0 && r.founderDeaths.some((d) => d === r.aim.day));
    const reached = mine.filter((r) => letters(r) >= 0);
    let won = 0;
    let undone = 0;
    for (const s of seeds) {
      const a = of(p, s);
      const b = of("none", s);
      if (!a || !b) continue;
      if (a.aim.state === "met" && b.aim.state !== "met") won++;
      if (a.aim.state !== "met" && b.aim.state === "met") undone++;
    }
    lines.push(
      `${p.padEnd(10)} ${`${met.length} of ${mine.length}`.padEnd(9)} ${(met.length ? median(met.map((r) => r.aim.day + 1)).toFixed(0) : "—").padStart(10)}  ${String(byDeaths.length).padStart(14)}  ${String(lost.length - byDeaths.length).padStart(12)}   ${`${reached.length} of ${mine.length}`.padStart(16)}  ${(reached.length ? median(reached.map((r) => letters(r) + 1)).toFixed(0) : "—").padStart(10)}  ${(reached.length ? median(reached.map((r) => r.foundersAtLetters)).toFixed(0) : "—").padStart(13)}  ${(p === "none" ? "" : `+${won} −${undone}`).padEnd(7)} ${median(mine.map((r) => r.moves.length)).toFixed(0)}`,
    );
  }
  return lines;
}

function main(): void {
  const scenario = arg("scenario", "long_road");
  const seeds = seedsOf(arg("seeds", "1-4"));
  if (seeds.some((s) => s < 1 || s > 999)) throw new Error("development seeds only (1–999)");
  const years = Number(arg("years", "10"));
  const names = arg("players", Object.keys(PLAYERS).join(",")).split(",");
  const over = overrides();
  const cfg = makeConfig(scenario, seeds[0] as number, over);
  const perSeason = Number(arg("per-season", String(cfg.changesPerSeason > 0 ? cfg.changesPerSeason : 1)));
  const rules: HandRules = { perSeason, bank: Math.max(perSeason, Number(arg("bank", String(perSeason)))), rest: Number(arg("rest", "0")) };
  const runs: HandRun[] = [];
  const file = arg("json", "");
  for (const seed of seeds) {
    for (const name of names) {
      const r = play(scenario, seed, years, over, name, rules, process.argv.includes("--stop-at-letters") ? "letters" : process.argv.includes("--stop-at-aim") ? "aim" : false);
      runs.push(r);
      const strangers = r.moves.filter((m) => m.kind === "stranger").length;
      console.log(
        `${scenario} seed ${String(seed).padStart(3)} ${name.padEnd(10)} aim ${(r.aim.state === "met" ? `met day ${r.aim.day + 1}` : r.aim.state === "lost" ? `lost day ${r.aim.day + 1}` : r.aim.state).padEnd(12)} ages ${r.ageDays.slice(1).join("/").padEnd(22)} alive ${String(r.living[r.living.length - 1] ?? "…").padStart(3)} of ${String(r.people).padStart(3)} fewest ${String(r.fewest).padStart(2)} founders lost ${String(r.founderDeaths.length).padStart(2)}${r.foundersAtLetters >= 0 ? ` (${r.foundersAtLetters} alive at letters)` : ""} legacy ${String(r.legacy[r.legacy.length - 1] ?? "…").padStart(5)} moves ${r.moves.length}${strangers ? ` (${strangers} strangers)` : ""} ${r.seconds.toFixed(0)} s`,
      );
      if (file) writeFileSync(file, `${JSON.stringify({ scenario, years, rules, overrides: over, runs }, null, 1)}\n`);
    }
  }
  console.log(`\n${scenario}, ${seeds.length} islands (seeds ${arg("seeds", "1-4")}), ${years} years, ${perSeason} change${perSeason === 1 ? "" : "s"} a season${rules.bank > perSeason ? `, up to ${rules.bank} held` : ""}${rules.rest > 0 ? `, each kind resting ${rules.rest} seasons after use` : ""}${Object.keys(over).length ? `, with ${JSON.stringify(over)}` : ""}:`);
  const objective = scenarioById(scenario).objective.text;
  console.log(`The aim on the card, as the game reads it: "${objective}"`);
  for (const line of summarize(runs)) console.log(line);
  console.log(`\nDays are as the game shows them (the first day is day 1). "turned": islands where this player met the aim and the untouched island did not (+), and the other way about (−).`);
  console.log(`To score other aims of the same kind from the same runs (more or fewer founders, another year): scripts/hands-aims.ts on the --json file.`);
  // CRAFT_SPECS is named so that a reader of this file can find what the ladder is made of
  void CRAFT_SPECS;
}

if (process.argv[1] && process.argv[1].endsWith("hands.ts")) main();
