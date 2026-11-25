import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeConfig, SCENARIOS } from "../model/config";
import { ITEM_COUNT, Item, NodeKind, RECIPES, Skill, StructureKind, TICKS_PER_DAY, Water } from "../model/constants";
import type { Agent, Intent, SimEvent, WorldState } from "../model/types";
import { createWorld } from "../world/create";
import { SnapshotError, cloneWorld, forkWorld, restoreWorld, serializeWorld, snapshotHash, worldDigest } from "../save/snapshot";
import { registerMigrationForTests } from "../save/migrate";
import { SCHEMA_VERSION } from "../version";
import { applyIntervention } from "./environment";
import { auditGoods, totalGoods } from "./inventory";
import { scratchOf } from "./scratch";
import { run, step } from "./step";

function advance(world: WorldState, ticks: number, onTick?: (events: SimEvent[]) => void): SimEvent[] {
  const all: SimEvent[] = [];
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(world, out);
    if (onTick) onTick(out);
    for (const e of out) all.push(e);
    out.length = 0;
  }
  return all;
}

/** Keep an agent comfortable so the reflex layer has nothing urgent to do. */
function comfort(a: Agent): void {
  a.energy = 1000;
  a.hydration = 1000;
  a.rest = 1000;
  a.warmth = 1000;
  a.health = 1000;
}

/** Give an agent exactly this plan, labelled so that it is not interrupted. */
function assign(a: Agent, intents: Intent[]): void {
  a.act = null;
  a.asleep = false;
  a.queue = intents;
  a.progress = 0;
  a.path = [];
  a.pathKey = -1;
  a.mind.goal = "test";
  a.mind.urgentAt = "";
}

function smallWorld(seed = 5, population = 4): WorldState {
  const world = createWorld(makeConfig("first_light", seed, { population, policy: "reflex", illness: 0 }));
  for (const a of world.agents) comfort(a);
  return world;
}

function invariantsHold(world: WorldState): string | null {
  const audit = auditGoods(world);
  if (audit) return audit;
  const t = world.terrain;
  for (const a of world.agents) {
    for (const [name, v] of [["energy", a.energy], ["hydration", a.hydration], ["rest", a.rest], ["warmth", a.warmth]] as const) {
      if (!Number.isInteger(v) || v < 0 || v > 1000) return `agent ${a.id} ${name}=${v}`;
    }
    if (!Number.isInteger(a.health) || a.health > 1000) return `agent ${a.id} health=${a.health}`;
    if (a.alive && a.health <= 0) return `agent ${a.id} alive with health ${a.health}`;
    if (!a.alive && (a.act !== null || a.queue.length !== 0)) return `dead agent ${a.id} still acting`;
    if (a.x < 0 || a.y < 0 || a.x >= t.w || a.y >= t.h) return `agent ${a.id} out of bounds`;
    if ((t.moveCost[a.y * t.w + a.x] as number) === 0) return `agent ${a.id} on impassable tile`;
    for (const s of a.skills) if (s < 0 || s > 1000) return `agent ${a.id} skill ${s}`;
    if (a.shelter >= 0 && !a.asleep) return `agent ${a.id} occupies a shelter while awake`;
  }
  for (const s of world.structures) {
    if (s.occupants < 0 || s.occupants > 4) return `structure ${s.id} occupants ${s.occupants}`;
    if (s.fuel < 0) return `structure ${s.id} fuel ${s.fuel}`;
  }
  return null;
}

