import { describe, expect, it } from "vitest";
import {
  SnapshotError,
  applyIntervention,
  cloneWorld,
  createWorld,
  diffManifests,
  forkWorld,
  makeConfig,
  manifestOf,
  openBundle,
  packBundle,
  replayTo,
  restoreWorld,
  scratchOf,
  serializeWorld,
  snapshotHash,
  step,
  worldDigest,
  type SimEvent,
  type WorldState,
} from "../index";

const DAY = 96;

function advance(w: WorldState, ticks: number): void {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(w, out);
    out.length = 0;
  }
}

function intervene(w: WorldState, kind: string, params: Record<string, number>): void {
  applyIntervention(w, scratchOf(w), [], { tick: w.tick, kind, params, origin: "observer" });
}

/** A world line with two observer interventions, and a snapshot taken between them. */
function lived(): { tip: WorldState; keyframe: string; keyTick: number } {
  const w = createWorld(makeConfig("first_light", 11, { population: 24 }));
  advance(w, DAY + 10);
  intervene(w, "cold_snap", { days: 2, magnitude: 1000 });
  advance(w, 40);
  const keyframe = serializeWorld(w);
  const keyTick = w.tick;
  advance(w, DAY);
  intervene(w, "blight", { magnitude: 1000 });
  advance(w, DAY + 7);
  return { tip: w, keyframe, keyTick };
}

describe("history: re-running a stretch of a world line", () => {
  it("a replay from an earlier snapshot, with the logged interventions re-applied at their ticks, ends byte-identical to the original", () => {
    const { tip, keyframe } = lived();
    const again = restoreWorld(keyframe);
    replayTo(again, tip.tick, tip.interventions, []);
    expect(worldDigest(again)).toBe(worldDigest(tip));
    expect(snapshotHash(serializeWorld(again))).toBe(snapshotHash(serializeWorld(tip)));
    expect(again.interventions).toEqual(tip.interventions);
  });

  it("a replay from the very beginning does too", () => {
    const { tip } = lived();
    const again = createWorld(tip.config);
    replayTo(again, tip.tick, tip.interventions, []);
    expect(snapshotHash(serializeWorld(again))).toBe(snapshotHash(serializeWorld(tip)));
  });

  it("an intervention made at the very tip is re-applied, and one in the future is not", () => {
    const w = createWorld(makeConfig("first_light", 5, { population: 16 }));
    advance(w, 50);
    const key = serializeWorld(w);
    advance(w, 30);
    intervene(w, "bounty", { magnitude: 1000 });
    const log = w.interventions.slice();
    const atTip = restoreWorld(key);
    replayTo(atTip, w.tick, log, []);
    expect(snapshotHash(serializeWorld(atTip))).toBe(snapshotHash(serializeWorld(w)));
    const before = restoreWorld(key);
    replayTo(before, w.tick - 1, log, []);
    expect(before.interventions.filter((i) => i.origin === "observer")).toHaveLength(0);
  });

  it("shocks scheduled by the scenario are applied once, by the engine, never twice by the replay", () => {
    const cfg = makeConfig("long_winter", 3, { population: 16 });
    const w = createWorld(cfg);
    advance(w, 30);
    const key = serializeWorld(w);
    advance(w, DAY * 12);
    const scheduled = w.interventions.filter((i) => i.origin === "scenario").length;
    const again = restoreWorld(key);
    replayTo(again, w.tick, w.interventions, []);
    expect(again.interventions.filter((i) => i.origin === "scenario")).toHaveLength(scheduled);
    expect(worldDigest(again)).toBe(worldDigest(w));
  });

  it("leaving an intervention out of the replay gives a different world (the test above is not vacuous)", () => {
    const { tip, keyframe } = lived();
    const without = restoreWorld(keyframe);
    replayTo(without, tip.tick, [], []);
    expect(worldDigest(without)).not.toBe(worldDigest(tip));
  });
});

describe("history: branches", () => {
  it("a branch is identical to its parent at the fork and, with shared random numbers, for as long as nothing is done to it", () => {
    const parent = createWorld(makeConfig("first_light", 21, { population: 20 }));
    advance(parent, 70);
    const branch = forkWorld(parent, "b1", true);
    expect(worldDigest(branch)).toBe(worldDigest(parent));
    for (let i = 0; i < 60; i++) {
      advance(parent, 1);
      advance(branch, 1);
      expect(worldDigest(branch)).toBe(worldDigest(parent));
    }
    expect(branch.meta.branch).toMatchObject({ id: "b1", parent: parent.meta.branch.id, forkTick: 70 });
  });

  it("what is done to a branch never reaches its parent, and what the parent does next never reaches the branch", () => {
    const reference = createWorld(makeConfig("first_light", 22, { population: 20 }));
    const parent = createWorld(makeConfig("first_light", 22, { population: 20 }));
    advance(reference, 60);
    advance(parent, 60);
    const branch = forkWorld(parent, "b1", true);
    intervene(branch, "blight", { magnitude: 1000 });
    intervene(branch, "newcomers", { count: 5 });
    advance(branch, 120);
    // the parent never forked as far as its own state can tell
    expect(worldDigest(parent)).toBe(worldDigest(reference));
    advance(parent, 120);
    advance(reference, 120);
    expect(worldDigest(parent)).toBe(worldDigest(reference));
    expect(parent.interventions).toEqual(reference.interventions);
    // and the branch really is a different world by now
    expect(worldDigest(branch)).not.toBe(worldDigest(parent));
    expect(branch.agents.length).toBe(parent.agents.length + 5);
  });

  it("two branches of one parent share nothing that can be written", () => {
    const parent = createWorld(makeConfig("first_light", 23, { population: 20 }));
    advance(parent, 40);
    const a = forkWorld(parent, "a", true);
    const b = forkWorld(parent, "b", true);
    const untouched = cloneWorld(b);
    intervene(a, "drought", { days: 6, magnitude: 1000 });
    advance(a, 200);
    expect(worldDigest(b)).toBe(worldDigest(untouched));
    // typed arrays and nested objects are copies, not views
    expect(a.nodes.amount.buffer).not.toBe(b.nodes.amount.buffer);
    expect(a.agents[0]).not.toBe(b.agents[0]);
    expect(a.agents[0]!.mind).not.toBe(b.agents[0]!.mind);
    expect(a.inst).not.toBe(b.inst);
  });

  it("a branch with new luck starts from the same moment and then goes its own way", () => {
    const parent = createWorld(makeConfig("first_light", 24, { population: 20 }));
    advance(parent, 50);
    const same = forkWorld(parent, "same", true);
    const other = forkWorld(parent, "other", false);
    expect(other.meta.branch.rngEpoch).not.toBe(same.meta.branch.rngEpoch);
    advance(same, DAY * 6);
    advance(other, DAY * 6);
    advance(parent, DAY * 6);
    expect(worldDigest(same)).toBe(worldDigest(parent));
    expect(worldDigest(other)).not.toBe(worldDigest(parent));
  });
});

