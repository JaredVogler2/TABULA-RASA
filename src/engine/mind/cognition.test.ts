import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, parseCanonical } from "../core/canonical";
import { makeConfig } from "../model/config";
import { Item, NodeKind, TICKS_PER_DAY, Trait, Water } from "../model/constants";
import type { Agent, Intent, SimEvent, WorldState } from "../model/types";
import { restoreWorld, serializeWorld } from "../save/snapshot";
import { indexAgents, scratchOf } from "../sim/scratch";
import { step } from "../sim/step";
import { createWorld } from "../world/create";
import { dueForDecision, observe, replayTape, submitDecision, tapeFromEvents, type DecisionRecord } from "./external";
import { mockDecision } from "./mock";
import { DECISION_LIMITS } from "./observe";
import { goodwill, planDecide, restraint, stockDays } from "./planner";
import { visibleAgents } from "./senses";
import { TRUST_DELTA } from "./social";

// ───────────────────────── helpers

function comfort(a: Agent): void {
  a.energy = 950;
  a.hydration = 950;
  a.rest = 1000;
  a.warmth = 1000;
  a.health = 1000;
}

function hold(a: Agent, intents: Intent[] = [{ k: "wait", ticks: 48 }]): void {
  a.act = null;
  a.asleep = false;
  a.queue = intents;
  a.progress = 0;
  a.path = [];
  a.pathKey = -1;
  a.mind.goal = "test";
  a.mind.urgentAt = "";
}

/** A small daylight world whose people stand shoulder to shoulder on dry land near agent 0. */
function huddle(population: number, seed = 21): WorldState {
  // institutions off: these tests are about one mind's own repertoire, without charters or offers
  const world = createWorld(makeConfig("first_light", seed, { population, illness: 0, startDay: 12, institutions: "off" }));
  const t = world.terrain;
  const a0 = world.agents[0]!;
  const spots: [number, number][] = [];
  for (let r = 0; r <= 3 && spots.length < population; r++) {
    for (let dy = -r; dy <= r && spots.length < population; dy++) {
      for (let dx = -r; dx <= r && spots.length < population; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = a0.x + dx;
        const y = a0.y + dy;
        if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue;
        const tile = y * t.w + x;
        if ((t.moveCost[tile] as number) === 0 || t.water[tile] !== Water.none) continue;
        spots.push([x, y]);
      }
    }
  }
  expect(spots.length).toBe(population);
  world.agents.forEach((a, i) => {
    a.x = a.px = spots[i]![0];
    a.y = a.py = spots[i]![1];
    comfort(a);
    hold(a);
    a.mind.tempEma = 200; // a warm day: nobody is thinking about winter
    a.mind.trust.fill(500);
  });
  // make it mid-morning so that sight and daylight rules are not the thing under test
  world.climate.light = 1000;
  indexAgents(world, scratchOf(world));
  return world;
}

function advance(world: WorldState, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(world, out);
    for (const e of out) all.push(e);
    out.length = 0;
  }
  return all;
}

function forgetPlaces(a: Agent): void {
  a.mind.nodeAmt.fill(-1);
  a.mind.nodeTick.fill(-1);
  a.mind.nodeSrc.fill(-1);
  a.mind.nodeMax.fill(0);
}

