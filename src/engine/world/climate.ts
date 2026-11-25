/**
 * Calendar, daylight, temperature and weather. Everything is integer arithmetic on top
 * of the deterministic `sinTurn` approximation; weather transitions use keyed draws.
 */
import { clampInt, sinTurn } from "../core/math";
import { Stream, below } from "../core/rng";
import { yearLength, type WorldConfig } from "../model/config";
import { TICKS_PER_DAY, Weather } from "../model/constants";
import type { Climate, WorldState } from "../model/types";

export interface Calendar {
  /** Whole days elapsed since tick 0. */
  day: number;
  tickOfDay: number;
  /** Day within the year, 0-based, including config.startDay. */
  yearDay: number;
  year: number;
  /** 0 spring · 1 summer · 2 autumn · 3 winter */
  season: number;
  /** Day within the season (0-based) and that season's length. */
  seasonDay: number;
  seasonLength: number;
  /**
   * Position in the climatic year in [0,1): each season occupies exactly one quarter
   * regardless of its length in days, so a long winter is a slow winter, not a colder curve.
   */
  yearPos: number;
}

export function calendarAt(cfg: WorldConfig, tick: number): Calendar {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const tickOfDay = tick - day * TICKS_PER_DAY;
  const yl = yearLength(cfg);
  const absDay = cfg.startDay + day;
  const year = Math.floor(absDay / yl);
  const yearDay = absDay - year * yl;
  let season = 0;
  let acc = 0;
  for (let s = 0; s < 4; s++) {
    const len = cfg.seasonDays[s] as number;
    if (yearDay < acc + len) {
      season = s;
      break;
    }
    acc += len;
  }
  const seasonLength = cfg.seasonDays[season] as number;
  const seasonDay = yearDay - acc;
  const yearPos = (season + (seasonDay + tickOfDay / TICKS_PER_DAY) / seasonLength) / 4;
  return { day, tickOfDay, yearDay, year, season, seasonDay, seasonLength, yearPos };
}

/** Comfort threshold in tenths of °C: below this effective temperature, bodies lose warmth. */
export const COMFORT_TEMP = 80;

/** Seasonal mean temperature at sea level in tenths of °C. */
export function seasonalMean(cfg: WorldConfig, yearPos: number): number {
  const s = sinTurn(yearPos - 0.125); // +1 mid-summer, −1 mid-winter
  let t = 135 + 115 * s;
  if (s < 0) t += (s * 115 * (cfg.winterSeverity - 1000)) / 1000;
  return Math.round(t);
}

/** Ticks of daylight on a given day of the climatic year. */
export function dayLength(yearPos: number): number {
  return Math.round(56 + 12 * sinTurn(yearPos - 0.125));
}

/** Daylight level 0..1000 for a tick of day. Solar noon is tick-of-day 26 (12:30). */
export function daylight(yearPos: number, tickOfDay: number): number {
  const len = dayLength(yearPos);
  const sunrise = 26 - len / 2;
  const sunset = 26 + len / 2;
  // tick-of-day wraps: evaluate distance to the daylight interval on a circular day
  let tod = tickOfDay;
  if (tod > sunset + 20) tod -= TICKS_PER_DAY;
  const RAMP = 6;
  if (tod <= sunrise - RAMP || tod >= sunset + RAMP) return 0;
  if (tod >= sunrise + RAMP && tod <= sunset - RAMP) return 1000;
  if (tod < sunrise + RAMP) return clampInt(Math.round(((tod - (sunrise - RAMP)) * 1000) / (2 * RAMP)), 0, 1000);
  return clampInt(Math.round((((sunset + RAMP) - tod) * 1000) / (2 * RAMP)), 0, 1000);
}

export function isNight(climate: Climate): boolean {
  return climate.light < 250;
}

/** Seasonal weather distribution in permille: [clear, overcast, rain, storm]. */
const WEATHER_MIX: readonly (readonly [number, number, number, number])[] = [
  [450, 300, 220, 30],
  [620, 220, 120, 40],
  [350, 330, 270, 50],
  [360, 350, 240, 50],
];

const WEATHER_PERIOD = 12; // ticks between possible weather changes (3 hours)

