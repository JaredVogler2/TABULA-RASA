import { describe, expect, it } from "vitest";
import { SCENARIOS, makeConfig, validateConfig, type WorldConfig } from "../model/config";
import { Biome, NODE_SPECS, NodeKind, TICKS_PER_DAY, Water, Weather } from "../model/constants";
import { calendarAt, dayLength, daylight, initialClimate, seasonalMean, updateClimate } from "./climate";
import { createWorld } from "./create";
import { placeNodes } from "./nodes";
import { generateTerrain } from "./terrain";

const SEEDS = [1, 2, 3, 11, 42, 97, 314, 777];

describe("terrain generation", () => {
  it("is a pure function of the config", () => {
    const a = generateTerrain(makeConfig("first_light", 5)).terrain;
    const b = generateTerrain(makeConfig("first_light", 5)).terrain;
    const c = generateTerrain(makeConfig("first_light", 6)).terrain;
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(Array.from(a.height)).toEqual(Array.from(b.height));
  });

  it("pins the reference world (seed 1) so generator drift is caught", () => {
    const t = generateTerrain(makeConfig("first_light", 1)).terrain;
    expect(t.hash).toMatchInlineSnapshot(`"706c1b04cbe3cdb8d0fee85fdff9e2528e7222a1676d73f05f2fd6cc3127a3f1"`);
  });

  it.each(SEEDS)("seed %i yields a habitable island with a stable habitat mix", (seed) => {
    const cfg = makeConfig("first_light", seed);
    const t = generateTerrain(cfg).terrain;
    const n = t.w * t.h;
    expect(t.landCount / n).toBeGreaterThan(0.46);
    expect(t.landCount / n).toBeLessThan(0.54);
    const counts = new Array<number>(7).fill(0);
    let streams = 0;
    let perennial = 0;
    for (let i = 0; i < n; i++) {
      counts[t.biome[i] as number]!++;
      if (t.water[i] === Water.stream) streams++;
      if (t.fresh[i] === 2) perennial++;
      // sea and ponds are impassable; all other land is walkable
      if (t.water[i] === Water.sea || t.water[i] === Water.pond) expect(t.moveCost[i]).toBe(0);
      else expect(t.moveCost[i]).toBeGreaterThan(0);
    }
    const land = t.landCount;
    expect(counts[Biome.highland]! / land).toBeGreaterThan(0.1);
    expect(counts[Biome.highland]! / land).toBeLessThan(0.22);
    expect(counts[Biome.forest]! / land).toBeGreaterThan(0.18);
    expect(counts[Biome.meadow]! / land).toBeGreaterThan(0.2);
    expect(streams).toBeGreaterThan(40);
    expect(perennial).toBeGreaterThan(0); // some water survives a drought
    // the island never touches the edge of the world
    for (let x = 0; x < t.w; x++) {
      expect(t.water[x]).toBe(Water.sea);
      expect(t.water[(t.h - 1) * t.w + x]).toBe(Water.sea);
    }
    for (let y = 0; y < t.h; y++) {
      expect(t.water[y * t.w]).toBe(Water.sea);
      expect(t.water[y * t.w + t.w - 1]).toBe(Water.sea);
    }
  });

  it("the strait splits the island into at least two regions joined by a ford", () => {
    for (const seed of [1, 2, 3]) {
      const cfg = makeConfig("two_shores", seed);
      const { terrain, extras } = generateTerrain(cfg);
      expect(extras.fords.length).toBeGreaterThan(0);
      const sizes = new Map<number, number>();
      for (let i = 0; i < terrain.region.length; i++) {
        const r = terrain.region[i] as number;
        if (r !== 255) sizes.set(r, (sizes.get(r) ?? 0) + 1);
      }
      const big = [...sizes.values()].filter((s) => s > 150);
      expect(big.length).toBeGreaterThanOrEqual(2);
      for (const f of extras.fords) expect(terrain.moveCost[f]).toBeGreaterThan(0);
    }
  });
});