/** Make `a` believe, first-hand and freshly, that the nearest node of `kind` holds `amount`. */
function believe(world: WorldState, a: Agent, kind: number, amount: number, full = amount): number {
  let best = -1;
  let bestD = 1e9;
  for (let n = 0; n < world.nodes.count; n++) {
    if (world.nodes.kind[n] !== kind) continue;
    const d = Math.max(Math.abs((world.nodes.x[n] as number) - a.x), Math.abs((world.nodes.y[n] as number) - a.y));
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  expect(best).toBeGreaterThanOrEqual(0);
  a.mind.nodeAmt[best] = amount;
  a.mind.nodeTick[best] = world.tick;
  a.mind.nodeSrc[best] = -1;
  a.mind.nodeMax[best] = full;
  return best;
}

function decide(world: WorldState, a: Agent) {
  a.queue = [];
  a.act = null;
  return planDecide(world, scratchOf(world), a);
}

// ───────────────────────── tests

describe("distinct agents behave differently for documented reasons", () => {
  it("generosity decides who feeds a visibly starving neighbour", () => {
    const plans = [90, 10].map((generosity) => {
      const world = huddle(2);
      const [a, b] = world.agents as [Agent, Agent];
      a.traits[Trait.generosity] = generosity;
      a.inv[Item.berry] = 12;
      b.energy = 200; // visibly suffering
      return decide(world, a);
    });
    expect(plans[0]?.goal).toBe("give");
    expect(plans[0]?.why).toBe("they_look_hungry");
    expect(plans[0]?.intents[0]).toMatchObject({ k: "give", to: 1 });
    expect(plans[1]?.goal).not.toBe("give");
  });

  it("goodwill rises with trust and with favours received, and falls after a broken promise", () => {
    const world = huddle(2);
    const [a] = world.agents as [Agent, Agent];
    a.traits[Trait.generosity] = 50;
    const base = goodwill(a, 1);
    a.mind.trust[1] = 900;
    expect(goodwill(a, 1)).toBeGreaterThan(base);
    a.mind.trust[1] = 500;
    a.mind.got[1] = 200; // I owe them
    expect(goodwill(a, 1)).toBeGreaterThan(base);
    a.mind.got[1] = 0;
    a.mind.broke[1] = 1;
    expect(goodwill(a, 1)).toBeLessThan(base);
  });

  it("patience decides whether a nearly bare bush is left to recover", () => {
    const picks = [5, 80].map((patience) => {
      const world = huddle(1);
      const a = world.agents[0]!;
      world.config.planting = false;
      a.traits[Trait.patience] = patience;
      a.traits[Trait.industry] = 90;
      forgetPlaces(a);
      const bush = believe(world, a, NodeKind.berry_bush, 3, 10);
      expect(restraint(a, world, bush)).toBe(patience >= 62 ? 4 : 0);
      const plan = decide(world, a);
      return { plan, bush };
    });
    // the impatient strip what is left; the patient will not touch a bush at a third of its fullness
    expect(picks[0]!.plan?.goal).toBe("provision");
    expect(picks[0]!.plan?.intents[0]).toMatchObject({ k: "gather", node: picks[0]!.bush, qty: 3 });
    expect(picks[1]!.plan?.intents.some((i) => i.k === "gather" && i.node === picks[1]!.bush)).not.toBe(true);
  });

  it("necessity overrides restraint", () => {
    const world = huddle(1);
    const a = world.agents[0]!;
    a.traits[Trait.patience] = 90;
    const bush = believe(world, a, NodeKind.berry_bush, 3, 10);
    expect(restraint(a, world, bush)).toBeGreaterThan(0);
    a.energy = 300;
    expect(restraint(a, world, bush)).toBe(0);
  });

  it("prudence sets how much food is enough, and cold remembered raises it", () => {
    const world = huddle(1);
    const a = world.agents[0]!;
    a.traits[Trait.prudence] = 10;
    const careless = stockDays(a);
    a.traits[Trait.prudence] = 90;
    const careful = stockDays(a);
    expect(careful).toBeGreaterThan(careless + 1.5);
    a.mind.tempEma = 40; // the cold is here
    const inCold = stockDays(a);
    expect(inCold).toBeGreaterThan(careful + 2);
    a.mind.wintersSeen = 1;
    a.mind.hungerDays = 6;
    expect(stockDays(a)).toBeGreaterThan(inCold); // having lived through one teaches more
  });

  it("with two days of roots in hand, only the prudent keep provisioning", () => {
    const goals = [10, 90].map((prudence) => {
      const world = huddle(1);
      const a = world.agents[0]!;
      world.config.planting = false;
      a.traits[Trait.prudence] = prudence;
      a.traits[Trait.industry] = 90;
      a.inv[Item.root] = 4;
      forgetPlaces(a);
      believe(world, a, NodeKind.root_patch, 7);
      return decide(world, a)?.goal;
    });
    expect(goals[0]).not.toBe("provision");
    expect(goals[1]).toBe("provision");
  });

  it("conformity decides whether a promise is repaid when repaying hurts", () => {
    const goals = [20, 85].map((conformity) => {
      const world = huddle(2);
      const [a] = world.agents as [Agent, Agent];
      a.traits[Trait.conformity] = conformity;
      a.inv[Item.root] = 2; // all the food there is
      a.mind.commitments.push({ id: 1, dir: "owe", to: 1, item: Item.root, qty: 2, due: world.tick + TICKS_PER_DAY, done: false });
      return decide(world, a);
    });
    expect(goals[0]?.goal).not.toBe("repay");
    expect(goals[1]?.goal).toBe("repay");
    expect(goals[1]?.intents[0]).toMatchObject({ k: "give", to: 1, item: Item.root, qty: 2 });
  });

  it("the sociable tell others where food is; the unsociable keep quiet", () => {
    const plans = [90, 10].map((sociability) => {
      const world = huddle(2);
      const [a] = world.agents as [Agent, Agent];
      world.config.planting = false;
      a.traits[Trait.sociability] = sociability;
      a.traits[Trait.generosity] = 60;
      a.traits[Trait.prudence] = 10;
      a.traits[Trait.curiosity] = 0;
      a.inv[Item.root] = 8;
      forgetPlaces(a);
      const bush = believe(world, a, NodeKind.berry_bush, 9);
      return { plan: decide(world, a), bush };
    });
    expect(plans[0]!.plan?.goal).toBe("tell");
    expect(plans[0]!.plan?.intents[0]).toMatchObject({ k: "say", to: -1, act: { t: "inform_node", node: plans[0]!.bush, amount: 9 } });
    expect(plans[1]!.plan?.goal).not.toBe("tell");
  });

  it("no charter is hand-written into the baseline mind: its only source of a proposal is the grammar search", () => {
    const planner = readFileSync(new URL("./planner.ts", import.meta.url), "utf8");
    for (const kind of ["propose", "endorse", "motion", "vote", "leave", "pact_offer", "pact_accept"]) {
      expect(planner.includes(`k: "${kind}"`), `planner emits ${kind}`).toBe(false);
    }
    const civic = readFileSync(new URL("./civic.ts", import.meta.url), "utf8");
    const proposals = civic.match(/k: "propose"[^}]*}/g) ?? [];
    expect(proposals).toEqual(['k: "propose", charter: found.charter }']);
    // and no rule form is spelled out anywhere in either file
    for (const form of ["may_withdraw", "must_deposit", "must_supply", "must_not_gather", "may_shelter"]) {
      expect(planner.includes(form) || civic.includes(form), form).toBe(false);
    }
  });
});

