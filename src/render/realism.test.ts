/**
 * What D-054 promises of the renderer that can be checked without a graphics context: that the
 * stand-ins for the shadow map are there and are swapped in only while it is drawn, that grass
 * thins with distance and comes back, that the shade under a tree goes with the tree, that the
 * sky is narrower in a stream bed than on open ground, and that the small textures repeat.
 */
import type { BufferAttribute, BufferGeometry, InstancedMesh } from "three";
import { describe, expect, it } from "vitest";
import { createWorld, makeConfig } from "@/engine";
import type { StaticWorldView } from "@/worker/protocol";
import { DETAIL_SIZE, buildDetail, detailMeans, detailTexels, tileCells, tileFbm } from "./detail";
import { CROWNS_FULL_WITHIN, CROWNS_PLAIN_BEYOND, GRASS_FAR, GRASS_FAR_SHARE, GRASS_NEAR, buildFlora, grassShare } from "./flora";
import { HeightField, SUBDIV } from "./heightfield";
import { buildTerrain } from "./terrain";

const TREE = 2;

function viewOf(seed: number): StaticWorldView {
  const world = createWorld(makeConfig("first_light", seed, { size: 32, population: 4 }));
  const t = world.terrain;
  const n = world.nodes;
  return {
    config: world.config,
    configHash: world.meta.configHash,
    terrainHash: t.hash,
    engine: world.meta.engine,
    affordances: world.meta.affordances,
    branchId: world.meta.branch.id,
    w: t.w,
    h: t.h,
    height: t.height,
    water: t.water,
    biome: t.biome,
    fertility: t.fertility,
    fresh: t.fresh,
    flow: t.flow,
    nodeKind: n.kind.slice(0, n.count),
    nodeX: n.x.slice(0, n.count),
    nodeY: n.y.slice(0, n.count),
    nodeCap: n.cap.slice(0, n.count),
    agents: [],
    // how many people the world can ever hold (the view gained it with engine 0.8.0; the figures are sized by it)
    capacity: world.config.population + 24,
  } as StaticWorldView;
}

const view = viewOf(1);
const field = new HeightField(view);
const full = Int16Array.from(view.nodeCap);

describe("the small repeating textures", () => {
  it("repeat exactly, so that no seam shows where one copy meets the next", () => {
    for (const [u, v] of [[0.13, 0.71], [0.5, 0.02], [0.98, 0.44]] as const) {
      expect(tileFbm(u + 1, v, 8, 4, 3)).toBeCloseTo(tileFbm(u, v, 8, 4, 3), 10);
      expect(tileFbm(u, v + 1, 8, 4, 3)).toBeCloseTo(tileFbm(u, v, 8, 4, 3), 10);
      expect(tileCells(u + 1, v + 1, 9, 23).d).toBeCloseTo(tileCells(u, v, 9, 23).d, 10);
    }
  });

  it("are level on average, and say what their averages are", () => {
    const texels = detailTexels();
    const means = detailMeans();
    for (const key of ["ground", "leaves", "ripples"] as const) {
      expect(texels[key].length).toBe(DETAIL_SIZE * DETAIL_SIZE * 4);
      // the slope channels average to level: seen from far away the detail tilts nothing
      expect(means[key][0]).toBeGreaterThan(0.48);
      expect(means[key][0]).toBeLessThan(0.52);
      expect(means[key][1]).toBeGreaterThan(0.48);
      expect(means[key][1]).toBeLessThan(0.52);
      // and the stated mean of the height is the mean of its texels
      let sum = 0;
      for (let i = 2; i < texels[key].length; i += 4) sum += texels[key][i] as number;
      expect(means[key][2]).toBeCloseTo(sum / (DETAIL_SIZE * DETAIL_SIZE) / 255, 6);
    }
  });

  it("are computed once and shared by every world drawn", () => {
    expect(detailTexels()).toBe(detailTexels());
    const a = buildDetail();
    const b = buildDetail();
    expect(a.ground.image.data).toBe(b.ground.image.data);
    a.dispose();
    b.dispose();
  });
});

