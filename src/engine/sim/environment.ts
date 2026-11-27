/**
 * The environment's own dynamics: regrowth, die-back and collapse of renewable
 * resources, spoilage, fires burning down, structures weathering, paths fading,
 * scheduled shocks and observer interventions. All stochastic rounding uses keyed
 * draws, so expected values are exact and results are reproducible.
 */
import { clampInt } from "../core/math";
import { Stream, below, chance, stochasticDiv, u32 } from "../core/rng";
import type { ShockKind } from "../model/config";
import {
  Biome,
  CRAFT_COUNT,
  CRAFT_SPECS,
  FOOD_ITEMS,
  ITEM_COUNT,
  ITEM_SPECS,
  Item,
  NODE_SPECS,
  NodeKind,
  StructureKind,
  TICKS_PER_DAY,
  Water,
  Weather,
} from "../model/constants";
import { ACTOR_ENV, ACTOR_OBSERVER, type Intervention, type WorldState } from "../model/types";
import { calendarAt, droughtActive } from "../world/climate";
import { agentCapacity, createAgent, spawnTiles } from "../world/population";
import { noteAges } from "../metrics/ages";
import { emit, type EventOut } from "./events";
import { dropOnGround, pruneEmptyPiles, sink, source } from "./inventory";
import type { Scratch } from "./scratch";
import { dailyWear, dailyWorks, drawNewcomers, holdsGoods, spoilFactor } from "./works";

const DROUGHT_SENSITIVE = new Set<number>([NodeKind.berry_bush, NodeKind.root_patch, NodeKind.reed_bed]);

/** Daily growth, die-back and re-seeding of every renewable node. */
function regrow(world: WorldState, out: EventOut, day: number, season: number): void {
  const cfg = world.config;
  const nodes = world.nodes;
  const epoch = world.meta.branch.rngEpoch;
  const drought = droughtActive(world);
  for (let n = 0; n < nodes.count; n++) {
    const kind = nodes.kind[n] as number;
    const spec = NODE_SPECS[kind]!;
    if (!spec.renewable) continue;
    const K = nodes.cap[n] as number;
    let A = nodes.amount[n] as number;
    const before = A;
    let rate = Math.round((spec.growth[season as 0 | 1 | 2 | 3] * cfg.regrowth) / 1000);
    if (drought && DROUGHT_SENSITIVE.has(kind)) rate = 0;
    if (A === 0 && spec.base === 0) {
      if (rate > 0 && chance(spec.reseed, 1000, cfg.seed, Stream.Regrowth, day, n, epoch, 1)) A = 1;
    } else if (rate > 0 && A < K) {
      if (spec.collapseBelow > 0 && cfg.collapse > 0) {
        const threshold = (K * spec.collapseBelow * cfg.collapse) / 1_000_000;
        if (A < threshold) rate = Math.round((rate * spec.collapseFactor) / 1000);
      }
      // growth: rate · (A + base·K) · (1 − A/K), with exact expectation via stochastic rounding.
      // With base = 0 this is logistic growth, which stops at zero stock.
      A += stochasticDiv(rate * (1000 * A + spec.base * K) * (K - A), 1_000_000 * K, cfg.seed, Stream.Regrowth, day, n, epoch, 2);
      if (A > K) A = K;
    }
    if (season === 3 && spec.winterLoss > 0 && A > 0) {
      // die-back stops at the dormant reserve: the plant outlives its fruit
      const reserve = Math.ceil((K * spec.dormant) / 1000);
      if (A > reserve) {
        A -= stochasticDiv(A * spec.winterLoss, 1000, cfg.seed, Stream.Regrowth, day, n, epoch, 3);
        if (A < reserve) A = reserve;
      }
    }
    if (drought && kind === NodeKind.berry_bush && A > 0) {
      A -= stochasticDiv(A * 120, 1000, cfg.seed, Stream.Regrowth, day, n, epoch, 4);
    }
    if (A < 0) A = 0;
    if (A !== before) {
      nodes.amount[n] = A;
      if (before === 0 && A > 0) emit(world, out, "recovered", ACTOR_ENV, { n });
    }
  }
}

