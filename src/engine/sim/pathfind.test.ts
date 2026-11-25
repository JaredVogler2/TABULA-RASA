import { describe, expect, it } from "vitest";
import { Stream, u32 } from "../core/rng";
import { makeConfig } from "../model/config";
import { TICKS_PER_DAY } from "../model/constants";
import type { SimEvent, WorldState } from "../model/types";
import { cloneWorld, worldDigest } from "../save/snapshot";
import { createWorld } from "../world/create";
import { findPath, markSeen } from "./pathfind";
import { scratchOf } from "./scratch";
import { step } from "./step";

/**
 * The route finder remembers searches that found no route (see `knownNoRoute`). That memory
 * must never change an answer: these tests compare it with searching afresh, question by
 * question and world by world.
 */

/** The same question put to a copy of the world that has never searched for anything. */
function afresh(world: WorldState, agent: number, tx: number, ty: number, near: number): number[] | null {
  const copy = cloneWorld(world);
  return findPath(copy, scratchOf(copy), copy.agents[agent]!, tx, ty, near);
}

describe("the route finder's memory of failed searches", () => {
  it("answers every question exactly as a fresh search does, whatever was asked before and whatever has been learned, forgotten or walked since", () => {
    const world = createWorld(makeConfig("two_shores", 4, { population: 6 }));
    const sc = scratchOf(world);
    const { w, h } = world.terrain;
    const agent = world.agents[0]!;
    const walkable: number[] = [];
    for (let i = 0; i < w * h; i++) if ((world.terrain.moveCost[i] as number) > 0) walkable.push(i);
    const draw = (k: number, n: number): number => u32(20261125, Stream.Lab, k) % n;
    // goals that will be asked for again and again: some reachable, some across water, some in the sea
    const goals = Array.from({ length: 14 }, (_, i) => draw(1000 + i, w * h));
    let nulls = 0;
    let routes = 0;
    let repeatedNulls = 0;
    let forgotten = 0;
    let foundAfterFailing = 0;
    const failedBefore = new Set<string>();
    for (let round = 0; round < 720; round++) {
      const kind = draw(round * 7, 100);
      if (kind < 5) {
        // a step somewhere else entirely (the test moves the body; the question is only what the search then says)
        const to = walkable[draw(round * 7 + 1, walkable.length)]!;
        agent.x = to % w;
        agent.y = (to - agent.x) / w;
      } else if (kind < 20) {
        // more of the map becomes known: a patch around a random tile
        const c = draw(round * 7 + 2, w * h);
        const cx = c % w;
        const cy = (c - cx) / w;
        const r = 1 + draw(round * 7 + 3, 6);
        for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) markSeen(agent.mind.seen, y * w + x);
      }
      if (round % 60 === 10) {
        // the whole island at once: from here on, what cannot be reached is known not to be reachable
        for (let i = 0; i < w * h; i++) markSeen(agent.mind.seen, i);
      } else if (round % 60 === 50) {
        // And everything forgotten. No agent in the engine ever forgets what it has seen — which is why a failed
        // search could never become a successful one from the same tile, and why only a test that does this can
        // tell whether the memory is really tied to what was seen. (The seeded mutation run found that no test did.)
        agent.mind.seen.fill(0);
        forgotten++;
      }
      const goal = goals[draw(round * 7 + 4, goals.length)]!;
      const near = draw(round * 7 + 5, 3);
      const tx = goal % w;
      const ty = (goal - tx) / w;
      const expected = afresh(world, 0, tx, ty, near);
      const got = findPath(world, sc, agent, tx, ty, near);
      expect(got, `round ${round}: from ${agent.x},${agent.y} to ${tx},${ty} within ${near}`).toEqual(expected);
      const asked = `${agent.x},${agent.y}>${goal}/${near}`;
      if (got === null) {
        nulls++;
        if (failedBefore.has(asked)) repeatedNulls++;
        failedBefore.add(asked);
      } else {
        routes++;
        // the same question, from the same tile, that once had no answer: only possible because something was forgotten
        if (failedBefore.has(asked)) foundAfterFailing++;
      }
    }
    // the comparison means something only if it met all the cases: routes found, searches that failed, and the same failure asked for again
    expect(routes).toBeGreaterThan(200);
    expect(nulls).toBeGreaterThan(100);
    expect(repeatedNulls).toBeGreaterThan(15);
    expect(forgotten).toBeGreaterThan(8);
    expect(foundAfterFailing).toBeGreaterThan(8);
  });

  it("a crowded island in famine arrives at the same world, to the last bit, with the memory and without it", () => {
    // 120 people on a 48 × 48 island: from the eighth day the hungry ask, every tick, for food they cannot reach
    const cfg = makeConfig("first_light", 1, { population: 120, size: 48, policy: "planner" });
    const days = 10;
    const live = (forget: boolean): { digest: string; refusals: number; alive: number } => {
      const world = createWorld(cfg);
      const out: SimEvent[] = [];
      let refusals = 0;
      for (let t = 0; t < days * TICKS_PER_DAY; t++) {
        // without the memory: everything remembered is thrown away before every tick, so nothing is carried from
        // one tick to the next (a question repeated inside one tick may still be answered from memory; the test
        // above compares every single answer with a fresh search)
        if (forget) scratchOf(world).noRouteFrom.fill(-1);
        step(world, out);
        for (const e of out as unknown as { k: string; r?: string }[]) if (e.k === "rejected" && e.r === "unreachable") refusals++;
        out.length = 0;
      }
      return { digest: worldDigest(world), refusals, alive: world.agents.filter((a) => a.alive).length };
    };
    const remembered = live(false);
    const searchedEveryTime = live(true);
    expect(remembered).toEqual(searchedEveryTime);
    // and the case it exists for did happen in this world
    expect(remembered.refusals).toBeGreaterThan(1000);
  }, 120_000);
});