describe("phase 03 gate: fifty agents, a thousand ticks, deterministic replay", () => {
  it("runs 1,056 ticks with 50 agents and replays to the same digests and snapshot hash", () => {
    const cfg = makeConfig("first_light", 20261, { policy: "reflex" });
    const a = createWorld(cfg);
    const b = createWorld(cfg);
    expect(a.agents.length).toBe(50);
    const digestsA: string[] = [];
    const digestsB: string[] = [];
    let eventsA = 0;
    let eventsB = 0;
    for (let d = 0; d < 11; d++) {
      eventsA += advance(a, TICKS_PER_DAY).length;
      digestsA.push(worldDigest(a));
    }
    for (let d = 0; d < 11; d++) {
      eventsB += advance(b, TICKS_PER_DAY).length;
      digestsB.push(worldDigest(b));
    }
    expect(a.tick).toBe(1056);
    expect(digestsA).toEqual(digestsB);
    expect(eventsA).toBe(eventsB);
    expect(new Set(digestsA).size).toBe(11); // the world actually changes every day
    expect(snapshotHash(serializeWorld(a))).toBe(snapshotHash(serializeWorld(b)));
    expect(invariantsHold(a)).toBeNull();
    expect(a.agents.filter((x) => x.alive).length).toBeGreaterThan(40);
  });

  it("pins the reference run so unintended behaviour changes are noticed", () => {
    const world = createWorld(makeConfig("first_light", 1, { policy: "reflex" }));
    run(world, 2 * TICKS_PER_DAY);
    // Updating this value is a deliberate act: bump ENGINE_VERSION when you do.
    // 0.2.0: reference ecology retuned (D-014), sleep rule, social bookkeeping.
    expect(worldDigest(world)).toMatchInlineSnapshot(`"05f6cc416c7e9a87"`);
  });

  it("pins the reference run of the planner baseline as well", () => {
    const world = createWorld(makeConfig("first_light", 1, { policy: "planner" }));
    run(world, 2 * TICKS_PER_DAY);
    expect(worldDigest(world)).toMatchInlineSnapshot(`"d7e94493f6d53af6"`);
  });

  it("event streams are identical across replays, with sequential ids and valid causal parents", () => {
    const cfg = makeConfig("dry_year", 77, { policy: "reflex" });
    const e1 = advance(createWorld(cfg), 400);
    const e2 = advance(createWorld(cfg), 400);
    expect(e1.length).toBeGreaterThan(500);
    expect(JSON.stringify(e1)).toBe(JSON.stringify(e2));
    for (let i = 0; i < e1.length; i++) {
      const e = e1[i]!;
      expect(e.id).toBe(i);
      for (const p of e.p ?? []) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(e.id); // a cause always precedes its effect
      }
    }
    // every physical action traces back to a recorded decision
    const decisions = new Set(e1.filter((e) => e.k === "decision").map((e) => e.id));
    const acts = e1.filter((e) => ["gather", "eat", "drink"].includes(e.k));
    expect(acts.length).toBeGreaterThan(50);
    for (const e of acts) expect(e.p?.some((p) => decisions.has(p))).toBe(true);
  });
});