/** Units of `qty` lost to spoilage today at `rate` permille. */
function spoiled(world: WorldState, qty: number, rate: number, day: number, holder: number, item: number): number {
  if (qty <= 0 || rate <= 0) return 0;
  return stochasticDiv(qty * rate, 1000, world.config.seed, Stream.Spoilage, day, holder, item, world.meta.branch.rngEpoch);
}

function spoilInventory(world: WorldState, inv: number[], factor: number, day: number, holderKey: number): number {
  const cfg = world.config;
  const cold = world.climate.temp < 50 ? 500 : 1000;
  let lostWorth = 0;
  for (const item of FOOD_ITEMS) {
    const q = inv[item] as number;
    if (q <= 0) continue;
    const rate = Math.round((((ITEM_SPECS[item]!.spoil * cfg.spoilage) / 1000) * factor * cold) / 1_000_000);
    const lost = Math.min(q, spoiled(world, q, rate, day, holderKey, item));
    if (lost > 0) {
      inv[item] = q - lost;
      sink(world, item, lost);
      lostWorth += lost * ITEM_SPECS[item]!.worth;
    }
  }
  return lostWorth;
}

function dailyUpkeep(world: WorldState, sc: Scratch, out: EventOut, day: number, season: number): void {
  const cfg = world.config;
  regrow(world, out, day, season);

  // spoilage: carried goods, ground piles (exposed), stores (protected)
  for (const a of world.agents) {
    if (!a.alive) continue;
    const lost = spoilInventory(world, a.inv, 1000, day, a.id);
    if (lost > 0) emit(world, out, "spoil", a.id, { q: lost });
  }
  for (let k = 0; k < world.piles.length; k++) {
    const p = world.piles[k]!;
    spoilInventory(world, p.inv, 1500, day, 100_000 + p.y * sc.w + p.x);
  }
  pruneEmptyPiles(world, sc);
  for (const s of world.structures) {
    if (s.removed || !s.complete) continue;
    if (holdsGoods(s.kind)) {
      const lost = spoilInventory(world, s.inv, spoilFactor(s.kind), day, 200_000 + s.id);
      if (lost > 0) emit(world, out, "spoil", ACTOR_ENV, { s: s.id, q: lost });
    }
    // weathering
    const wear = dailyWear(s.kind);
    if (wear > 0) {
      s.integrity -= wear + (world.climate.weather === Weather.storm ? 12 : 0);
      if (s.integrity <= 0) {
        for (let i = 0; i < ITEM_COUNT; i++) {
          const q = s.inv[i] as number;
          if (q > 0) {
            dropOnGround(world, sc, s.x, s.y, i, q);
            s.inv[i] = 0;
          }
        }
        s.removed = true;
        sc.structDirty = true;
        emit(world, out, "collapse", ACTOR_ENV, { s: s.id, x: s.x, y: s.y });
      }
    }
    // plots and fields do not grow in winter or during a drought
    if ((s.kind === StructureKind.plot || s.kind === StructureKind.field) && s.ripeTick >= 0 && world.tick < s.ripeTick && (season === 3 || droughtActive(world))) {
      s.ripeTick += TICKS_PER_DAY;
    }
  }

  // the rules added in engine 0.8.0, each behind its own switch
  if (cfg.crafts) dailyWorks(world, sc, out, day);
  if (cfg.arrivals) drawNewcomers(world, sc, out, day, season);
  if (cfg.crafts) noteAges(world, out);

  // footpaths fade unless they keep being walked
  const traffic = world.traffic;
  for (let i = 0; i < traffic.length; i++) {
    const t = traffic[i] as number;
    if (t > 0) traffic[i] = t - Math.ceil(t / 12);
  }
}