describe("history: export, import and integrity", () => {
  it("a bundle opens to the same world and the same twin, with a manifest that says what they are", () => {
    const { tip } = lived();
    const twin = createWorld(tip.config);
    advance(twin, tip.tick);
    const text = packBundle(tip, twin, { series: [1, 2, 3], note: "kept beside the world" });
    const opened = openBundle(text);
    expect(worldDigest(opened.world)).toBe(worldDigest(tip));
    expect(serializeWorld(opened.world)).toBe(serializeWorld(tip));
    expect(worldDigest(opened.control!)).toBe(worldDigest(twin));
    expect(opened.extras).toEqual({ series: [1, 2, 3], note: "kept beside the world" });
    const m = opened.manifest;
    expect(m).toMatchObject({ seed: 11, scenario: "first_light", tick: tip.tick, engine: tip.meta.engine, schema: tip.meta.schema, minds: null });
    expect(m.interventions.map((i) => i.kind)).toEqual(["cold_snap", "blight"]);
    expect(m.snapshot.sha256).toBe(snapshotHash(serializeWorld(tip)));
    // an opened world goes on exactly as the original does
    advance(opened.world, 80);
    advance(tip, 80);
    expect(worldDigest(opened.world)).toBe(worldDigest(tip));
  });

  it("refuses a file in which a single character of the world was changed", () => {
    const { tip } = lived();
    const text = packBundle(tip, null);
    // the snapshot travels as a string inside the file, so its quotes are escaped there
    const at = text.indexOf('\\"energy\\":');
    expect(at).toBeGreaterThan(0);
    const digit = text.slice(at).search(/[0-9]/) + at;
    const flipped = text.slice(0, digit) + (text[digit] === "7" ? "8" : "7") + text.slice(digit + 1);
    expect(flipped).not.toBe(text);
    expect(() => openBundle(flipped)).toThrowError(SnapshotError);
    try {
      openBundle(flipped);
    } catch (err) {
      expect((err as SnapshotError).code).toBe("corrupt");
      expect((err as Error).message).toMatch(/hash mismatch|not valid/);
    }
  });

  it("refuses a manifest that was edited to describe a different history", () => {
    const { tip } = lived();
    const bundle = JSON.parse(packBundle(tip, null)) as { manifest: { seed: number; tick: number; interventions: unknown[] } };
    for (const edit of [(b: typeof bundle) => (b.manifest.seed = 12), (b: typeof bundle) => (b.manifest.tick += 1)]) {
      const copy = JSON.parse(JSON.stringify(bundle)) as typeof bundle;
      edit(copy);
      expect(() => openBundle(JSON.stringify(copy))).toThrowError(/does not describe the world/);
    }
  });

  it("refuses a twin from another world or another moment, a truncated file, an empty file and a file that is something else", () => {
    const { tip } = lived();
    const stranger = createWorld(makeConfig("first_light", 99, { population: 24 }));
    advance(stranger, tip.tick);
    expect(() => openBundle(packBundle(tip, stranger))).toThrowError(/different world/);
    const early = createWorld(tip.config);
    advance(early, 10);
    expect(() => openBundle(packBundle(tip, early))).toThrowError(/different moment|different world/);
    const text = packBundle(tip, null);
    expect(() => openBundle(text.slice(0, text.length - 40))).toThrowError(SnapshotError);
    expect(() => openBundle("")).toThrowError(/empty/);
    expect(() => openBundle('{"format":"something/else"}')).toThrowError(/not a TABULA RASA world file/);
    expect(() => openBundle(serializeWorld(tip))).toThrowError(/not a TABULA RASA world file/);
  });

  it("two manifests say how the worlds they describe were made differently", () => {
    const { tip } = lived();
    const plain = createWorld(tip.config);
    advance(plain, tip.tick);
    expect(diffManifests(manifestOf(tip), manifestOf(tip))).toEqual([]);
    const d = diffManifests(manifestOf(tip), manifestOf(plain));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatch(/^interventions: /);
    const other = createWorld(makeConfig("first_light", 12, { population: 30 }));
    const d2 = diffManifests(manifestOf(plain), manifestOf(other, undefined, { provider: "mock", model: "mock-1", promptVersion: "p1" }));
    expect(d2.some((l) => l.startsWith("seed: 11 ≠ 12"))).toBe(true);
    expect(d2.some((l) => l.startsWith("config.population: 24 ≠ 30"))).toBe(true);
    expect(d2.some((l) => l.startsWith("minds: null ≠ "))).toBe(true);
  });
});