describe("snapshots", () => {
  it("save → restore → continue equals an uninterrupted run", () => {
    const cfg = makeConfig("first_light", 31, { policy: "reflex" });
    const straight = createWorld(cfg);
    run(straight, 700);

    const first = createWorld(cfg);
    run(first, 350);
    const text = serializeWorld(first);
    const resumed = restoreWorld(text);
    expect(serializeWorld(resumed)).toBe(text); // lossless
    run(resumed, 350);

    expect(worldDigest(resumed)).toBe(worldDigest(straight));
    expect(snapshotHash(serializeWorld(resumed))).toBe(snapshotHash(serializeWorld(straight)));
  });

  it("rejects corrupted, foreign, future and drifted snapshots with a specific error code", () => {
    const world = createWorld(makeConfig("first_light", 31, { population: 6 }));
    run(world, 50);
    const text = serializeWorld(world);
    const code = (fn: () => unknown): string => {
      try {
        fn();
      } catch (err) {
        return err instanceof SnapshotError ? err.code : `other:${String(err)}`;
      }
      return "accepted";
    };
    expect(code(() => restoreWorld(text.slice(0, text.length - 40)))).toBe("corrupt");
    expect(code(() => restoreWorld("{}"))).toBe("format");
    expect(code(() => restoreWorld('{"kind":"something-else","schema":1}'))).toBe("format");
    expect(code(() => restoreWorld(text.replace(`"schema":${SCHEMA_VERSION}`, '"schema":999')))).toBe("schema");
    // a snapshot whose config no longer regenerates its terrain must not load
    expect(code(() => restoreWorld(text.replace('"relief":1000', '"relief":1400')))).toBe("terrain_drift");
    expect(code(() => restoreWorld(text.replace('"population":6', '"population":-3')))).toBe("config");
    expect(code(() => restoreWorld(text))).toBe("accepted");
  });

  it("a flipped byte changes the content hash", () => {
    const world = createWorld(makeConfig("first_light", 31, { population: 6 }));
    const text = serializeWorld(world);
    const tampered = text.replace('"tick":0', '"tick":1');
    expect(tampered).not.toBe(text);
    expect(snapshotHash(tampered)).not.toBe(snapshotHash(text));
  });

  it("applies registered migrations in order", () => {
    const world = createWorld(makeConfig("first_light", 31, { population: 6 }));
    const text = serializeWorld(world).replace(`"schema":${SCHEMA_VERSION}`, '"schema":0');
    expect(() => restoreWorld(text)).toThrow(/no migration/);
    let ran = 0;
    const undo = registerMigrationForTests(0, (env) => {
      ran++;
      return { ...env, schema: 1 };
    });
    try {
      const restored = restoreWorld(text);
      expect(ran).toBe(1);
      expect(restored.agents.length).toBe(6);
    } finally {
      undo();
    }
  });
});

describe("branches", () => {
  const cfg = makeConfig("first_light", 12, { policy: "reflex" });

  it("a fork with common random numbers and no intervention retraces its parent exactly", () => {
    const parent = createWorld(cfg);
    run(parent, 300);
    const fork = forkWorld(parent, "b1", true);
    expect(fork.meta.branch).toMatchObject({ id: "b1", parent: "root", forkTick: 300, rngEpoch: 0 });
    expect(worldDigest(fork)).toBe(worldDigest(parent)); // identical past
    run(parent, 300);
    run(fork, 300);
    expect(worldDigest(fork)).toBe(worldDigest(parent));
  });

  it("an intervention makes the fork diverge while the parent is untouched", () => {
    const parent = createWorld(cfg);
    run(parent, 300);
    const before = worldDigest(parent);
    const fork = forkWorld(parent, "treated", true);
    const out: SimEvent[] = [];
    applyIntervention(fork, scratchOf(fork), out, { tick: fork.tick, kind: "blight", params: { magnitude: 1000 }, origin: "observer" });
    expect(out.some((e) => e.k === "intervention" && e.a === -2)).toBe(true);
    expect(fork.interventions.length).toBe(1);
    run(fork, 200);
    // no shared mutable state: stepping and mutating the fork leaves the parent bit-identical
    expect(worldDigest(parent)).toBe(before);
    expect(parent.interventions.length).toBe(0);
    run(parent, 200);
    expect(worldDigest(fork)).not.toBe(worldDigest(parent));
  });

  it("re-keying the branch gives an independent stochastic continuation", () => {
    const parent = createWorld(cfg);
    run(parent, 200);
    const independent = forkWorld(parent, "alt", false);
    expect(independent.meta.branch.rngEpoch).not.toBe(0);
    run(parent, 400);
    run(independent, 400);
    expect(worldDigest(independent)).not.toBe(worldDigest(parent));
  });

  it("cloneWorld shares nothing mutable", () => {
    const world = createWorld(makeConfig("first_light", 12, { population: 5 }));
    const copy = cloneWorld(world);
    copy.agents[0]!.inv[Item.wood] = 99;
    copy.nodes.amount[0] = 0;
    copy.agents[0]!.mind.nodeAmt[0] = 7;
    expect(world.agents[0]!.inv[Item.wood]).not.toBe(99);
    expect(world.agents[0]!.mind.nodeAmt[0]).toBe(-1);
    expect(copy.terrain).toBe(world.terrain); // immutable terrain is shared by reference
  });
});

