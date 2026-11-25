/**
 * Initial population: invented names, trait and skill draws, starting positions and
 * empty minds. Fifty unrelated adults with no relationships and no shared history.
 */
import { clampInt } from "../core/math";
import { SeqRng, Stream, u32, below } from "../core/rng";
import type { WorldConfig } from "../model/config";
import { Biome, ITEM_COUNT, Item, PHYS_COUNT, SKILL_COUNT, TRAIT_COUNT, Trait, Water } from "../model/constants";
import { ACTIVITY_CLASSES, type Agent, type Mind, type Nodes, type Terrain } from "../model/types";

/** Room reserved in per-agent social arrays for newcomers who may arrive later. */
export const NEWCOMER_RESERVE = 24;
export function agentCapacity(cfg: WorldConfig): number {
  return cfg.population + NEWCOMER_RESERVE;
}

const ONSETS = ["", "b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "y", "z", "br", "dr", "sh", "th", "kr", "st", "el", "an", "or"];
const VOWELS = ["a", "e", "i", "o", "u", "ai", "ea", "ia", "oa", "au", "ei"];
const CODAS = ["", "", "", "n", "r", "l", "s", "m", "th", "k", "sh"];

/** Invented names assembled from neutral syllables; unique within a world. */
export function makeName(seed: number, id: number, taken: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const rng = new SeqRng(seed, Stream.Names, id * 64 + attempt);
    const syllables = 2 + (rng.below(100) < 28 ? 1 : 0);
    let s = "";
    for (let k = 0; k < syllables; k++) {
      const onset = rng.pick(ONSETS);
      const vowel = rng.pick(VOWELS);
      const coda = k === syllables - 1 ? rng.pick(CODAS) : rng.below(100) < 25 ? rng.pick(CODAS) : "";
      // avoid stacking a two-letter "onset" that starts with a vowel after a vowel
      s += (k > 0 && onset.length === 2 && "aeiou".includes(onset[0]!) ? onset[1]! : onset) + vowel + coda;
    }
    if (s.length < 3 || s.length > 9) continue;
    const name = s[0]!.toUpperCase() + s.slice(1);
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = `N${id}`;
  taken.add(fallback);
  return fallback;
}

function drawCentered(rng: SeqRng, mean: number, sd: number, lo: number, hi: number): number {
  return clampInt(Math.round(mean + sd * rng.normalish()), lo, hi);
}

export function emptyMind(cfg: WorldConfig, terrain: Terrain, nodes: Nodes, trustfulness: number): Mind {
  const cap = agentCapacity(cfg);
  const baseTrust = clampInt(300 + trustfulness * 4, 200, 760);
  return {
    seen: new Uint8Array((terrain.w * terrain.h + 7) >> 3),
    nodeAmt: new Int16Array(nodes.count).fill(-1),
    nodeTick: new Int32Array(nodes.count).fill(-1),
    nodeSrc: new Int16Array(nodes.count).fill(-1),
    nodeMax: new Int16Array(nodes.count),
    metX: new Uint8Array(cap),
    metY: new Uint8Array(cap),
    metTick: new Int32Array(cap).fill(-1),
    trust: new Int16Array(cap).fill(baseTrust),
    gave: new Int32Array(cap),
    got: new Int32Array(cap),
    kept: new Int16Array(cap),
    broke: new Int16Array(cap),
    lastTalk: new Int32Array(cap).fill(-1),
    structs: [],
    mem: [],
    commitments: [],
    charters: [],
    pacts: [],
    src: "baseline",
    inbox: [],
    goal: "start",
    why: "",
    urgentAt: "",
    lastDecision: -1,
    decisionEvent: -1,
    homeX: -1,
    homeY: -1,
    heading: 0,
    cool: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    coldNights: 0,
    hungerDays: 0,
    wintersSeen: 0,
    tempEma: 0,
    tempTrend: 0,
    tempSum: 0,
    tempN: 0,
    coldRun: 0,
    droughtSeen: -1,
    nextDeliberation: 0,
  };
}

export function createAgent(
  cfg: WorldConfig,
  terrain: Terrain,
  nodes: Nodes,
  id: number,
  x: number,
  y: number,
  taken: Set<string>,
): Agent {
  const rng = new SeqRng(cfg.seed, Stream.Traits, id);
  const div = cfg.diversity / 1000;
  const traits: number[] = [];
  for (let t = 0; t < TRAIT_COUNT; t++) traits.push(drawCentered(rng, 50, 19 * div, 2, 98));
  const phys: number[] = [];
  for (let p = 0; p < PHYS_COUNT; p++) phys.push(drawCentered(rng, 50, 15 * div, 5, 95));
  const skills: number[] = [];
  for (let s = 0; s < SKILL_COUNT; s++) skills.push(clampInt(Math.round(110 + 90 * div * rng.normalish()), 0, 420));
  const inv = new Array<number>(ITEM_COUNT).fill(0);
  inv[Item.berry] = rng.below(4);
  inv[Item.root] = rng.below(3);
  const stats = {
    activity: new Array<number>(ACTIVITY_CLASSES.length).fill(0),
    gathered: new Array<number>(ITEM_COUNT).fill(0),
    givenUnits: 0,
    givenWorth: 0,
    receivedUnits: 0,
    receivedWorth: 0,
    decisions: 0,
    rejected: 0,
    said: 0,
    distance: 0,
    welfareSum: 0,
    aliveTicks: 0,
  };
  const mind = emptyMind(cfg, terrain, nodes, traits[Trait.trustfulness] as number);
  mind.heading = rng.below(8);
  return {
    id,
    name: makeName(cfg.seed, id, taken),
    x,
    y,
    px: x,
    py: y,
    alive: true,
    diedTick: -1,
    deathCause: "",
    energy: 720 + rng.below(181),
    hydration: 720 + rng.below(181),
    rest: 850 + rng.below(151),
    warmth: 1000,
    health: 1000,
    ill: 0,
    asleep: false,
    shelter: -1,
    inv,
    toolUses: new Array<number>(ITEM_COUNT).fill(0),
    traits,
    phys,
    skills,
    // in a mixed population who deliberates is drawn per person, independently of everything else about them
    controller: cfg.policy === "planner" && (cfg.plannerShare >= 1000 || below(1000, cfg.seed, Stream.Policy, id, 1) < cfg.plannerShare) ? "planner" : "reflex",
    queue: [],
    act: null,
    path: [],
    pathKey: -1,
    progress: 0,
    stats,
    mind,
    memberships: 0,
  };
}

/** Distance (in 4-connected walking steps over land) from every tile to drinkable water. */
function distanceToFresh(terrain: Terrain): Int16Array {
  const { w: W, h: H } = terrain;
  const N = W * H;
  const dist = new Int16Array(N).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    if ((terrain.fresh[i] as number) > 0 && (terrain.moveCost[i] as number) > 0) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q] as number;
    const x = i % W;
    const y = (i - x) / W;
    const d = dist[i] as number;
    const tryPush = (j: number) => {
      if (dist[j] !== -1 || (terrain.moveCost[j] as number) === 0) return;
      dist[j] = d + 1;
      queue.push(j);
    };
    if (x > 0) tryPush(i - 1);
    if (x < W - 1) tryPush(i + 1);
    if (y > 0) tryPush(i - W);
    if (y < H - 1) tryPush(i + W);
  }
  return dist;
}