describe("the sky over the ground", () => {
  it("is narrower in a stream bed than on open land, and never more than whole", () => {
    const sky = field.openness();
    let bed = 0;
    let beds = 0;
    let open = 0;
    let opens = 0;
    for (let i = 0; i < sky.length; i++) {
      expect(sky[i]).toBeGreaterThan(0);
      expect(sky[i]).toBeLessThanOrEqual(1);
      if ((field.ground[i] as number) < 0.1) continue;
      if ((field.wetMask[i] as number) > 0.9) {
        bed += sky[i] as number;
        beds++;
      } else if ((field.wetMask[i] as number) === 0) {
        open += sky[i] as number;
        opens++;
      }
    }
    expect(beds).toBeGreaterThan(0);
    expect(bed / beds).toBeLessThan(open / opens - 0.05);
    expect(field.openness()).toBe(sky);
  });
});

describe("what stands on the ground", () => {
  const detail = buildDetail();
  const flora = buildFlora(view, field, "high", detail);
  const mesh = (name: string) => flora.objects.find((o) => o.name === name) as InstancedMesh;
  const triangles = (g: BufferGeometry, start: number, count: number) => Math.min(count, g.index!.count - start) / 3;

  it("casts its shadow with a coarse stand-in, swapped in only while the shadow map is drawn", () => {
    for (const name of ["flora-canopyA", "flora-canopyB", "flora-canopyC", "flora-bush", "flora-rock"]) {
      const m = mesh(name);
      const g = m.geometry;
      const range = g.userData.shadowRange as { start: number; count: number };
      expect(range, name).toBeDefined();
      // the picture draws everything before the stand-in, and nothing of it
      expect(g.drawRange.start).toBe(0);
      expect(g.drawRange.count).toBe(range.start);
      expect(range.start + range.count).toBe(g.index!.count);
      expect(triangles(g, range.start, range.count)).toBeLessThanOrEqual(triangles(g, 0, range.start) / 3);
      // three.js calls these two around the mesh's draw into the shadow map
      const call = [null, m, null, null, g, null, null] as unknown as Parameters<InstancedMesh["onBeforeShadow"]>;
      m.onBeforeShadow(...call);
      expect(g.drawRange.start).toBe(range.start);
      expect(g.drawRange.count).toBe(range.count);
      m.onAfterShadow(...call);
      expect(g.drawRange.start).toBe(0);
      expect(g.drawRange.count).toBe(range.start);
    }
  });

  it("has no stand-ins on the low preset, where nothing casts a shadow", () => {
    const low = buildFlora(view, field, "low", detail);
    for (const o of low.objects) expect((o as InstancedMesh).geometry.userData.shadowRange, o.name).toBeUndefined();
    low.dispose();
  });

  it("draws all its grass from near and a stated share of it from far, and the same again on coming back", () => {
    expect(grassShare(GRASS_NEAR - 1)).toBe(1);
    expect(grassShare(GRASS_FAR + 1)).toBe(GRASS_FAR_SHARE);
    expect(grassShare((GRASS_NEAR + GRASS_FAR) / 2)).toBeCloseTo((1 + GRASS_FAR_SHARE) / 2, 6);
    const grass = mesh("flora-grass");
    flora.setDistance(10);
    const all = grass.count;
    expect(all).toBeGreaterThan(50);
    flora.setDistance(GRASS_FAR * 2);
    expect(grass.count).toBe(Math.round(all * GRASS_FAR_SHARE));
    flora.setDistance(10);
    expect(grass.count).toBe(all);
  });

  it("wears a plainer form from far away, with a stand-in of its own, and the full one again from near", () => {
    for (const name of ["flora-canopyA", "flora-canopyB", "flora-canopyC", "flora-bush"]) {
      const m = mesh(name);
      flora.setDistance(CROWNS_FULL_WITHIN - 1);
      const near = m.geometry;
      const nearTriangles = near.drawRange.count / 3;
      flora.setDistance(CROWNS_PLAIN_BEYOND + 1);
      const farGeometry = m.geometry;
      expect(farGeometry, name).not.toBe(near);
      expect(farGeometry.drawRange.count / 3).toBeLessThanOrEqual(nearTriangles / 2);
      const range = farGeometry.userData.shadowRange as { start: number; count: number };
      expect(farGeometry.drawRange.count).toBe(range.start);
      // the hooks follow the geometry the mesh wears now
      const call = [null, m, null, null, farGeometry, null, null] as unknown as Parameters<InstancedMesh["onBeforeShadow"]>;
      m.onBeforeShadow(...call);
      expect(farGeometry.drawRange.start).toBe(range.start);
      m.onAfterShadow(...call);
      expect(farGeometry.drawRange.start).toBe(0);
      // between the two distances nothing changes, whichever side it was approached from
      flora.setDistance((CROWNS_FULL_WITHIN + CROWNS_PLAIN_BEYOND) / 2);
      expect(m.geometry).toBe(farGeometry);
      flora.setDistance(CROWNS_FULL_WITHIN - 1);
      expect(m.geometry).toBe(near);
      flora.setDistance((CROWNS_FULL_WITHIN + CROWNS_PLAIN_BEYOND) / 2);
      expect(m.geometry).toBe(near);
    }
  });

  it("shades the ground beneath a tree for as long as the tree stands", () => {
    flora.setAmounts(full);
    const before = flora.takeShade();
    expect(before).not.toBeNull();
    const shaded = Uint8Array.from(before!);
    // nothing changed: nothing to take
    flora.setAmounts(full);
    expect(flora.takeShade()).toBeNull();

    // the tree standing farthest from any other tree, so that only its own shade lies under it
    const trees: number[] = [];
    for (let n = 0; n < view.nodeKind.length; n++) if (view.nodeKind[n] === TREE) trees.push(n);
    expect(trees.length).toBeGreaterThan(1);
    let lone = trees[0]!;
    let far = -1;
    for (const a of trees) {
      let nearest = Infinity;
      for (const b of trees) if (b !== a) nearest = Math.min(nearest, Math.hypot(view.nodeX[a]! - view.nodeX[b]!, view.nodeY[a]! - view.nodeY[b]!));
      if (nearest > far) {
        far = nearest;
        lone = a;
      }
    }
    const anchor = flora.nodeAnchor(lone);
    const around = (grid: Uint8Array): number => {
      let most = 0;
      const gx = Math.round((anchor.x + view.w / 2) * SUBDIV);
      const gz = Math.round((anchor.z + view.h / 2) * SUBDIV);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) most = Math.max(most, grid[(gz + dz) * field.sw + gx + dx] ?? 0);
      return most;
    };
    expect(around(shaded)).toBeGreaterThan(100);

    // felled to the last log
    const felled = Int16Array.from(full);
    felled[lone] = 0;
    flora.setAmounts(felled);
    const after = flora.takeShade();
    expect(after).not.toBeNull();
    if (far > 2) expect(around(after!)).toBe(0);
    else expect(around(after!)).toBeLessThan(around(shaded));

    // and grown back
    flora.setAmounts(full);
    expect(Array.from(flora.takeShade()!)).toEqual(Array.from(shaded));
  });

  it("is carried onto the land as a dimmer sky, and lifted again", () => {
    const terrain = buildTerrain(view, field, "high", detail);
    const bake = terrain.mesh.geometry.getAttribute("aBake") as BufferAttribute;
    const sky = field.openness();
    // a sample of open land
    let i = 0;
    for (let k = 0; k < sky.length; k++) {
      if ((field.ground[k] as number) > 0.5 && (sky[k] as number) > 0.9) {
        i = k;
        break;
      }
    }
    const open = bake.getX(i);
    expect(open).toBeCloseTo(sky[i] as number, 1);
    const version = bake.version;
    const shade = new Uint8Array(sky.length);
    shade[i] = 255;
    terrain.setShade(shade);
    expect(bake.version).toBeGreaterThan(version);
    expect(bake.getX(i)).toBeLessThan(open * 0.6);
    expect(bake.getX(i)).toBeGreaterThan(open * 0.35);
    terrain.setShade(new Uint8Array(sky.length));
    expect(bake.getX(i)).toBeCloseTo(open, 5);
    terrain.dispose();
  });
});