describe("resource nodes", () => {
  it.each(SEEDS)("seed %i places every material on valid tiles", (seed) => {
    const cfg = makeConfig("first_light", seed);
    const t = generateTerrain(cfg).terrain;
    const nodes = placeNodes(cfg, t);
    const perKind = new Array<number>(NODE_SPECS.length).fill(0);
    for (let k = 0; k < nodes.count; k++) {
      const kind = nodes.kind[k] as number;
      perKind[kind]!++;
      const tile = (nodes.y[k] as number) * t.w + (nodes.x[k] as number);
      expect(nodes.atTile[tile]).toBe(k);
      expect(nodes.amount[k]).toBeGreaterThanOrEqual(0);
      expect(nodes.amount[k]).toBeLessThanOrEqual(nodes.cap[k] as number);
      if (kind === NodeKind.fishing_water) expect([Water.sea, Water.pond]).toContain(t.water[tile]);
      else {
        expect(t.water[tile]).toBe(Water.none);
        expect(t.moveCost[tile]).toBeGreaterThan(0);
      }
    }
    for (const count of perKind) expect(count).toBeGreaterThanOrEqual(4);
  });

  it("richness scales capacities and density scales counts", () => {
    const base = makeConfig("first_light", 9, { richness: 1000, nodeDensity: 1000 });
    const t = generateTerrain(base).terrain;
    const normal = placeNodes(base, t);
    const rich = placeNodes({ ...base, richness: 2000 }, t);
    const sparse = placeNodes({ ...base, nodeDensity: 500 }, t);
    const sum = (xs: Int16Array) => xs.reduce((a, b) => a + b, 0);
    expect(rich.count).toBe(normal.count);
    expect(sum(rich.cap) / sum(normal.cap)).toBeGreaterThan(1.9);
    expect(sum(rich.cap) / sum(normal.cap)).toBeLessThan(2.1);
    expect(sparse.count).toBeLessThan(normal.count * 0.7);
  });
});

describe("population", () => {
  it("creates fifty distinct, validly placed adults with heterogeneous traits", () => {
    const world = createWorld(makeConfig("first_light", 3));
    expect(world.agents.length).toBe(50);
    const names = new Set(world.agents.map((a) => a.name));
    expect(names.size).toBe(50);
    const tiles = new Set<number>();
    for (const a of world.agents) {
      const tile = a.y * world.terrain.w + a.x;
      expect(world.terrain.moveCost[tile]).toBeGreaterThan(0);
      tiles.add(tile);
      expect(a.alive).toBe(true);
      expect(a.name).toMatch(/^[A-Z][a-z]{2,8}$/);
      for (const v of a.traits) {
        expect(v).toBeGreaterThanOrEqual(2);
        expect(v).toBeLessThanOrEqual(98);
      }
    }
    expect(tiles.size).toBe(50);
    const industry = world.agents.map((a) => a.traits[0] as number);
    const mean = industry.reduce((x, y) => x + y, 0) / 50;
    const sd = Math.sqrt(industry.reduce((x, y) => x + (y - mean) * (y - mean), 0) / 50);
    expect(sd).toBeGreaterThan(10);
  });

  it("diversity 0 yields identical traits; the seed changes who is who", () => {
    const flat = createWorld(makeConfig("first_light", 3, { diversity: 0 }));
    for (const a of flat.agents) expect(a.traits).toEqual(flat.agents[0]!.traits);
    const a = createWorld(makeConfig("first_light", 3));
    const b = createWorld(makeConfig("first_light", 4));
    expect(a.agents.map((x) => x.name)).not.toEqual(b.agents.map((x) => x.name));
  });

  it("every scenario builds a world", () => {
    for (const s of SCENARIOS) {
      const world = createWorld(makeConfig(s.id, 12));
      expect(world.agents.length).toBe(50);
      expect(world.nodes.count).toBeGreaterThan(100);
      expect(world.shockTicks.length).toBe(world.config.shocks.length);
    }
  });
});