describe("private information remains private", () => {
  it("a word said to one person is not heard by a bystander; a public word is", () => {
    const world = huddle(3);
    const [a, b, c] = world.agents as [Agent, Agent, Agent];
    hold(a, [
      { k: "say", to: b.id, act: { t: "request", item: Item.berry, qty: 1 } },
      { k: "say", to: -1, act: { t: "greet" } },
    ]);
    advance(world, 4);
    expect(b.mind.inbox.map((h) => h.act.t)).toEqual(["request", "greet"]);
    expect(b.mind.inbox[0]!.direct).toBe(true);
    expect(c.mind.inbox.map((h) => h.act.t)).toEqual(["greet"]);
  });

  it("an observation holds beliefs, not truth, and only places its agent knows", () => {
    const world = createWorld(makeConfig("first_light", 8, { population: 8, illness: 0, policy: "reflex" }));
    advance(world, 40);
    const a = world.agents[0]!;
    const believed = Array.from(a.mind.nodeAmt);
    // change the truth everywhere behind the agent's back
    world.nodes.amount.fill(99);
    const obs = observe(world, 0)!;
    expect(obs.nodes.length).toBeGreaterThan(0);
    for (const n of obs.nodes) {
      expect(believed[n.id]).toBeGreaterThanOrEqual(0); // known to the agent
      expect(n.amount).toBe(believed[n.id]); // as believed, not as it is
      expect(n.amount).not.toBe(99);
    }
    const unknown = believed.findIndex((v) => v < 0);
    expect(unknown).toBeGreaterThanOrEqual(0);
    expect(obs.nodes.some((n) => n.id === unknown)).toBe(false);
  });

  it("an observation shows other people only as they look: no needs, inventories, plans or memories", () => {
    const world = huddle(3);
    const [a, b, c] = world.agents as [Agent, Agent, Agent];
    b.inv[Item.clay] = 4242;
    b.energy = 777;
    b.mind.goal = "secret_goal_xyz";
    b.mind.mem.push({ tick: 0, kind: "found", who: -1, ref: 3131, item: -1, qty: 3131, salience: 900, src: -1 });
    c.mind.trust[a.id] = 13;
    const obs = observe(world, a.id)!;
    const text = JSON.stringify(obs);
    expect(text).not.toContain("4242");
    expect(text).not.toContain("777");
    expect(text).not.toContain("secret_goal_xyz");
    expect(text).not.toContain("3131");
    const seenIds = visibleAgents(world, scratchOf(world), a).map((s) => s.id);
    expect(obs.people.map((p) => p.id)).toEqual(seenIds);
    const allowed = ["id", "name", "dx", "dy", "dist", "looksHungry", "looksCold", "asleep", "ill", "laden", "audible", "trust", "gave", "got", "kept", "broke"];
    for (const p of obs.people) expect(Object.keys(p).sort()).toEqual([...allowed].sort());
    // the trust shown is my trust in them, never theirs in me
    expect(obs.people.find((p) => p.id === c.id)!.trust).toBe(a.mind.trust[c.id]);
  });

  it("testimony carries its source and is weighed by trust in the teller", () => {
    const world = huddle(3);
    const [a, b, c] = world.agents as [Agent, Agent, Agent];
    forgetPlaces(b);
    forgetPlaces(c);
    // a bush far out of everyone's sight, so that hearing is the only way to learn of it
    let bush = -1;
    let far = 0;
    for (let n = 0; n < world.nodes.count; n++) {
      if (world.nodes.kind[n] !== NodeKind.berry_bush) continue;
      const d = Math.max(Math.abs((world.nodes.x[n] as number) - a.x), Math.abs((world.nodes.y[n] as number) - a.y));
      if (d > far) {
        far = d;
        bush = n;
      }
    }
    expect(far).toBeGreaterThan(12);
    b.mind.trust[a.id] = 800;
    c.mind.trust[a.id] = 100; // c does not believe a
    hold(a, [{ k: "say", to: -1, act: { t: "inform_node", node: bush, amount: 9, tick: world.tick } }, { k: "wait", ticks: 40 }]);
    advance(world, 3);
    expect(b.mind.nodeAmt[bush]).toBe(9);
    expect(b.mind.nodeSrc[bush]).toBe(a.id);
    expect(c.mind.nodeAmt[bush]).toBe(-1);
    // (an observation lists the most relevant places; make this the only bush b knows so that it is listed)
    for (let n = 0; n < world.nodes.count; n++) if (n !== bush && world.nodes.kind[n] === NodeKind.berry_bush) b.mind.nodeAmt[n] = -1;
    const told = observe(world, b.id)!.nodes.find((n) => n.id === bush);
    expect(told?.source).toBe(a.name);
    expect(told?.amount).toBe(9);
  });

  it("sleepers hear nothing", () => {
    const world = huddle(2);
    const [a, b] = world.agents as [Agent, Agent];
    b.rest = 100;
    hold(b, [{ k: "rest", ticks: 20 }]);
    advance(world, 2);
    expect(b.asleep).toBe(true);
    hold(a, [{ k: "say", to: -1, act: { t: "greet" } }]);
    advance(world, 3);
    expect(b.mind.inbox.length).toBe(0);
  });
});

