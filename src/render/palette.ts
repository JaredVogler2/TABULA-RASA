/**
 * Colour and light design for the diorama (see docs/ART_BIBLE.md).
 *
 * A restrained naturalistic palette: mossy greens, warm sand and timber, cool slate,
 * luminous shallow water. Light follows the simulated sun; the backdrop stays dark and
 * quiet so the island reads as a lit object on a plinth.
 */
import { Color, Vector3 } from "three";

const c = (hex: string) => new Color(hex);

export const BIOME_COLORS: readonly Color[] = [
  c("#b9ad84"), // sea (seabed sand, used above water only at blends)
  c("#d6c292"), // shore
  c("#587646"), // wetland
  c("#7e9d4c"), // meadow
  c("#48693a"), // forest floor
  c("#a59a58"), // scrub
  c("#7f8a5c"), // highland turf (rock is added by slope and height)
];

export const SEABED_SHALLOW = c("#cfc296");
export const SEABED_DEEP = c("#566f6a");
export const ROCK_LIGHT = c("#a39a88");
export const ROCK_DARK = c("#5b564e");
export const SOIL = c("#7a5c3c");
export const PATH = c("#b59a6c");
export const SNOW = c("#eef2f4");

/** Damp earth on a bank, the gravel of a stream bed, and still fresh water where it is deep. */
export const WET_SOIL = c("#665539");
export const STREAM_BED = c("#56655a");
export const FRESH_DEEP = c("#175f5e");

export const WATER_SHALLOW = c("#7fd6cf");
export const WATER_MID = c("#328ca2");
export const WATER_DEEP = c("#164b73");
export const FOAM = c("#f2fbf8");

export const TUNICS = ["#b4533c", "#c98a2b", "#3f6a8c", "#5a7d4b", "#d9c9a3", "#7a4a2e", "#8c5a86", "#2f6e6a", "#a8a094", "#c26d4a", "#6b7fb0", "#93a85a"].map(c);
export const SKINS = ["#f1d3b3", "#e3b98f", "#c99468", "#a8734d", "#7f5236", "#5e3d29"].map(c);
export const HAIRS = ["#2b1d14", "#4a3120", "#7a5230", "#b08a4a", "#d9c27a", "#8f8f8a", "#a4442a", "#1a1a1c"].map(c);

/** Foliage tint by season: spring, summer, autumn, winter. */
export const CANOPY_BY_SEASON = [c("#5c8f3f"), c("#3a7232"), c("#c47a2c"), c("#6f6b52")];
export const CONIFER_BY_SEASON = [c("#35633d"), c("#285235"), c("#31593a"), c("#2f4f44")];
export const GRASS_BY_SEASON = [c("#8fb356"), c("#7e9d4c"), c("#b09b50"), c("#928f70")];

export interface LightState {
  sunDir: Vector3;
  sunColor: Color;
  sunIntensity: number;
  moonIntensity: number;
  skyColor: Color;
  groundColor: Color;
  hemiIntensity: number;
  backdropTop: Color;
  backdropHorizon: Color;
  exposure: number;
  /** 0 day … 1 full night */
  night: number;
  /** 0..1 strength of the golden-hour tint */
  golden: number;
}

const DAY_SUN = c("#fff1dc");
const GOLD_SUN = c("#ffb066");
const DAY_SKY = c("#c4dbee");
const GOLD_SKY = c("#f3c49a");
const NIGHT_SKY = c("#4a6a9c");
const DAY_GROUND = c("#7c8a5e");
const NIGHT_GROUND = c("#1b2738");
const BACK_DAY_TOP = c("#0c1512");
const BACK_DAY_HORIZON = c("#22352c");
const BACK_GOLD_HORIZON = c("#4a3526");
const BACK_NIGHT_TOP = c("#04070d");
const BACK_NIGHT_HORIZON = c("#111d33");

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Lighting for a moment of the simulated day.
 * @param tickOfDay 0..95 (may be fractional); tick 0 is 06:00
 * @param dayLength ticks of daylight today
 * @param yearPos   0..1 position in the climatic year
 * @param overcast  0..1 cloud cover (dims and cools the sun)
 */
export function lightAt(tickOfDay: number, dayLength: number, yearPos: number, overcast: number, out: LightState): LightState {
  const noon = 26;
  // signed distance from solar noon in ticks, wrapped to ±48
  let d = tickOfDay - noon;
  if (d > 48) d -= 96;
  if (d < -48) d += 96;
  const half = dayLength / 2;
  // sun height: 1 at noon, 0 at sunrise/sunset, negative below the horizon
  const hgt = Math.cos((Math.PI * d) / (2 * half)) * (Math.abs(d) <= 2 * half ? 1 : -1);
  const elevated = Math.abs(d) < half ? hgt : -Math.min(1, (Math.abs(d) - half) / 14);
  const seasonal = Math.sin(2 * Math.PI * (yearPos - 0.125));
  const maxEl = (50 + 13 * seasonal) * (Math.PI / 180);
  const el = Math.max(0.05, elevated) * maxEl;
  const az = (d / half) * (Math.PI / 2) * 0.92 + Math.PI * 0.12;
  out.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();

  const day = smooth(-0.05, 0.22, elevated);
  const golden = day * (1 - smooth(0.12, 0.55, elevated));
  const night = 1 - smooth(-0.3, 0.05, elevated);
  out.night = night;
  out.golden = golden;

  out.sunColor.copy(DAY_SUN).lerp(GOLD_SUN, golden * 0.9);
  out.sunIntensity = day * (3.5 - 1.0 * golden) * (1 - 0.6 * overcast);
  out.moonIntensity = night * 1.25;
  out.skyColor.copy(DAY_SKY).lerp(GOLD_SKY, golden * 0.8).lerp(NIGHT_SKY, night);
  if (overcast > 0) out.skyColor.lerp(c("#aab4b8"), overcast * 0.55 * (1 - night));
  out.groundColor.copy(DAY_GROUND).lerp(NIGHT_GROUND, night);
  out.hemiIntensity = 0.42 + 0.5 * day + 0.3 * overcast * day + 0.3 * night;
  out.backdropTop.copy(BACK_DAY_TOP).lerp(BACK_NIGHT_TOP, night);
  out.backdropHorizon.copy(BACK_DAY_HORIZON).lerp(BACK_GOLD_HORIZON, golden).lerp(BACK_NIGHT_HORIZON, night);
  out.exposure = 1.02 - 0.1 * golden + 0.38 * night;
  return out;
}

export function makeLightState(): LightState {
  return {
    sunDir: new Vector3(0.4, 0.8, 0.4),
    sunColor: new Color(),
    sunIntensity: 1,
    moonIntensity: 0,
    skyColor: new Color(),
    groundColor: new Color(),
    hemiIntensity: 1,
    backdropTop: new Color(),
    backdropHorizon: new Color(),
    exposure: 1,
    night: 0,
    golden: 0,
  };
}

/** Deterministic per-entity random in [0,1). */
/**
 * How worn a tile looks for a given count of recent footfalls, 0..1. The engine makes a tile
 * cheaper to cross from 24 footfalls: that is where this passes three quarters and the ground
 * is drawn as a beaten track. Lighter use only dulls and flattens the turf.
 */
export function wearOf(traffic: number): number {
  return 1 - Math.exp(-traffic / 16);
}

export function rand01(id: number, salt: number): number {
  let h = Math.imul(id + 1, 374761393) ^ Math.imul(salt + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