describe("config validation", () => {
  it("rejects malformed configurations with a precise message", () => {
    const good = makeConfig("first_light", 1);
    const bad = (patch: Partial<WorldConfig>) => () => validateConfig({ ...good, ...patch });
    expect(bad({ size: 5 })).toThrow(/size/);
    expect(bad({ population: 0 })).toThrow(/population/);
    expect(bad({ richness: 1.5 })).toThrow(/richness/);
    expect(bad({ seasonDays: [10, 10, 10] as unknown as [number, number, number, number] })).toThrow(/seasonDays/);
    expect(bad({ startDay: 40 })).toThrow(/startDay/);
    expect(bad({ policy: "llm" as unknown as "reflex" })).toThrow(/policy/);
    expect(bad({ institutions: "always" as unknown as "off" })).toThrow(/institutions/);
    expect(bad({ escrow: 1 as unknown as boolean })).toThrow(/escrow/);
    expect(() => makeConfig("no_such_scenario", 1)).toThrow(/Unknown scenario/);
  });
});

describe("calendar and climate", () => {
  const cfg = makeConfig("first_light", 1);

  it("maps ticks to days, seasons and years", () => {
    expect(calendarAt(cfg, 0)).toMatchObject({ day: 0, tickOfDay: 0, season: 0, seasonDay: 0, year: 0 });
    expect(calendarAt(cfg, 10 * TICKS_PER_DAY)).toMatchObject({ day: 10, season: 1, seasonDay: 0 });
    expect(calendarAt(cfg, 39 * TICKS_PER_DAY + 95)).toMatchObject({ day: 39, season: 3, seasonDay: 9, tickOfDay: 95 });
    expect(calendarAt(cfg, 40 * TICKS_PER_DAY)).toMatchObject({ season: 0, year: 1, yearDay: 0 });
    const lw = makeConfig("long_winter", 1);
    expect(calendarAt(lw, 0)).toMatchObject({ season: 1, seasonDay: 4 });
    // 16-day winter: day 12 after the start is yearDay 24 = first day of winter
    expect(calendarAt(lw, 12 * TICKS_PER_DAY)).toMatchObject({ season: 3, seasonDay: 0, seasonLength: 16 });
  });

  it("summer is warmer than winter and severity deepens only the winter", () => {
    const summer = seasonalMean(cfg, 0.375);
    const winter = seasonalMean(cfg, 0.875);
    expect(summer).toBeGreaterThan(220);
    expect(winter).toBeLessThan(40);
    const harsh = makeConfig("first_light", 1, { winterSeverity: 1500 });
    expect(seasonalMean(harsh, 0.875)).toBeLessThan(winter - 40);
    expect(seasonalMean(harsh, 0.375)).toBe(summer);
  });

  it("days are longest in summer and nights are dark", () => {
    expect(dayLength(0.375)).toBeGreaterThan(dayLength(0.875) + 15);
    expect(daylight(0.375, 26)).toBe(1000);
    expect(daylight(0.875, 80)).toBe(0);
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      const l = daylight(0.5, t);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1000);
    }
  });

  it("weather follows the seasonal mix, snows only when cold, and obeys drought", () => {
    const world = createWorld(makeConfig("first_light", 21));
    world.climate = initialClimate(world.config);
    const seen = new Array<number>(5).fill(0);
    for (let t = 0; t < 40 * TICKS_PER_DAY; t++) {
      world.tick = t;
      updateClimate(world);
      seen[world.climate.weather]!++;
      if (world.climate.weather === Weather.snow) expect(world.climate.temp).toBeLessThan(15);
      expect(world.climate.wet).toBeGreaterThanOrEqual(0);
      expect(world.climate.wet).toBeLessThanOrEqual(1000);
    }
    expect(seen[Weather.clear]!).toBeGreaterThan(seen[Weather.storm]!);
    expect(seen[Weather.rain]! + seen[Weather.snow]!).toBeGreaterThan(200);

    const dry = createWorld(makeConfig("first_light", 21));
    dry.climate.droughtUntil = 10 * TICKS_PER_DAY;
    for (let t = 0; t < 10 * TICKS_PER_DAY; t++) {
      dry.tick = t;
      updateClimate(dry);
      expect([Weather.clear, Weather.overcast]).toContain(dry.climate.weather);
    }
  });
});