describe("conservation and invariants (properties)", () => {
  it("every scenario keeps its books balanced on every tick", () => {
    for (const s of SCENARIOS) {
      const world = createWorld(makeConfig(s.id, 3, { policy: "reflex", population: 30 }));
      for (let t = 0; t < 4 * TICKS_PER_DAY; t++) {
        run(world, 1);
        const problem = invariantsHold(world);
        if (problem) throw new Error(`${s.id} tick ${world.tick}: ${problem}`);
      }
    }
  }, 120_000);

  it("holds for arbitrary seeds, sizes and knob settings", () => {
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 1, max: 999 }),
          population: fc.integer({ min: 1, max: 40 }),
          scenario: fc.constantFrom(...SCENARIOS.map((s) => s.id)),
          richness: fc.constantFrom(400, 1000, 1600),
          metabolism: fc.constantFrom(600, 1000, 1800),
          spoilage: fc.constantFrom(0, 1000, 3000),
          movementCost: fc.constantFrom(500, 1000, 2000),
          size: fc.constantFrom(32, 48, 64),
        }),
        ({ scenario, seed, ...knobs }) => {
          const world = createWorld(makeConfig(scenario, seed, { ...knobs, policy: "reflex" }));
          for (let block = 0; block < 6; block++) {
            run(world, 60);
            const problem = invariantsHold(world);
            if (problem) throw new Error(`tick ${world.tick}: ${problem}`);
          }
        },
      ),
      { numRuns: 14 },
    );
  }, 180_000);

  it("the dead keep nothing: their goods fall where they stood", () => {
    const world = smallWorld(8, 3);
    const victim = world.agents[0]!;
    victim.inv[Item.wood] = 5;
    world.metrics.sources[Item.wood] = (world.metrics.sources[Item.wood] as number) + 5; // declared for the test
    victim.health = 1;
    victim.hydration = 0;
    const events = advance(world, 2);
    expect(victim.alive).toBe(false);
    expect(events.find((e) => e.k === "death")).toMatchObject({ a: 0, r: "thirst" });
    expect(victim.inv.every((q) => q === 0)).toBe(true);
    const pile = world.piles.find((p) => p.x === victim.x && p.y === victim.y);
    expect(pile?.inv[Item.wood]).toBe(5);
    expect(auditGoods(world)).toBeNull();
    expect(world.metrics.deathsByCause.thirst).toBe(1);
  });
});

