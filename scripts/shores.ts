/**
 * Two Shores, measured: what lies on each side of the strait, and what becomes of the people
 * who start there.
 *
 *   pnpm exec tsx scripts/shores.ts [--seeds 1-12] [--days 40] [--set key=value ...]
 *
 * For each seed: resource nodes per shore by kind, and of the people who began on each shore
 * how many are alive at the end, how many ever crossed the ford, and what they died of. The
 * two shores are the two largest land regions; "A" is the one the scenario makes poor in
 * timber and food when `shoreSplit` is on (otherwise simply the western one).
 */
import { NODE_KINDS, TICKS_PER_DAY, createWorld, makeConfig, shoreSides, step, type SimEvent, type WorldConfig } from "../src/engine";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
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

const [from, to] = arg("seeds", "1-12").split("-").map(Number) as [number, number];
const days = Number(arg("days", "40"));
const kinds = ["berry_bush", "root_patch", "tree", "reed_bed", "stone_outcrop", "clay_bank", "fishing_water"] as const;
const short: Record<string, string> = { berry_bush: "berry", root_patch: "root", tree: "tree", reed_bed: "reed", stone_outcrop: "stone", clay_bank: "clay", fishing_water: "fish" };

console.log(`two_shores, ${days} days, seeds ${from}-${to}, overrides ${JSON.stringify(overrides())}`);
console.log(`seed | shore A nodes ${kinds.map((k) => short[k]).join("/")} | shore B nodes | A: start alive crossed | B: start alive crossed | deaths A | deaths B`);
const total = { a0: 0, a1: 0, b0: 0, b1: 0, ax: 0, bx: 0 };
for (let seed = from; seed <= (to ?? from); seed++) {
  const world = createWorld(makeConfig("two_shores", seed, overrides()));
  const t = world.terrain;
  const sides = shoreSides(world.config, t);
  const nodes = [new Array<number>(NODE_KINDS.length).fill(0), new Array<number>(NODE_KINDS.length).fill(0)];
  for (let n = 0; n < world.nodes.count; n++) {
    const tile = (world.nodes.y[n] as number) * t.w + (world.nodes.x[n] as number);
    let side = sides.side[tile] as number;
    if (side === 0) {
      // fishing water has no region of its own: it belongs to the shore it touches
      for (const d of [-1, 1, -t.w, t.w]) {
        const j = tile + d;
        if (j >= 0 && j < t.w * t.h && (sides.side[j] as number) > 0) side = sides.side[j] as number;
      }
    }
    if (side > 0) nodes[side - 1]![world.nodes.kind[n] as number]!++;
  }
  const home = world.agents.map((a) => sides.side[a.y * t.w + a.x] as number);
  const crossed = world.agents.map(() => false);
  const cause: Record<string, number>[] = [{}, {}];
  const out: SimEvent[] = [];
  for (let tick = 0; tick < days * TICKS_PER_DAY; tick++) {
    step(world, out);
    for (const e of out) {
      if (e.k === "death") {
        const h = home[e.a] as number;
        if (h > 0) cause[h - 1]![e.r ?? "?"] = (cause[h - 1]![e.r ?? "?"] ?? 0) + 1;
      }
    }
    out.length = 0;
    if (tick % 8 === 0) {
      for (const a of world.agents) {
        if (!a.alive) continue;
        const s = sides.side[a.y * t.w + a.x] as number;
        if (s > 0 && s !== home[a.id]) crossed[a.id] = true;
      }
    }
  }
  const count = (side: number, pred: (id: number) => boolean): number => world.agents.filter((a) => home[a.id] === side && pred(a.id)).length;
  const a0 = count(1, () => true);
  const b0 = count(2, () => true);
  const a1 = count(1, (id) => world.agents[id]!.alive);
  const b1 = count(2, (id) => world.agents[id]!.alive);
  const ax = count(1, (id) => crossed[id] as boolean);
  const bx = count(2, (id) => crossed[id] as boolean);
  total.a0 += a0;
  total.a1 += a1;
  total.b0 += b0;
  total.b1 += b1;
  total.ax += ax;
  total.bx += bx;
  const list = (k: number[]): string => kinds.map((name) => k[NODE_KINDS.indexOf(name)]).join("/");
  const why = (c: Record<string, number>): string =>
    Object.entries(c)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "none";
  console.log(`${String(seed).padStart(4)} | ${list(nodes[0]!)} | ${list(nodes[1]!)} | ${a0} ${a1} ${ax} | ${b0} ${b1} ${bx} | ${why(cause[0]!)} | ${why(cause[1]!)}`);
}
const pct = (a: number, b: number): string => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
console.log(`all seeds: shore A ${total.a1} of ${total.a0} alive (${pct(total.a1, total.a0)}), ${total.ax} crossed; shore B ${total.b1} of ${total.b0} alive (${pct(total.b1, total.b0)}), ${total.bx} crossed`);