export function initialClimate(cfg: WorldConfig): Climate {
  const cal = calendarAt(cfg, 0);
  return {
    weather: Weather.clear,
    weatherUntil: 0,
    temp: seasonalMean(cfg, cal.yearPos),
    wet: 0,
    snow: 0,
    light: daylight(cal.yearPos, 0),
    droughtUntil: 0,
    coldUntil: 0,
    coldDelta: 0,
    rainUntil: 0,
    hushUntil: 0,
    hushRadius: 0,
  };
}

/** Advance weather, temperature and light to `world.tick`. Returns true if the weather kind changed. */
export function updateClimate(world: WorldState): boolean {
  const cfg = world.config;
  const c = world.climate;
  const tick = world.tick;
  const cal = calendarAt(cfg, tick);
  const epoch = world.meta.branch.rngEpoch;
  let changed = false;

  if (tick >= c.weatherUntil) {
    const mix = WEATHER_MIX[cal.season]!;
    // persistence: keep current weather unless a redraw is triggered
    const redrawP = clampInt(Math.round((450 * cfg.weatherVolatility) / 1000), 0, 1000);
    let next = c.weather === Weather.snow ? Weather.rain : c.weather;
    if (below(1000, cfg.seed, Stream.Weather, tick, epoch, 1) < redrawP || tick === 0) {
      const r = below(1000, cfg.seed, Stream.Weather, tick, epoch, 2);
      next = r < mix[0] ? Weather.clear : r < mix[0] + mix[1] ? Weather.overcast : r < mix[0] + mix[1] + mix[2] ? Weather.rain : Weather.storm;
    }
    if (tick < c.rainUntil) next = Weather.rain;
    if (tick < c.droughtUntil && (next === Weather.rain || next === Weather.storm)) {
      next = below(2, cfg.seed, Stream.Weather, tick, epoch, 3) === 0 ? Weather.clear : Weather.overcast;
    }
    c.weatherUntil = tick + WEATHER_PERIOD;
    // precipitation falls as snow when it is cold enough (resolved below once temp is known)
    if (next !== (c.weather === Weather.snow ? Weather.rain : c.weather)) changed = true;
    c.weather = next;
  }

  const diurnal = 50 * sinTurn((cal.tickOfDay - 12) / TICKS_PER_DAY);
  let temp = seasonalMean(cfg, cal.yearPos) + diurnal;
  const light = daylight(cal.yearPos, cal.tickOfDay);
  const w = c.weather;
  if (w === Weather.clear) temp += light < 250 ? -12 : 6;
  else if (w === Weather.overcast) temp += light < 250 ? 4 : -10;
  else if (w === Weather.rain || w === Weather.snow) temp -= 22;
  else if (w === Weather.storm) temp -= 38;
  if (tick < c.coldUntil) temp += c.coldDelta;
  c.temp = Math.round(temp);
  c.light = light;

  if (c.weather === Weather.rain && c.temp < 15) {
    c.weather = Weather.snow;
  } else if (c.weather === Weather.snow && c.temp >= 15) {
    c.weather = Weather.rain;
  }

  // ground wetness and snow cover (0..1000)
  if (c.weather === Weather.rain || c.weather === Weather.storm) c.wet = Math.min(1000, c.wet + 40);
  else c.wet = Math.max(0, c.wet - (c.weather === Weather.clear ? 12 : 6));
  if (c.weather === Weather.snow) c.snow = Math.min(1000, c.snow + 18);
  else if (c.temp > 20) c.snow = Math.max(0, c.snow - (c.temp > 60 ? 14 : 5));

  return changed;
}

/** Hearing radius in force right now (interventions can dampen voices). */
export function hearingRadius(world: WorldState): number {
  const c = world.climate;
  let r = world.config.hearingRadius;
  if (world.tick < c.hushUntil) r = Math.min(r, c.hushRadius);
  if (c.weather === Weather.storm) r = Math.max(1, r - 2);
  return r;
}

/** Sight radius in force right now. */
export function sightRadius(world: WorldState): number {
  const c = world.climate;
  const base = world.config.sightRadius;
  // interpolate between 3 tiles at night and the configured daylight radius
  let r = 3 + Math.floor(((base - 3) * c.light) / 1000);
  if (c.weather === Weather.storm) r -= 2;
  else if (c.weather === Weather.rain || c.weather === Weather.snow) r -= 1;
  return r < 2 ? 2 : r;
}

export function droughtActive(world: WorldState): boolean {
  return world.tick < world.climate.droughtUntil;
}