/** Apply a shock (scheduled by the scenario) or an intervention (made by the observer). */
export function applyIntervention(world: WorldState, sc: Scratch, out: EventOut, iv: Intervention): void {
  const cfg = world.config;
  const kind = iv.kind as ShockKind;
  const days = clampInt(iv.params.days ?? 5, 0, 400);
  const magnitude = clampInt(iv.params.magnitude ?? 1000, 0, 5000);
  const until = world.tick + days * TICKS_PER_DAY;
  const actor = iv.origin === "observer" ? ACTOR_OBSERVER : ACTOR_ENV;
  const { w, h } = sc;
  const cx = iv.params.x ?? -1;
  const cy = iv.params.y ?? -1;
  const radius = iv.params.radius ?? 0;
  const inArea = (x: number, y: number) =>
    radius <= 0 || cx < 0 ? true : (x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius + radius;
  const data: Record<string, unknown> = { kind, days, magnitude, origin: iv.origin };
  let affected = 0;

  switch (kind) {
    case "drought":
      world.climate.droughtUntil = Math.max(world.climate.droughtUntil, until);
      break;
    case "cold_snap":
      world.climate.coldUntil = Math.max(world.climate.coldUntil, until);
      world.climate.coldDelta = -Math.round((90 * magnitude) / 1000);
      break;
    case "rain":
      world.climate.rainUntil = Math.max(world.climate.rainUntil, until);
      break;
    case "hush":
      world.climate.hushUntil = Math.max(world.climate.hushUntil, until);
      world.climate.hushRadius = clampInt(iv.params.radius ?? 1, 0, 16);
      break;
    case "blight":
    case "bounty": {
      const nodes = world.nodes;
      for (let n = 0; n < nodes.count; n++) {
        const k = nodes.kind[n] as number;
        if (!NODE_SPECS[k]!.renewable) continue;
        if (kind === "blight" && k !== NodeKind.berry_bush && k !== NodeKind.root_patch) continue;
        if (!inArea(nodes.x[n] as number, nodes.y[n] as number)) continue;
        // without an explicit area, a share of nodes proportional to magnitude is hit
        if (radius <= 0 && !chance(Math.round(magnitude * 0.6), 1000, cfg.seed, Stream.Regrowth, world.tick, n, 77)) continue;
        const before = nodes.amount[n] as number;
        const after = kind === "blight" ? Math.floor(before / 10) : (nodes.cap[n] as number);
        if (after !== before) {
          nodes.amount[n] = after;
          affected++;
        }
      }
      break;
    }
    case "windfall": {
      // a pile of fish and driftwood on a shore tile (the chosen one, or a seeded pick)
      let tile = cx >= 0 && cy >= 0 && cx < w && cy < h ? cy * w + cx : -1;
      if (tile < 0 || (world.terrain.moveCost[tile] as number) === 0) {
        const shore: number[] = [];
        for (let i = 0; i < w * h; i++) {
          if (world.terrain.biome[i] === Biome.shore && (world.terrain.moveCost[i] as number) > 0 && world.terrain.water[i] === Water.none) shore.push(i);
        }
        tile = shore.length > 0 ? (shore[below(shore.length, cfg.seed, Stream.Spawn, world.tick, 501)] as number) : -1;
      }
      if (tile >= 0) {
        const x = tile % w;
        const y = (tile - x) / w;
        const fish = Math.round((24 * magnitude) / 1000);
        const wood = Math.round((16 * magnitude) / 1000);
        dropOnGround(world, sc, x, y, Item.fish, fish);
        dropOnGround(world, sc, x, y, Item.wood, wood);
        source(world, Item.fish, fish);
        source(world, Item.wood, wood);
        data.x = x;
        data.y = y;
        affected = fish + wood;
      }
      break;
    }
    case "newcomers": {
      const room = agentCapacity(cfg) - world.agents.length;
      const count = clampInt(iv.params.count ?? 5, 0, Math.max(0, room));
      if (count > 0) {
        const tiles = spawnTiles({ ...cfg, spawn: "clustered" }, world.terrain, count, world.tick + 1);
        const taken = new Set(world.agents.map((a) => a.name));
        for (let k = 0; k < count; k++) {
          const tile = tiles[k] ?? tiles[0] ?? 0;
          const x = tile % w;
          const id = world.agents.length;
          const a = createAgent(cfg, world.terrain, world.nodes, id, x, (tile - x) / w, taken);
          a.since = world.tick;
          world.agents.push(a);
          for (let i = 0; i < ITEM_COUNT; i++) source(world, i, a.inv[i] as number);
          emit(world, out, "arrival", a.id, { x: a.x, y: a.y });
        }
        affected = count;
      }
      break;
    }
    case "stranger": {
      // One adult comes ashore knowing a craft, and the crafts it rests on: the craft asked for, or
      // the first on the ladder that nobody living knows. A world without crafts has no such person.
      if (!cfg.crafts || agentCapacity(cfg) - world.agents.length < 1) return;
      let known = 0;
      for (const a of world.agents) if (a.alive) known |= a.lore;
      let craft = Number.isInteger(iv.params.craft) && (iv.params.craft as number) >= 0 && (iv.params.craft as number) < CRAFT_COUNT ? (iv.params.craft as number) : -1;
      for (let c = 0; craft < 0 && c < CRAFT_COUNT; c++) if ((known & (1 << c)) === 0) craft = c;
      if (craft < 0) craft = below(CRAFT_COUNT, cfg.seed, Stream.Arrivals, world.tick, 7);
      let lore = 1 << craft;
      for (let pass = 0; pass < CRAFT_COUNT; pass++) for (const spec of CRAFT_SPECS) if (lore & (1 << spec.id)) for (const need of spec.needs) lore |= 1 << need;
      const tiles = spawnTiles({ ...cfg, spawn: "clustered" }, world.terrain, 1, world.tick + 1);
      const tile = tiles[0] ?? 0;
      const x = tile % w;
      const a = createAgent(cfg, world.terrain, world.nodes, world.agents.length, x, (tile - x) / w, new Set(world.agents.map((p) => p.name)));
      a.lore = lore;
      a.since = world.tick;
      world.agents.push(a);
      for (let i = 0; i < ITEM_COUNT; i++) source(world, i, a.inv[i] as number);
      emit(world, out, "arrival", a.id, { x: a.x, y: a.y, r: "stranger", q: craft });
      data.craft = craft;
      affected = 1;
      break;
    }
    default:
      return; // unknown kinds are ignored rather than guessed at
  }
  data.affected = affected;
  world.interventions.push({ tick: world.tick, kind, params: { ...iv.params }, origin: iv.origin });
  emit(world, out, iv.origin === "observer" ? "intervention" : "shock", actor, { d: data });
}

/** Resolve the start tick of each scheduled shock from the seed (called once at world creation). */
export function resolveShockTicks(world: WorldState): number[] {
  return world.config.shocks.map((s, k) => {
    const span = s.maxDay - s.minDay + 1;
    const day = s.minDay + (u32(world.config.seed, Stream.Weather, 9000 + k) % span);
    return day * TICKS_PER_DAY;
  });
}

/** Per-tick environment update. Returns the calendar for reuse by the caller. */
export function stepEnvironment(world: WorldState, sc: Scratch, out: EventOut): void {
  const cfg = world.config;
  const tick = world.tick;
  const cal = calendarAt(cfg, tick);

  // scheduled shocks
  for (let k = 0; k < world.shockTicks.length; k++) {
    if (world.shockTicks[k] === tick) {
      const s = cfg.shocks[k]!;
      world.shockTicks[k] = -1;
      applyIntervention(world, sc, out, { tick, kind: s.kind, params: { days: s.days, magnitude: s.magnitude }, origin: "scenario" });
    }
  }

  if (cal.tickOfDay === 0) {
    if (tick > 0) {
      dailyUpkeep(world, sc, out, cal.day, cal.season);
      emit(world, out, "day", ACTOR_ENV, { q: cal.day, d: { season: cal.season, seasonDay: cal.seasonDay } });
      if (cal.seasonDay === 0) emit(world, out, "season", ACTOR_ENV, { q: cal.season });
    }
  }

  // fires burn down every tick, faster in rain
  for (const s of world.structures) {
    if (s.removed || !s.complete || s.kind !== StructureKind.campfire || s.fuel <= 0) continue;
    const wet = world.climate.weather === Weather.rain || world.climate.weather === Weather.storm || world.climate.weather === Weather.snow;
    s.fuel -= wet && tick % 2 === 0 ? 2 : 1;
    if (s.fuel <= 0) {
      s.fuel = 0;
      emit(world, out, "fire_out", ACTOR_ENV, { s: s.id, x: s.x, y: s.y });
    }
  }
}