describe("trust is earned and lost by what happens", () => {
  it("a gift raises the receiver's trust in the giver", () => {
    const world = huddle(2);
    const [a, b] = world.agents as [Agent, Agent];
    a.inv[Item.root] = 3;
    world.metrics.sources[Item.root] = (world.metrics.sources[Item.root] as number) + 3;
    const before = b.mind.trust[a.id] as number;
    const had = b.inv[Item.root] as number;
    hold(a, [{ k: "give", to: b.id, item: Item.root, qty: 2 }, { k: "wait", ticks: 40 }]);
    advance(world, 3);
    expect(b.inv[Item.root]).toBe(had + 2);
    expect(b.mind.trust[a.id] as number).toBeGreaterThan(before);
    expect(b.mind.got[a.id] as number).toBeGreaterThan(0);
  });

  it("a promise kept is recorded by both and raises trust", () => {
    const world = huddle(2);
    const [a, b] = world.agents as [Agent, Agent];
    a.inv[Item.root] = 3;
    world.metrics.sources[Item.root] = (world.metrics.sources[Item.root] as number) + 3;
    // (the wait keeps the promiser from deliberating at once — a planner with roots in hand would simply pay up)
    hold(a, [{ k: "say", to: b.id, act: { t: "promise", item: Item.root, qty: 2, due: world.tick + 40 } }, { k: "wait", ticks: 40 }]);
    advance(world, 3);
    expect(a.mind.commitments).toHaveLength(1);
    expect(a.mind.commitments[0]).toMatchObject({ dir: "owe", to: b.id, qty: 2, done: false });
    expect(b.mind.commitments[0]).toMatchObject({ dir: "due", to: a.id, qty: 2, done: false });
    const trust = b.mind.trust[a.id] as number;
    hold(a, [{ k: "give", to: b.id, item: Item.root, qty: 2 }, { k: "wait", ticks: 40 }]);
    const events = advance(world, 3);
    expect(events.some((e) => e.k === "promise_kept" && e.a === a.id && e.b === b.id)).toBe(true);
    expect(b.mind.kept[a.id]).toBe(1);
    expect(a.mind.commitments[0]!.done).toBe(true);
    // the gift itself and the kept word both count
    expect(b.mind.trust[a.id] as number).toBeGreaterThanOrEqual(trust + TRUST_DELTA.kept);
  });

  it("a promise broken is noticed only by the one it was made to, and costs more than keeping earns", () => {
    const world = huddle(3);
    const [a, b, c] = world.agents as [Agent, Agent, Agent];
    hold(a, [{ k: "say", to: b.id, act: { t: "promise", item: Item.root, qty: 2, due: world.tick + 6 } }, { k: "wait", ticks: 40 }]);
    a.inv[Item.root] = 0;
    advance(world, 3);
    const trustB = b.mind.trust[a.id] as number;
    const trustC = c.mind.trust[a.id] as number;
    for (const x of world.agents) hold(x);
    const events = advance(world, 12);
    expect(events.some((e) => e.k === "promise_broken" && e.a === a.id && e.b === b.id)).toBe(true);
    expect(b.mind.broke[a.id]).toBe(1);
    expect(b.mind.trust[a.id]).toBe(trustB + TRUST_DELTA.broke);
    expect(Math.abs(TRUST_DELTA.broke)).toBeGreaterThan(TRUST_DELTA.kept);
    expect(c.mind.trust[a.id]).toBe(trustC); // the bystander never heard it
    expect(b.mind.mem.some((m) => m.kind === "broke" && m.who === a.id)).toBe(true);
  });

  it("hearsay moves trust in proportion to trust in the teller; distrusted tellers and self-praise move nothing", () => {
    const world = huddle(4);
    const [a, b, c, d] = world.agents as [Agent, Agent, Agent, Agent];
    c.mind.trust[a.id] = 800;
    d.mind.trust[a.id] = 200;
    const before = { c: c.mind.trust[b.id] as number, d: d.mind.trust[b.id] as number, b: b.mind.trust[a.id] as number };
    hold(a, [
      { k: "say", to: -1, act: { t: "inform_agent", about: b.id, claim: "broke", tick: world.tick } },
      { k: "say", to: -1, act: { t: "inform_agent", about: a.id, claim: "gave", tick: world.tick } },
    ]);
    advance(world, 4);
    expect(c.mind.trust[b.id]).toBe(before.c - Math.round((TRUST_DELTA.hearsay * 800) / 1000));
    expect(d.mind.trust[b.id]).toBe(before.d);
    expect(c.mind.trust[a.id]).toBe(800); // praising oneself changes nothing
    expect(b.mind.trust[a.id]).toBe(before.b); // and what is said about me does not change my view of the teller
    expect(c.mind.mem.some((m) => m.kind === "heard" && m.who === b.id && m.src === a.id)).toBe(true);
  });
});