describe("invalid intents are rejected, never applied", () => {
  function tryIntent(intent: Intent, prepare?: (world: WorldState, a: Agent) => void): { world: WorldState; events: SimEvent[]; before: number[] } {
    const world = smallWorld(5, 3);
    const a = world.agents[0]!;
    if (prepare) prepare(world, a);
    const before = totalGoods(world);
    assign(a, [intent]);
    const events = advance(world, 1).filter((e) => e.a === 0);
    return { world, events, before };
  }
  const reasonOf = (events: SimEvent[]) => events.find((e) => e.k === "rejected")?.r;

  it.each([
    ["crafting without materials", { k: "craft", recipe: 0 }, "no_materials"],
    ["an unknown recipe", { k: "craft", recipe: 99 }, "unknown_recipe"],
    ["eating something that is not food", { k: "eat", item: Item.stone, qty: 1 }, "not_food"],
    ["eating food one does not have", { k: "eat", item: Item.ration, qty: 1 }, "no_item"],
    ["giving to oneself", { k: "give", to: 0, item: Item.berry, qty: 1 }, "self_target"],
    ["giving to nobody", { k: "give", to: 77, item: Item.berry, qty: 1 }, "malformed"],
    ["walking off the map", { k: "goto", x: 999, y: 3, near: 0 }, "bad_tile"],
    ["a negative quantity", { k: "drop", item: Item.berry, qty: -4 }, "malformed"],
    ["a fractional quantity", { k: "eat", item: Item.berry, qty: 1.5 }, "malformed"],
    ["a NaN quantity", { k: "gather", node: 0, qty: Number.NaN }, "malformed"],
    ["an infinite wait", { k: "wait", ticks: Number.POSITIVE_INFINITY }, "malformed"],
    ["a non-existent node", { k: "gather", node: 1_000_000, qty: 1 }, "malformed"],
    ["a non-existent structure", { k: "withdraw", structure: 5, item: Item.berry, qty: 1 }, "no_target"],
    ["an unknown verb", { k: "teleport", x: 1, y: 1 }, "unknown_intent"],
    ["a speech act the engine does not know", { k: "say", to: -1, act: { t: "command", text: "obey" } }, "unknown_speech_act"],
    ["endorsing a charter nobody has told you about", { k: "endorse", proposal: 0 }, "unknown_charter"],
  ] as const)("%s", (_name, intent, reason) => {
    const { world, events, before } = tryIntent(intent as unknown as Intent);
    expect(reasonOf(events)).toBe(reason);
    expect(totalGoods(world)).toEqual(before);
    expect(world.agents[0]!.queue.length + (world.agents[0]!.act ? 1 : 0)).toBeGreaterThanOrEqual(0);
    expect(auditGoods(world)).toBeNull();
  });

  it("cannot build on water or on a resource", () => {
    const world = smallWorld(5, 3);
    const a = world.agents[0]!;
    const t = world.terrain;
    // find a walkable tile next to the sea and aim the build at the sea tile
    let sea = -1;
    for (let i = 0; i < t.w * t.h && sea < 0; i++) {
      if (t.water[i] !== Water.sea) continue;
      const x = i % t.w;
      const y = (i - x) / t.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = (y + dy) * t.w + (x + dx);
        if (x + dx >= 0 && x + dx < t.w && y + dy >= 0 && y + dy < t.h && (t.moveCost[j] as number) > 0 && t.water[j] === Water.none) {
          a.x = x + dx;
          a.y = y + dy;
          sea = i;
          break;
        }
      }
    }
    expect(sea).toBeGreaterThanOrEqual(0);
    assign(a, [{ k: "build", kind: StructureKind.campfire, x: sea % t.w, y: Math.floor(sea / t.w) }]);
    const events = advance(world, 1).filter((e) => e.a === 0);
    expect(events.find((e) => e.k === "rejected")?.r).toBe("bad_tile");
    expect(world.structures.length).toBe(0);
  });

  it("clamps an over-large gift to what the giver actually holds", () => {
    const world = smallWorld(5, 3);
    const [a, b] = [world.agents[0]!, world.agents[1]!];
    b.x = a.x;
    b.y = a.y;
    const had = a.inv[Item.berry] as number;
    a.inv[Item.berry] = had + 2;
    world.metrics.sources[Item.berry] = (world.metrics.sources[Item.berry] as number) + 2;
    const give = (a.inv[Item.berry] as number) + 0;
    const bBefore = b.inv[Item.berry] as number;
    assign(a, [{ k: "give", to: 1, item: Item.berry, qty: 5000 }]);
    assign(b, [{ k: "wait", ticks: 3 }]);
    const events = advance(world, 1);
    const ev = events.find((e) => e.k === "give");
    expect(ev).toMatchObject({ a: 0, b: 1, i: Item.berry, q: give });
    expect(a.inv[Item.berry]).toBe(0);
    expect(b.inv[Item.berry]).toBe(bBefore + give);
    expect(b.mind.got[0]).toBeGreaterThan(0);
    expect(auditGoods(world)).toBeNull();
  });

  it("survives a storm of arbitrary intent objects without throwing or breaking invariants", () => {
    const junkNumber = fc.oneof(
      fc.integer({ min: -5, max: 80 }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1e12, 0.5, 2 ** 31),
    );
    const anything = fc.oneof(junkNumber, fc.string({ maxLength: 12 }), fc.boolean(), fc.constant(null), fc.constant(undefined));
    const kinds = ["goto", "explore", "gather", "eat", "drink", "fill", "rest", "wait", "craft", "build", "supply", "work", "refuel", "harvest", "give", "drop", "pickup", "deposit", "withdraw", "say", "inspect", "propose", "endorse", "motion", "vote", "leave", "pact_offer", "pact_accept", "nonsense"];
    const intentArb = fc.record({
      k: fc.oneof(fc.constantFrom(...kinds), anything),
      x: anything, y: anything, near: anything, node: anything, qty: anything, item: anything, ticks: anything,
      recipe: anything, kind: anything, structure: anything, to: anything, proposal: anything, motion: anything,
      institution: anything, yes: anything, pact: anything, give: anything, giveQty: anything, want: anything, wantQty: anything,
      charter: anything, text: anything,
      act: fc.oneof(anything, fc.record({ t: fc.oneof(fc.constantFrom("greet", "inform_node", "request", "offer", "promise", "free", "zzz"), anything), node: anything, amount: anything, tick: anything, item: anything, qty: anything, due: anything })),
    });
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 5 }), intentArb), { minLength: 20, maxLength: 60 }), (script) => {
        const world = createWorld(makeConfig("first_light", 9, { population: 6, policy: "reflex" }));
        const out: SimEvent[] = [];
        for (const [who, intent] of script) {
          const a = world.agents[who]!;
          if (a.alive && a.act === null) {
            a.queue = [intent as unknown as Intent];
            a.mind.goal = "test";
          }
          step(world, out);
          const problem = invariantsHold(world);
          if (problem) throw new Error(`tick ${world.tick}: ${problem} after ${JSON.stringify(intent)}`);
        }
      }),
      { numRuns: 40 },
    );
  }, 120_000);
});

