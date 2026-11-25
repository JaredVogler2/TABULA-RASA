/**
 * Bodies: need decay, warmth exchange, illness, health and death.
 * Death is a state transition with a recorded cause; carried goods fall where the agent stood.
 */
import { clampInt } from "../core/math";
import { Stream, below, chance, stochasticDiv } from "../core/rng";
import { ITEM_COUNT, NEED_MAX, Phys, StructureKind, TICKS_PER_DAY, Weather } from "../model/constants";
import { Activity, type Agent, type WorldState } from "../model/types";
import { COMFORT_TEMP } from "../world/climate";
import { remember } from "../mind/knowledge";
import { emit, type EventOut } from "./events";
import { dropOnGround } from "./inventory";
import type { Scratch } from "./scratch";

const WORK_KINDS = new Set(["gather", "craft", "work", "supply", "harvest", "build"]);

export function activityOf(a: Agent): number {
  const act = a.act;
  if (!act) return Activity.idle;
  switch (act.k) {
    case "step":
      return Activity.travel;
    case "rest":
      return Activity.rest;
    case "say":
    case "give":
      return Activity.social;
    case "craft":
      return Activity.craft;
    case "work":
    case "supply":
    case "build":
    case "refuel":
      return Activity.build;
    case "harvest":
      return Activity.farm;
    default:
      return Activity.idle; // gather is classified by node kind where it completes
  }
}

/** Effective temperature felt by an agent, in tenths of °C. */
export function feltTemperature(world: WorldState, sc: Scratch, a: Agent): number {
  const tile = a.y * sc.w + a.x;
  const c = world.climate;
  let t = c.temp - Math.floor(((world.terrain.height[tile] as number) * 40) / 1000);
  if (sc.warm[tile]) t += 120;
  const sheltered = a.shelter >= 0;
  if (sheltered) t += 80;
  const act = a.act;
  if (act && (act.k === "step" || WORK_KINDS.has(act.k))) t += 30;
  if (!sheltered && (c.weather === Weather.rain || c.weather === Weather.storm || c.weather === Weather.snow)) t -= 30;
  return t;
}