describe("external decisions: proposals, not writes", () => {
  function externalWorld(population = 6, seed = 9): WorldState {
    const world = createWorld(makeConfig("first_light", seed, { population, illness: 0, policy: "reflex" }));
    for (const a of world.agents) a.controller = "external";
    return world;
  }

  it("rejects what is malformed, unknown, masked or too long, and applies only what remains", () => {
    const world = externalWorld();
    advance(world, 30);
    const out: SimEvent[] = [];
    const a = world.agents[0]!;
    expect(submitDecision(world, 0, null, "mock", out)).toMatchObject({ ok: false, error: "malformed" });
    expect(submitDecision(world, 0, { intents: [] }, "mock", out)).toMatchObject({ ok: false, error: "empty" });
    expect(submitDecision(world, 99, { intents: [{ k: "explore" }] }, "mock", out)).toMatchObject({ ok: false, error: "no_such_agent" });
    expect(submitDecision(world, 0, { intents: [{ k: "explore" }] }, "baseline", out)).toMatchObject({ ok: false, error: "bad_source" });

    const unknownNode = Array.from(a.mind.nodeAmt).findIndex((v) => v < 0);
    const before = serializeWorld(world);
    const refused = submitDecision(world, 0, { intents: [{ k: "teleport" }, { k: "gather", node: unknownNode, qty: 2 }, { k: "give", to: 0, item: Item.berry, qty: 1 }, { k: "eat", item: Item.clay, qty: NaN }] }, "mock", out);
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("nothing_acceptable");
    expect(refused.rejected.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(refused.rejected[1]!.reason).toBe("unknown_place");
    // A refused decision leaves the world, the body, the beliefs and the plan exactly as they
    // were. What it does change is bookkeeping: when this mind may next deliberate, the record
    // of the refusal, and what the mind will be told was refused.
    const bookkeeping = (text: string) =>
      text
        .replace(/"nextDeliberation":\d+/g, "")
        .replace(/"feedback":\[[^\]]*\]/g, "")
        .replace(/"nextEvent":\d+/, "")
        .replace(/"decisionsBySource":\{[^}]*\}/, "");
    expect(bookkeeping(serializeWorld(world))).toBe(bookkeeping(before));
    expect(a.mind.feedback.map((f) => [f.k, f.r])).toEqual([
      ["teleport", "unknown_intent"],
      ["gather", "unknown_place"],
      ["give", refused.rejected[2]!.reason],
      ["eat", "malformed"],
    ]);
    const refusal = out.find((e) => e.id === refused.event)!;
    expect(refusal).toMatchObject({ k: "decision", r: "refused", d: { src: "mock", layer: "external", n: 0, plan: [] } });
    expect(world.metrics.decisionsBySource.refused).toBe(3); // the null, the empty and this one
    // and the mind is shown it, in its next observation
    expect(observe(world, 0)!.feedback.map((f) => f.reason)).toContain("unknown_place");

    const many: Intent[] = Array.from({ length: 9 }, () => ({ k: "wait", ticks: 2 }) as Intent);
    const capped = submitDecision(world, 0, { intents: many, goal: "<b>rest</b>‮", rationale: `x${"\u0007y".repeat(400)}` }, "mock", out);
    expect(capped.ok).toBe(true);
    expect(capped.accepted).toHaveLength(DECISION_LIMITS.maxIntents);
    expect(capped.rejected.every((r) => r.reason === "too_many")).toBe(true);
    expect(a.queue).toHaveLength(DECISION_LIMITS.maxIntents);
    expect(a.mind.goal).toBe("brestb");
    expect(a.mind.why.length).toBeLessThanOrEqual(DECISION_LIMITS.maxRationaleChars);
    expect(a.mind.why).not.toMatch(/[\u0000-\u001f‮]/);
    const record = out.find((e) => e.id === capped.event)!;
    expect(record.k).toBe("decision");
    expect(record.d).toMatchObject({ src: "mock", layer: "external", n: DECISION_LIMITS.maxIntents });
    expect(world.metrics.decisionsBySource.mock).toBe(1);
  });

  it("only externally controlled agents accept decisions, and the body's urgent needs come first", () => {
    const world = externalWorld();
    world.agents[1]!.controller = "reflex";
    const out: SimEvent[] = [];
    expect(submitDecision(world, 1, { intents: [{ k: "explore" }] }, "mock", out)).toMatchObject({ ok: false, error: "not_external" });
    world.agents[2]!.hydration = 50;
    expect(dueForDecision(world)).not.toContain(1);
    expect(dueForDecision(world)).not.toContain(2);
    expect(dueForDecision(world)).toContain(0);
  });

  it("without a decision an external agent survives on the reflex layer, labelled as fallback", () => {
    const world = externalWorld(8);
    const events = advance(world, 3 * TICKS_PER_DAY);
    const decisions = events.filter((e) => e.k === "decision");
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((e) => (e.d as { src: string }).src === "fallback")).toBe(true);
    expect(world.agents.filter((a) => a.alive).length).toBe(8);
  });

  it("replay uses the recorded intents and reproduces the same world without consulting any mind", () => {
    const config = makeConfig("first_light", 14, { population: 12, illness: 300, policy: "reflex" });
    const physical = (w: WorldState) =>
      canonicalJson({
        tick: w.tick,
        nodes: w.nodes.amount,
        agents: w.agents.map((a) => [a.x, a.y, a.alive, a.energy, a.hydration, a.rest, a.warmth, a.health, a.inv, a.skills, a.mind.trust, a.mind.nodeAmt]),
        structures: w.structures.map((s) => [s.kind, s.x, s.y, s.complete, s.fuel, s.inv]),
        piles: w.piles,
      });

    // 1. a run driven by the mock mind, recorded
    const live = createWorld(config);
    for (const a of live.agents) a.controller = "external";
    const ledger: SimEvent[] = [];
    const out: SimEvent[] = [];
    let consulted = 0;
    const ticks = 4 * TICKS_PER_DAY;
    for (let t = 0; t < ticks; t++) {
      for (const id of dueForDecision(live)) {
        consulted++;
        submitDecision(live, id, mockDecision(observe(live, id)!, config.seed), "mock", out);
      }
      step(live, out);
      for (const e of out) ledger.push(e);
      out.length = 0;
    }
    const tape: DecisionRecord[] = tapeFromEvents(ledger);
    expect(consulted).toBeGreaterThan(100);
    expect(tape.length).toBeGreaterThan(100);
    expect(live.metrics.decisionsBySource.mock).toBe(tape.length);
    // the tape is self-contained data
    const stored: DecisionRecord[] = parseCanonical(canonicalJson(tape));

    // 2. the same world replayed from the tape alone
    const replay = createWorld(config);
    for (const a of replay.agents) a.controller = "external";
    const kinds: string[] = [];
    let cursor = 0;
    for (let t = 0; t < ticks; t++) {
      cursor = replayTape(replay, stored, cursor, out);
      step(replay, out);
      for (const e of out) kinds.push(e.k);
      out.length = 0;
    }
    expect(cursor).toBe(stored.length);
    expect(physical(replay)).toBe(physical(live));
    expect(kinds).toEqual(ledger.map((e) => e.k));
    expect(replay.metrics.decisionsBySource.replay).toBe(tape.length);
    expect(replay.metrics.decisionsBySource.mock ?? 0).toBe(0);
  });
});