describe("arbitration and action mechanics", () => {
  it("contested units go to each contender about equally often", () => {
    const world = smallWorld(4, 2);
    const [a, b] = [world.agents[0]!, world.agents[1]!];
    let node = -1;
    for (let n = 0; n < world.nodes.count; n++) {
      if (world.nodes.kind[n] === NodeKind.berry_bush) {
        node = n;
        break;
      }
    }
    expect(node).toBeGreaterThanOrEqual(0);
    const nx = world.nodes.x[node] as number;
    const ny = world.nodes.y[node] as number;
    const wins = [0, 0];
    let contested = 0;
    for (let round = 0; round < 400; round++) {
      for (const who of [a, b]) {
        who.x = nx;
        who.y = ny;
        who.inv = new Array<number>(ITEM_COUNT).fill(0);
        who.skills[Skill.forage] = 0;
        comfort(who);
        assign(who, [{ k: "gather", node, qty: 1 }]);
      }
      world.metrics.sources.fill(0);
      world.metrics.sinks.fill(0);
      world.piles.length = 0;
      world.nodes.amount[node] = 5;
      const events = advance(world, 3);
      // exactly one unit remains when both gather actions complete on the fourth tick
      // (set here so that overnight regrowth cannot add a second unit mid-round)
      world.nodes.amount[node] = 1;
      for (const e of advance(world, 1)) events.push(e);
      const got = events.filter((e) => e.k === "gather" && e.q === 1);
      expect(got.length).toBe(1);
      wins[got[0]!.a]!++;
      if (events.some((e) => e.k === "rejected" && e.r === "contested")) contested++;
    }
    expect(wins[0]! + wins[1]!).toBe(400);
    expect(wins[0]).toBeGreaterThan(160);
    expect(wins[0]).toBeLessThan(240);
    expect(contested).toBe(400); // the loser is told why, every time
  });

  it("moves only between adjacent walkable tiles and takes terrain time to do it", () => {
    const world = createWorld(makeConfig("first_light", 15, { policy: "reflex", population: 20 }));
    const prev = world.agents.map((a) => ({ x: a.x, y: a.y }));
    for (let t = 0; t < 600; t++) {
      run(world, 1);
      for (const a of world.agents) {
        const p = prev[a.id]!;
        expect(Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y))).toBeLessThanOrEqual(1);
        expect(world.terrain.moveCost[a.y * world.terrain.w + a.x]).toBeGreaterThan(0);
        p.x = a.x;
        p.y = a.y;
      }
    }
    expect(world.agents.reduce((s, a) => s + a.stats.distance, 0)).toBeGreaterThan(500);
  });

  it("builds a campfire from materials and labour, and the fire warms and burns down", () => {
    const world = smallWorld(6, 2);
    const a = world.agents[0]!;
    a.inv[Item.wood] = 3;
    a.inv[Item.stone] = 2;
    world.metrics.sources[Item.wood] = (world.metrics.sources[Item.wood] as number) + 3;
    world.metrics.sources[Item.stone] = (world.metrics.sources[Item.stone] as number) + 2;
    // choose a free neighbouring tile
    const w = world.terrain.w;
    let spot = -1;
    search: for (let r = 0; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = a.x + dx;
          const y = a.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= world.terrain.h) continue;
          const tile = y * w + x;
          if ((world.terrain.moveCost[tile] as number) > 0 && world.terrain.water[tile] === Water.none && world.nodes.atTile[tile] === -1) {
            spot = tile;
            break search;
          }
        }
      }
    }
    expect(spot).toBeGreaterThanOrEqual(0);
    assign(a, [{ k: "build", kind: StructureKind.campfire, x: spot % w, y: Math.floor(spot / w) }]);
    const events: SimEvent[] = [];
    for (let t = 0; t < 30 && !events.some((e) => e.k === "built"); t++) {
      comfort(a);
      for (const e of advance(world, 1)) events.push(e);
    }
    expect(events.map((e) => e.k)).toEqual(expect.arrayContaining(["found", "supply", "built"]));
    const fire = world.structures[0]!;
    expect(fire).toMatchObject({ kind: StructureKind.campfire, complete: true, founder: 0 });
    expect(fire.fuel).toBeGreaterThan(0);
    expect(a.inv[Item.wood]).toBe(0);
    expect(a.inv[Item.stone]).toBe(0);
    expect(auditGoods(world)).toBeNull(); // materials became a declared sink
    const fuelBefore = fire.fuel;
    advance(world, 5);
    expect(fire.fuel).toBeLessThan(fuelBefore);
    const until = advance(world, 60);
    expect(until.some((e) => e.k === "fire_out")).toBe(true);
  });

  it("crafts a tool, and the tool doubles the yield until it wears out", () => {
    const world = smallWorld(6, 2);
    const a = world.agents[0]!;
    const recipe = RECIPES.find((r) => r.name === "axe")!;
    for (const [item, qty] of recipe.inputs) {
      a.inv[item] = qty;
      world.metrics.sources[item] = (world.metrics.sources[item] as number) + qty;
    }
    assign(a, [{ k: "craft", recipe: recipe.id }]);
    let events: SimEvent[] = [];
    for (let t = 0; t < 20 && !events.some((e) => e.k === "craft"); t++) {
      comfort(a);
      events = events.concat(advance(world, 1));
    }
    expect(a.inv[Item.axe]).toBe(1);
    expect(a.toolUses[Item.axe]).toBeGreaterThan(0);
    for (const [item] of recipe.inputs) expect(a.inv[item]).toBe(0);
    expect(auditGoods(world)).toBeNull();
  });

  it("an agent cannot gather more than it can carry", () => {
    const world = smallWorld(6, 2);
    const a = world.agents[0]!;
    let node = -1;
    for (let n = 0; n < world.nodes.count; n++) if (world.nodes.kind[n] === NodeKind.stone_outcrop) node = n;
    expect(node).toBeGreaterThanOrEqual(0);
    a.x = world.nodes.x[node] as number;
    a.y = world.nodes.y[node] as number;
    a.inv = new Array<number>(ITEM_COUNT).fill(0);
    world.metrics.sources.fill(0);
    world.metrics.sinks.fill(0);
    for (const o of world.agents) if (o.id !== 0) o.inv = new Array<number>(ITEM_COUNT).fill(0);
    assign(a, [{ k: "gather", node, qty: 500 }]);
    let rejectedForLoad = false;
    for (let t = 0; t < 400 && !rejectedForLoad; t++) {
      comfort(a);
      if (a.queue.length === 0 && a.act === null) assign(a, [{ k: "gather", node, qty: 500 }]);
      rejectedForLoad = advance(world, 1).some((e) => e.a === 0 && e.k === "rejected" && e.r === "no_capacity");
    }
    expect(rejectedForLoad).toBe(true);
    // stone weighs 6 and capacity is at most 30 + 23: no more than eight stones fit
    expect(a.inv[Item.stone]).toBeGreaterThan(3);
    expect(a.inv[Item.stone]).toBeLessThanOrEqual(8);
  });
});