/** Advance one agent's body by one tick. Returns true if the agent died this tick. */
export function updateBody(world: WorldState, sc: Scratch, a: Agent, out: EventOut): boolean {
  const cfg = world.config;
  const tick = world.tick;
  const act = a.act;
  const moving = act !== null && act.k === "step";
  const working = act !== null && WORK_KINDS.has(act.k);
  const metab = (700 + 6 * (a.phys[Phys.metabolism] as number)) * cfg.metabolism; // ×1e-6 scale (≈1.0 at 50)
  const stamina = a.phys[Phys.stamina] as number;

  // ── energy
  let energyRate = 3000; // per tick ×1000
  if (a.asleep) energyRate = 1800;
  else if (working) energyRate += 1100 - stamina * 4;
  else if (moving) energyRate += 700 - stamina * 3;
  if (a.ill > 0) energyRate += 900;
  a.energy = clampInt(
    a.energy - stochasticDiv(Math.round((energyRate * metab) / 1000), 1_000_000, cfg.seed, Stream.Decay, tick, a.id, 1),
    0,
    NEED_MAX,
  );

  // ── hydration
  let hydrationRate = 5000;
  if (a.asleep) hydrationRate = 3000;
  else if (working || moving) hydrationRate += world.climate.temp > 230 ? 2200 : 900;
  a.hydration = clampInt(
    a.hydration - stochasticDiv(Math.round((hydrationRate * metab) / 1000), 1_000_000, cfg.seed, Stream.Decay, tick, a.id, 2),
    0,
    NEED_MAX,
  );

  // ── rest
  if (a.asleep) {
    const gain = a.shelter >= 0 ? 21 : sc.warm[a.y * sc.w + a.x] ? 18 : 16;
    a.rest = clampInt(a.rest + gain, 0, NEED_MAX);
  } else {
    const loss = working ? 6 : moving ? 5 : 4;
    a.rest = clampInt(a.rest - loss + (stamina > 70 && tick % 3 === 0 ? 1 : 0), 0, NEED_MAX);
  }

  // ── warmth
  const felt = feltTemperature(world, sc, a);
  const deficit = COMFORT_TEMP - felt;
  if (deficit > 0) {
    a.warmth = clampInt(
      a.warmth - stochasticDiv(deficit * cfg.metabolism, 20_000, cfg.seed, Stream.Decay, tick, a.id, 3),
      0,
      NEED_MAX,
    );
  } else {
    a.warmth = clampInt(a.warmth + 22, 0, NEED_MAX);
  }

  // ── illness (idiosyncratic, non-contagious risk; checked once a day per agent, staggered)
  if (a.ill > 0) {
    a.ill--;
    if (a.ill === 0) emit(world, out, "recover", a.id);
  } else if (cfg.illness > 0 && (tick + a.id * 7) % TICKS_PER_DAY === 0) {
    // base 0.7% per day, tripled when cold, hungry or exhausted
    let p = 7;
    if (a.warmth < 350) p += 9;
    if (a.energy < 250) p += 7;
    if (a.rest < 200) p += 5;
    if (chance(Math.round((p * cfg.illness) / 1000), 1000, cfg.seed, Stream.Illness, tick, a.id)) {
      a.ill = (3 + below(4, cfg.seed, Stream.Illness, tick, a.id, 1)) * TICKS_PER_DAY;
      emit(world, out, "ill", a.id, { q: a.ill });
    }
  }

  // ── health
  let damage = 0;
  let cause = "";
  let worst = 0;
  const hit = (amount: number, why: string) => {
    damage += amount;
    if (amount > worst) {
      worst = amount;
      cause = why;
    }
  };
  if (a.hydration === 0) hit(7, "thirst");
  if (a.warmth === 0) hit(6, "cold");
  else if (a.warmth < 200) hit(2, "cold");
  if (a.energy === 0) hit(4, "hunger");
  if (a.rest === 0) hit(1, "exhaustion");
  if (damage > 0) {
    a.health -= damage;
  } else if (a.health < 1000 && a.energy > 300 && a.hydration > 300 && a.warmth > 350) {
    a.health += a.ill > 0 ? (tick % 2 === 0 ? 1 : 0) : 1;
    if (a.health > 1000) a.health = 1000;
  }

  // ── welfare integral and activity accounting
  const minNeed = Math.min(a.energy, a.hydration, a.rest, a.warmth);
  a.stats.welfareSum += minNeed;
  a.stats.aliveTicks++;
  const cls = act && act.k === "gather" ? -1 : activityOf(a);
  if (cls >= 0) a.stats.activity[cls] = (a.stats.activity[cls] as number) + 1;

  // ── need-threshold memories (first crossing only, via coarse hysteresis on tick alignment)
  if ((tick + a.id) % 24 === 0) {
    if (a.energy < 180) remember(world, a, "hungry", { salience: 420 });
    if (a.hydration < 180) remember(world, a, "thirsty", { salience: 420 });
    if (a.warmth < 220) remember(world, a, "cold", { salience: 520 });
    if (a.rest < 100) remember(world, a, "exhausted", { salience: 260 });
  }

  if (a.health <= 0) {
    killAgent(world, sc, a, cause || "unknown", out);
    return true;
  }
  return false;
}

export function killAgent(world: WorldState, sc: Scratch, a: Agent, cause: string, out: EventOut): void {
  a.health = 0;
  a.alive = false;
  a.diedTick = world.tick;
  a.deathCause = cause;
  a.asleep = false;
  a.act = null;
  a.queue.length = 0;
  a.path.length = 0;
  if (a.shelter >= 0) {
    const s = world.structures[a.shelter];
    if (s && s.kind === StructureKind.shelter && s.occupants > 0) s.occupants--;
    a.shelter = -1;
  }
  for (let i = 0; i < ITEM_COUNT; i++) {
    const q = a.inv[i] as number;
    if (q > 0) {
      dropOnGround(world, sc, a.x, a.y, i, q);
      a.inv[i] = 0;
    }
  }
  world.metrics.deaths++;
  world.metrics.deathsByCause[cause] = (world.metrics.deathsByCause[cause] ?? 0) + 1;
  emit(world, out, "death", a.id, { x: a.x, y: a.y, r: cause, p: a.mind.decisionEvent >= 0 ? [a.mind.decisionEvent] : [] });
  // witnesses within sight remember it
  const r = 5;
  for (const other of world.agents) {
    if (!other.alive || other.asleep || other.id === a.id) continue;
    const dx = other.x - a.x;
    const dy = other.y - a.y;
    if (dx * dx + dy * dy <= r * r) remember(world, other, "death", { who: a.id, salience: 800 });
  }
}