/** Choose starting tiles for `count` agents. */
export function spawnTiles(cfg: WorldConfig, terrain: Terrain, count: number, salt = 0): number[] {
  const { w: W, h: H } = terrain;
  const N = W * H;
  const dfresh = distanceToFresh(terrain);
  const candidates: { i: number; score: number }[] = [];
  for (let i = 0; i < N; i++) {
    if ((terrain.moveCost[i] as number) === 0) continue;
    if (terrain.water[i] !== Water.none) continue;
    if (terrain.biome[i] === Biome.highland) continue;
    const d = dfresh[i] as number;
    if (d < 0 || d > 9) continue;
    candidates.push({ i, score: u32(cfg.seed, Stream.Spawn, i, salt) });
  }
  if (candidates.length === 0) {
    // degenerate map: fall back to any walkable tile
    for (let i = 0; i < N; i++) {
      if ((terrain.moveCost[i] as number) > 0) candidates.push({ i, score: u32(cfg.seed, Stream.Spawn, i, salt) });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.i - b.i);
  const chosen: number[] = [];
  const used = new Uint8Array(N);

  if (cfg.spawn === "clustered") {
    const clusters = Math.max(1, Math.ceil(count / 8));
    const centres = candidates.slice(0, clusters).map((c) => c.i);
    let k = 0;
    // members are the closest unused candidates to their cluster centre
    while (chosen.length < count && k < count * 4) {
      const centre = centres[k % centres.length] as number;
      const cx = centre % W;
      const cy = (centre - cx) / W;
      let best = -1;
      let bestD = 1e9;
      for (const c of candidates) {
        if (used[c.i]) continue;
        const x = c.i % W;
        const y = (c.i - x) / W;
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy)) * 1000 + (c.score % 1000);
        if (d < bestD) {
          bestD = d;
          best = c.i;
        }
      }
      if (best < 0) break;
      used[best] = 1;
      chosen.push(best);
      k++;
    }
  } else {
    // dispersed: take candidates in keyed order, preferring tiles not adjacent to an earlier pick
    for (const pass of [1, 0]) {
      for (const c of candidates) {
        if (chosen.length >= count) break;
        if (used[c.i]) continue;
        if (pass === 1) {
          const x = c.i % W;
          const y = (c.i - x) / W;
          let crowded = false;
          for (let dy = -2; dy <= 2 && !crowded; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              if (used[yy * W + xx]) {
                crowded = true;
                break;
              }
            }
          }
          if (crowded) continue;
        }
        used[c.i] = 1;
        chosen.push(c.i);
      }
    }
  }
  // extremely small maps: allow sharing tiles
  let wrap = 0;
  while (chosen.length < count && candidates.length > 0) {
    chosen.push((candidates[wrap % candidates.length] as { i: number }).i);
    wrap++;
  }
  return chosen;
}

export function createPopulation(cfg: WorldConfig, terrain: Terrain, nodes: Nodes): Agent[] {
  const tiles = spawnTiles(cfg, terrain, cfg.population);
  const taken = new Set<string>();
  const agents: Agent[] = [];
  for (let id = 0; id < cfg.population; id++) {
    const tile = tiles[id] ?? tiles[0] ?? 0;
    const x = tile % terrain.w;
    const y = (tile - x) / terrain.w;
    agents.push(createAgent(cfg, terrain, nodes, id, x, y, taken));
  }
  return agents;
}