describe("knowledge is local", () => {
  it("an agent's beliefs cover only what it could have seen", () => {
    const world = createWorld(makeConfig("first_light", 23, { policy: "reflex", population: 12 }));
    const r = world.config.sightRadius;
    const couldSee: Set<number>[] = world.agents.map(() => new Set<number>());
    const nodes = world.nodes;
    for (let t = 0; t < 500; t++) {
      for (const a of world.agents) {
        if (!a.alive) continue;
        for (let n = 0; n < nodes.count; n++) {
          const dx = (nodes.x[n] as number) - a.x;
          const dy = (nodes.y[n] as number) - a.y;
          if (dx * dx + dy * dy <= r * r + r) couldSee[a.id]!.add(n);
        }
      }
      run(world, 1);
    }
    let known = 0;
    for (const a of world.agents) {
      for (let n = 0; n < nodes.count; n++) {
        if ((a.mind.nodeAmt[n] as number) !== -1) {
          known++;
          expect(couldSee[a.id]!.has(n)).toBe(true);
          expect(a.mind.nodeSrc[n]).toBe(-1); // nobody has spoken, so everything is first-hand
        }
      }
      // nobody knows the whole map after five days
      const seenTiles = a.mind.seen.reduce((s, byte) => s + (byte.toString(2).split("1").length - 1), 0);
      expect(seenTiles).toBeLessThan(world.terrain.w * world.terrain.h);
    }
    expect(known).toBeGreaterThan(50);
  });

  it("beliefs go stale: what an agent remembers can differ from the truth", () => {
    const world = createWorld(makeConfig("first_light", 23, { policy: "reflex" }));
    run(world, 6 * TICKS_PER_DAY);
    let stale = 0;
    for (const a of world.agents) {
      for (let n = 0; n < world.nodes.count; n++) {
        const believed = a.mind.nodeAmt[n] as number;
        if (believed !== -1 && believed !== world.nodes.amount[n]) stale++;
      }
    }
    expect(stale).toBeGreaterThan(20);
  });

  it("sleeping agents perceive nothing", () => {
    const world = smallWorld(6, 2);
    const a = world.agents[0]!;
    a.rest = 200; // tired enough to stay asleep (a fully rested agent wakes at once in daylight)
    assign(a, [{ k: "rest", ticks: 30 }]);
    advance(world, 1);
    expect(a.asleep).toBe(true);
    const before = Array.from(a.mind.seen);
    const b = world.agents[1]!;
    a.mind.metTick[1] = -1;
    b.x = a.x;
    b.y = a.y;
    advance(world, 3);
    expect(a.asleep).toBe(true);
    expect(Array.from(a.mind.seen)).toEqual(before);
    expect(a.mind.metTick[1]).toBe(-1);
  });
});