describe("baseline competence", () => {
  it("sharing one lean island, planners outlive reflex-only neighbours", () => {
    const planners = { n: 0, alive: 0 };
    const reflexes = { n: 0, alive: 0 };
    for (const seed of [1, 2]) {
      const world = createWorld(makeConfig("first_light", seed, { policy: "planner", plannerShare: 500, richness: 1000, regrowth: 1000, nodeDensity: 1000, institutions: "off" }));
      advance(world, 40 * TICKS_PER_DAY);
      for (const a of world.agents) {
        const bucket = a.controller === "planner" ? planners : reflexes;
        bucket.n++;
        if (a.alive) bucket.alive++;
      }
      // nothing institutional exists under either baseline
      expect(world.metrics.decisionsBySource.baseline).toBeGreaterThan(0);
      expect(canonicalJson(world.inst)).toBe(canonicalJson(createWorld(makeConfig("first_light", seed)).inst));
    }
    expect(planners.n).toBeGreaterThan(30);
    expect(reflexes.n).toBeGreaterThan(30);
    expect(planners.alive / planners.n).toBeGreaterThan(reflexes.alive / reflexes.n + 0.2);
  }, 120_000);

  it("on the reference island a society of planners comes through its first winter, and with institutions off none exists", () => {
    const world = createWorld(makeConfig("first_light", 3, { policy: "planner", institutions: "off" }));
    const events = advance(world, 40 * TICKS_PER_DAY);
    expect(world.agents.filter((a) => a.alive).length).toBeGreaterThanOrEqual(45);
    const kinds = new Set(events.map((e) => e.k));
    // foresight shows up as things reflexes never do
    for (const k of ["built", "plant", "harvest", "deposit", "craft"]) expect(kinds.has(k as SimEvent["k"]), k).toBe(true);
    for (const k of ["proposal", "ratified", "joined", "endorse", "motion", "vote", "pact"]) expect(kinds.has(k as SimEvent["k"]), k).toBe(false);
    expect(world.inst).toEqual({ nextId: 1, proposals: [], institutions: [], motions: [], pacts: [] });
  }, 120_000);
});

describe("snapshot migration 1 → 2", () => {
  it("fills the new mind fields for a snapshot written before they existed", () => {
    const world = createWorld(makeConfig("first_light", 31, { population: 5 }));
    advance(world, 20);
    const env = parseCanonical<{ schema: number; state: { agents: { mind: Record<string, unknown> }[] } }>(serializeWorld(world));
    env.schema = 1;
    for (const a of env.state.agents) {
      delete a.mind.tempSum;
      delete a.mind.tempN;
      delete a.mind.coldRun;
      delete a.mind.nodeMax;
    }
    const restored = restoreWorld(canonicalJson(env));
    for (const a of restored.agents) {
      expect(a.mind.tempSum).toBe(0);
      expect(a.mind.coldRun).toBe(0);
      expect(a.mind.nodeMax).toBeInstanceOf(Int16Array);
      expect(a.mind.nodeMax.length).toBe(restored.nodes.count);
      for (let n = 0; n < restored.nodes.count; n++) expect(a.mind.nodeMax[n]).toBe(Math.max(0, a.mind.nodeAmt[n] as number));
    }
    // and the migrated world runs
    advance(restored, 50);
    expect(restored.tick).toBe(world.tick + 50);
  });
});
