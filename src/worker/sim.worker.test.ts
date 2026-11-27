/**
 * The simulation worker, driven through its message protocol with nothing else in the room:
 * no browser, no renderer, no store. Everything the History panel, the twin view and the
 * Compare panel can ask for is asked here, and the answers are checked against the engine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TICKS_PER_DAY, makeConfig, restoreWorld, serializeWorld, worldDigest } from "@/engine";
import type * as Engine from "@/engine";

// The engine does not throw while a world is lived — which is why what the worker does if it
// ever did has to be tested by making it: with `boom.on`, the worker's `step` throws.
const boom = vi.hoisted(() => ({ on: false }));
vi.mock("@/engine", async (importOriginal) => {
  const real = await importOriginal<typeof Engine>();
  return {
    ...real,
    step: (...args: Parameters<typeof real.step>) => {
      if (boom.on) throw new Error("injected engine fault");
      return real.step(...args);
    },
  };
});
import { AF, AGENT_STRIDE, type FromWorker, type Recording, type SavePayload, type ToWorker, type ViewFrame } from "./protocol";

const out: FromWorker[] = [];
/** Every morning's message since it was last emptied (the list above is emptied whenever a frame is waited for). */
const mornings: Extract<FromWorker, { type: "day" }>[] = [];
// messages cross the boundary by structured clone, as they do between a page and a real worker:
// neither side can reach into the other's arrays
/**
 * The page on the other side. A real one answers every frame with `taken`, and the worker sends the
 * next only then; this one does the same a moment later (never from inside the worker's own call,
 * as a real page could not), unless a test is being a page that has not got round to it.
 */
const page = { taking: true };
/** Every frame's events since it was last emptied, for the tests that count what frames carry. */
const carried: { id: number; t: number }[] = [];
const fake = {
  postMessage: (m: FromWorker) => {
    out.push(structuredClone(m));
    if (m.type === "day") mornings.push(structuredClone(m));
    if (m.type === "frame") {
      for (const e of m.frame.events) carried.push({ id: e.id, t: e.t });
      if (carried.length > 40_000) carried.splice(0, 20_000);
      if (page.taking) setTimeout(() => fake.onmessage?.({ data: { type: "taken" } }), 0);
    }
    if (mornings.length > 400) mornings.splice(0, 200);
    if (out.length > 4000) out.splice(0, out.length - 2000);
  },
  onmessage: null as ((e: { data: ToWorker }) => void) | null,
};
let rid = 100;

function send(msg: ToWorker): void {
  if (!fake.onmessage) throw new Error("the worker did not install a handler");
  fake.onmessage({ data: structuredClone(msg) });
}

/** Send a request and return its reply (replies are posted synchronously, or on a later frame for `rebuild`). */
function ask<T extends FromWorker["type"]>(build: (requestId: number) => ToWorker, type: T): Extract<FromWorker, { type: T }> {
  const requestId = ++rid;
  send(build(requestId));
  for (let i = 0; i < 4000; i++) {
    const reply = out.find((m) => "requestId" in m && m.requestId === requestId);
    if (reply) {
      if (reply.type === "error") throw Object.assign(new Error(reply.message), { code: reply.code });
      expect(reply.type).toBe(type);
      return reply as Extract<FromWorker, { type: T }>;
    }
    vi.advanceTimersByTime(40);
  }
  throw new Error(`no reply to ${type}`);
}

/** Let the worker's own loop run once and return the frame it sends. */
function frame(): ViewFrame {
  out.length = 0;
  for (let i = 0; i < 50; i++) {
    vi.advanceTimersByTime(40);
    const f = [...out].reverse().find((m) => m.type === "frame");
    if (f && f.type === "frame") return f.frame;
  }
  throw new Error("the worker sent no frame");
}

function stepTo(tick: number): ViewFrame {
  let f = frame();
  while (f.tick < tick) {
    send({ type: "step", ticks: Math.min(TICKS_PER_DAY * 5, tick - f.tick) });
    f = frame();
  }
  return f;
}

const alive = (f: ViewFrame): number => {
  let n = 0;
  for (let i = 0; i < f.agentCount; i++) if ((f.agents[i * AGENT_STRIDE + AF.alive] as number) > 0.5) n++;
  return n;
};

const save = (): SavePayload => ask((requestId) => ({ type: "save", requestId }), "saved").payload;
const digestOf = (snapshot: string): string => worldDigest(restoreWorld(snapshot));

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("self", fake);
  await import("./sim.worker");
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("worker: a world's own history", () => {
  const config = makeConfig("first_light", 7, {});
  let left: SavePayload;

  it("keeps the start and every second morning as moments that can be returned to", () => {
    const ready = ask((requestId) => ({ type: "init", config, requestId }), "ready");
    expect(ready.frame.history?.keyTicks).toEqual([0]);
    expect(ready.frame.viewing).toBe("world");
    expect(ready.frame.hasTwin).toBe(false);
    expect(ready.frame.forkTick).toBe(-1);
    const f = stepTo(430);
    expect(f.history?.keyTicks).toEqual([0, 192, 384]);
    expect(f.history?.rebuildable).toBe(false);
  });

  it("an intervention forks an untouched twin at that tick, and the frame says so", () => {
    const r = ask((requestId) => ({ type: "intervene", kind: "blight", params: {}, requestId }), "intervened");
    expect(r.ok).toBe(true);
    expect(r.forkTick).toBe(430);
    const f = stepTo(620);
    expect(f.treated).toBe(true);
    expect(f.hasTwin).toBe(true);
    expect(f.forkTick).toBe(430);
    left = save();
    expect(left.tick).toBe(620);
    expect(left.control).not.toBeNull();
  });

  it("an exact re-run does again what the observer did, when it was done, and arrives at the world that was left", () => {
    const ready = ask((requestId) => ({ type: "rewind", tick: 192, mode: "rerun", requestId }), "ready");
    expect(ready.frame.tick).toBe(192);
    // before the fork is reached again there is no fork: the world is, for now, untouched
    expect(ready.frame.treated).toBe(false);
    expect(ready.frame.hasTwin).toBe(false);
    expect(ready.frame.history?.rerun).toEqual({ fromTick: 192, untilTick: 620, pending: 1, verified: null });
    // the past cannot be changed while it is being re-run
    const refused = ask((requestId) => ({ type: "intervene", kind: "bounty", params: {}, requestId }), "intervened");
    expect(refused).toMatchObject({ ok: false, reason: "rerun" });
    let f = stepTo(431);
    expect(f.treated).toBe(true);
    expect(f.forkTick).toBe(430);
    expect(f.history?.rerun?.pending).toBe(0);
    // one long step stops at the arrival instead of running past it
    send({ type: "step", ticks: TICKS_PER_DAY * 5 });
    f = frame();
    expect(f.tick).toBe(620);
    expect(f.history?.rerun?.verified).toBe(true);
    const again = save();
    expect(again.hash).toBe(left.hash);
    expect(digestOf(again.control as string)).toBe(digestOf(left.control as string));
    // after the verdict, time is live again
    send({ type: "step", ticks: 1 });
    f = frame();
    expect(f.tick).toBe(621);
    expect(f.history?.rerun).toBeNull();
  });

  it("the twin can be looked at: same tick, same people, its own state, and nothing can be done to it", () => {
    const mine = frame();
    const compare = ask((requestId) => ({ type: "compare", requestId }), "compare").view;
    expect(compare?.kind).toBe("intervention");
    expect(compare?.happened.find((h) => h.label === "Deaths")).toBeDefined();
    send({ type: "view", twin: true });
    const twin = frame();
    expect(twin.viewing).toBe("twin");
    expect(twin.tick).toBe(mine.tick);
    expect(twin.agentCount).toBe(mine.agentCount);
    // the lists that are only sent on change are sent again for the world now on screen
    expect(twin.structures).not.toBeNull();
    expect(twin.roster).not.toBeNull();
    // the Chronicle belongs to the world being lived: the twin's frames carry no events
    send({ type: "step", ticks: 30 });
    expect(frame().events).toEqual([]);
    // the worlds differ (a blight was done to one of them), so what is on screen differs
    expect(Array.from(twin.nodeAmounts)).not.toEqual(Array.from(mine.nodeAmounts));
    expect(alive(twin)).toBe(compare?.control.summary.alive);
    // the fork badge still describes the world being lived
    expect(twin.treated).toBe(true);
    const refused = ask((requestId) => ({ type: "intervene", kind: "bounty", params: {}, requestId }), "intervened");
    expect(refused).toMatchObject({ ok: false, reason: "twin" });
    const who = ask((requestId) => ({ type: "inspectAgent", id: 3, requestId }), "agent").detail;
    expect(who?.recent).toEqual([]);
    send({ type: "view", twin: false });
    const back = frame();
    expect(back.viewing).toBe("world");
    expect(back.roster).not.toBeNull();
    // events that happened in the world being lived while the twin was on screen were kept for it
    expect(back.tick).toBe(mine.tick + 30);
  });

  it("leaving from an earlier morning starts a new line without what was done later, and the old line can be returned to exactly", () => {
    const before = save();
    const ready = ask((requestId) => ({ type: "rewind", tick: 384, mode: "branch", requestId }), "ready");
    expect(ready.frame.tick).toBe(384);
    expect(ready.frame.treated).toBe(false);
    expect(ready.frame.hasTwin).toBe(false);
    let lines = ask((requestId) => ({ type: "branches", requestId }), "branches").list;
    expect(lines.map((l) => [l.current, l.forkTick, l.interventions.length])).toEqual([
      [false, -1, 1],
      [true, 384, 0],
    ]);
    expect(lines[0]?.sha256).toBe(before.hash);
    stepTo(500);
    const ret = ask((requestId) => ({ type: "switchBranch", id: lines[0]!.id, requestId }), "ready");
    expect(ret.frame.tick).toBe(before.tick);
    expect(ret.frame.forkTick).toBe(430);
    expect(save().hash).toBe(before.hash);
    lines = ask((requestId) => ({ type: "branches", requestId }), "branches").list;
    expect(lines.map((l) => l.current)).toEqual([true, false]);
    expect(lines[1]?.tipTick).toBe(500);
  });
});

describe("worker: a saved world's past, lived again from its seed", () => {
  const config = makeConfig("first_light", 11, {});
  let saved: SavePayload;

  it("a loaded world has only its present in memory, and says its past can be rebuilt", () => {
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    stepTo(250);
    expect(ask((requestId) => ({ type: "intervene", kind: "drought", params: {}, requestId }), "intervened").ok).toBe(true);
    stepTo(505);
    saved = save();
    const ready = ask((requestId) => ({ type: "load", snapshot: saved.snapshot, control: saved.control, series: saved.series, controlSeries: saved.controlSeries, requestId }), "ready");
    expect(ready.frame.history?.keyTicks).toEqual([505]);
    expect(ready.frame.history?.rebuildable).toBe(true);
    expect(ready.frame.history?.rebuildBlocked).toBe("");
    expect(ready.frame.forkTick).toBe(250);
    // what happened before it was opened is, so far, only what the save says
    expect(ready.frame.history?.provenance).toBe("opened");
  });

  it("rebuilding re-lives every day, forks the twin where it was forked, and is kept because it arrives at exactly the loaded world", () => {
    const r = ask((requestId) => ({ type: "rebuild", requestId }), "rebuilt");
    expect(r.ok).toBe(true);
    expect(r.ticks).toBe(505);
    expect(r.series.length).toBe(saved.series.length);
    expect(r.series).toEqual(saved.series);
    expect(r.controlSeries).toEqual(saved.controlSeries);
    expect(r.events.length).toBeGreaterThan(10);
    const f = frame();
    expect(f.history?.keyTicks).toEqual([0, 192, 384, 505]);
    expect(f.history?.rebuildable).toBe(false);
    expect(f.history?.rebuilding).toBeNull();
    expect(f.history?.provenance).toBe("relived");
    expect(f.tick).toBe(505);
    // the recorded causes of the rebuilt days can be followed again
    const withParent = r.events.find((e) => (e.p ?? []).length > 0);
    expect(withParent).toBeDefined();
    const chain = ask((requestId) => ({ type: "trace", id: (withParent as { id: number }).id, requestId }), "trace").chain;
    expect(chain.length).toBeGreaterThan(1);
    // and a rebuilt morning can be re-run from, arriving at the world that was saved
    ask((requestId) => ({ type: "rewind", tick: 192, mode: "rerun", requestId }), "ready");
    send({ type: "step", ticks: TICKS_PER_DAY * 5 });
    const arrived = frame();
    expect(arrived.tick).toBe(505);
    expect(arrived.history?.rerun?.verified).toBe(true);
    expect(save().hash).toBe(saved.hash);
  });

  it("a save whose record of interventions was edited does not survive the check, and nothing of the false past is kept", () => {
    const w = restoreWorld(saved.snapshot);
    w.interventions = w.interventions.filter((i) => i.origin === "scenario");
    const forged = serializeWorld(w);
    const ready = ask((requestId) => ({ type: "load", snapshot: forged, control: null, series: saved.series, controlSeries: [], requestId }), "ready");
    expect(ready.frame.history?.rebuildable).toBe(true);
    const r = ask((requestId) => ({ type: "rebuild", requestId }), "rebuilt");
    expect(r.ok).toBe(false);
    expect(frame().history?.keyTicks).toEqual([505]);
    expect(frame().history?.provenance).toBe("opened"); // it failed the check: it is still only a claim
  });

  it("a stored save that no longer matches its own hash is refused, and the world on screen stays", () => {
    const before = frame();
    const at = saved.snapshot.indexOf('"hydration":');
    const digit = at + saved.snapshot.slice(at).search(/[0-9]/);
    const altered = saved.snapshot.slice(0, digit) + (saved.snapshot[digit] === "5" ? "6" : "5") + saved.snapshot.slice(digit + 1);
    let code = "";
    try {
      ask((requestId) => ({ type: "load", snapshot: altered, control: null, series: [], controlSeries: [], hash: saved.hash, requestId }), "ready");
    } catch (err) {
      code = (err as { code?: string }).code ?? "";
    }
    expect(code).toBe("corrupt");
    expect(frame().tick).toBe(before.tick);
    // the true text with its true hash is accepted
    expect(ask((requestId) => ({ type: "load", snapshot: saved.snapshot, control: saved.control, series: saved.series, controlSeries: saved.controlSeries, hash: saved.hash, requestId }), "ready").frame.tick).toBe(505);
  });

  it("a save kept packed is a fraction of its text, opens to the same world, and is refused if a byte of it changes", () => {
    ask((requestId) => ({ type: "load", snapshot: saved.snapshot, control: saved.control, series: saved.series, controlSeries: saved.controlSeries, hash: saved.hash, requestId }), "ready");
    const packed = ask((requestId) => ({ type: "save", packed: true, requestId }), "saved").payload;
    expect(packed.snapshot).toBe("");
    expect(packed.control).toBeNull();
    expect(packed.hash).toBe(saved.hash);
    expect(packed.textBytes).toBe(saved.snapshot.length + (saved.control as string).length);
    const stored = (packed.packed?.snapshot.byteLength ?? 0) + (packed.packed?.control?.byteLength ?? 0);
    expect(stored).toBeGreaterThan(1000);
    expect(stored).toBeLessThan(packed.textBytes / 4);
    // back in from the packed form alone: the same world, hash for hash, with its twin
    stepTo(520);
    const back = ask((requestId) => ({ type: "load", snapshot: "", control: null, packed: packed.packed, series: packed.series, controlSeries: packed.controlSeries, hash: packed.hash, requestId }), "ready");
    expect(back.frame.tick).toBe(505);
    expect(back.frame.forkTick).toBe(250);
    expect(save().hash).toBe(saved.hash);
    // one changed byte: refused as damaged, and the world on screen stays
    const bytes = new Uint8Array(packed.packed?.snapshot ?? new Uint8Array(0));
    const at = Math.floor(bytes.length / 2);
    bytes[at] = (bytes[at] as number) ^ 0x55;
    let code = "";
    try {
      ask((requestId) => ({ type: "load", snapshot: "", control: null, packed: { snapshot: bytes, control: null }, series: [], controlSeries: [], hash: packed.hash, requestId }), "ready");
    } catch (err) {
      code = (err as { code?: string }).code ?? "";
    }
    expect(code).toBe("corrupt");
    expect(frame().tick).toBe(505);
  });

  it("a line that took new luck cannot be rebuilt from the seed alone, and says why", () => {
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    stepTo(200);
    ask((requestId) => ({ type: "rewind", tick: 192, mode: "branch_new_luck", requestId }), "ready");
    stepTo(300);
    const s = save();
    const ready = ask((requestId) => ({ type: "load", snapshot: s.snapshot, control: s.control, series: s.series, controlSeries: s.controlSeries, requestId }), "ready");
    expect(ready.frame.history?.rebuildable).toBe(false);
    expect(ready.frame.history?.rebuildBlocked).toBe("new_luck");
    expect(() => ask((requestId) => ({ type: "rebuild", requestId }), "rebuilt")).toThrow(/new luck/);
  });
});

describe("worker: a file out and back in", () => {
  it("an exported world opens to the same state, and an altered one is refused without changing anything", () => {
    const config = makeConfig("first_light", 5, {});
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    stepTo(120);
    ask((requestId) => ({ type: "intervene", kind: "bounty", params: {}, requestId }), "intervened");
    stepTo(260);
    const here = save();
    const exported = ask((requestId) => ({ type: "export", extras: { journal: [] }, requestId }), "exported");
    expect(exported.manifest.snapshot.sha256).toBe(here.hash);
    expect(exported.manifest.interventions.filter((i) => i.origin === "observer").map((i) => i.kind)).toEqual(["bounty"]);
    stepTo(300);
    const at = exported.text.indexOf('\\"hydration\\":');
    const digit = at + exported.text.slice(at).search(/[0-9]/);
    const altered = exported.text.slice(0, digit) + (exported.text[digit] === "5" ? "6" : "5") + exported.text.slice(digit + 1);
    expect(() => ask((requestId) => ({ type: "import", text: altered, requestId }), "ready")).toThrow();
    expect(frame().tick).toBe(300);
    const ready = ask((requestId) => ({ type: "import", text: exported.text, requestId }), "ready");
    expect(ready.frame.tick).toBe(260);
    expect(ready.frame.forkTick).toBe(120);
    expect(ready.imported?.manifest.snapshot.sha256).toBe(here.hash);
    expect(save().hash).toBe(here.hash);
    expect(ready.series).toEqual(here.series);
  });
});

describe("worker: a recording beside the engine's own minds", () => {
  it("a recording with outside minds gets a twin of the same seed with the built-in planner, and the comparison is named for what it is", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "public", "recordings");
    const file = readdirSync(dir).find((f) => f.endsWith(".json") && f !== "index.json");
    expect(file).toBeDefined();
    const recording = JSON.parse(readFileSync(join(dir, file as string), "utf8")) as Recording;
    const ready = ask((requestId) => ({ type: "replay", recording, requestId }), "ready");
    expect(ready.frame.replay?.state).toBe("playing");
    expect(ready.frame.hasTwin).toBe(true);
    expect(ready.frame.forkTick).toBe(-1);
    expect(ready.controlSeries.length).toBe(1);
    send({ type: "step", ticks: 200 });
    const f = frame();
    expect(f.replay?.state).not.toBe("mismatch");
    const view = ask((requestId) => ({ type: "compare", requestId }), "compare").view;
    expect(view?.kind).toBe("recording");
    expect(view?.interventions).toEqual([]);
    expect(view?.treated.summary.alive).toBe(alive(f));
    send({ type: "view", twin: true });
    const twin = frame();
    expect(twin.viewing).toBe("twin");
    expect(twin.tick).toBe(f.tick);
    expect(alive(twin)).toBe(view?.control.summary.alive);
    // a recording is what happened: it cannot be changed, whichever world is on screen
    expect(ask((requestId) => ({ type: "intervene", kind: "bounty", params: {}, requestId }), "intervened")).toMatchObject({ ok: false, reason: "recording" });
    send({ type: "view", twin: false });
    expect(frame().viewing).toBe("world");
  });
});

describe("worker: the event ledger", () => {
  interface Line {
    id: number;
    t: number;
    k: string;
    p?: number[];
  }
  const read = (text: string): { header: Record<string, unknown>; events: Line[] } => {
    const lines = text.trimEnd().split("\n");
    return { header: JSON.parse(lines[0] as string) as Record<string, unknown>, events: lines.slice(1).map((l) => JSON.parse(l) as Line) };
  };

  it("is the engine's own list of what happened: consecutive ids from the first event, time never running backwards, every recorded cause earlier than its effect", () => {
    ask((requestId) => ({ type: "init", config: makeConfig("first_light", 3, {}), requestId }), "ready");
    stepTo(300);
    const r = ask((requestId) => ({ type: "ledger", requestId }), "ledger");
    const { header, events } = read(r.text);
    expect(header.format).toBe("tabula-rasa/ledger");
    expect(header.seed).toBe(3);
    expect(header.tick).toBe(300);
    expect(r.complete).toBe(true);
    expect(header.complete).toBe(true);
    expect(events.length).toBe(r.events);
    expect(events.length).toBe(header.eventsEverLogged);
    expect(events.length).toBeGreaterThan(500);
    expect(events.every((e, i) => e.id === i)).toBe(true);
    expect(events.every((e, i) => i === 0 || e.t >= (events[i - 1] as Line).t)).toBe(true);
    let causes = 0;
    let wrong = 0;
    for (const e of events)
      for (const p of e.p ?? []) {
        causes++;
        if (!(p >= 0 && p < e.id)) wrong++;
      }
    expect(causes).toBeGreaterThan(100);
    expect(wrong).toBe(0);
  });

  it("a loaded world's ledger says it is partial, until its past has been lived again", () => {
    const s = save();
    ask((requestId) => ({ type: "load", snapshot: s.snapshot, control: s.control, series: s.series, controlSeries: s.controlSeries, requestId }), "ready");
    stepTo(320);
    let r = ask((requestId) => ({ type: "ledger", requestId }), "ledger");
    expect(r.complete).toBe(false);
    expect(r.firstTick).toBeGreaterThanOrEqual(300);
    expect(read(r.text).header.complete).toBe(false);
    expect(ask((requestId) => ({ type: "rebuild", requestId }), "rebuilt").ok).toBe(true);
    r = ask((requestId) => ({ type: "ledger", requestId }), "ledger");
    expect(r.complete).toBe(true);
    const { events } = read(r.text);
    expect(events.every((e, i) => e.id === i)).toBe(true);
    expect((events[events.length - 1] as Line).t).toBeLessThanOrEqual(320);
  });
});

describe("worker: time is driven in many ways, the world in one", () => {
  const config = makeConfig("first_light", 21, {});

  /** Let the worker's own clock run (as "play" does) until the world has reached `tick`, then stop. */
  function playTo(tick: number): void {
    send({ type: "play" });
    for (let i = 0; i < 20_000 && frame().tick < tick; i++) vi.advanceTimersByTime(25);
    send({ type: "pause" });
  }

  it("single steps, long steps, play at any speed, any frame rate and any pauses arrive at the same world at the same tick", () => {
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    stepTo(1100);
    const plain = save();

    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    send({ type: "frameRate", hz: 12 });
    send({ type: "speed", tps: 16 });
    playTo(40);
    send({ type: "frameRate", hz: 60 });
    for (let i = 0; i < 7; i++) send({ type: "step", ticks: 1 });
    send({ type: "speed", tps: 128 });
    playTo(150);
    // a long gap with nothing running (a hidden tab, a sleeping phone): no burst of catching up afterwards
    const before = frame().tick;
    vi.advanceTimersByTime(90_000);
    expect(frame().tick).toBe(before);
    // the fastest speed at the slowest frame rate: hundreds of ticks between two frames
    send({ type: "frameRate", hz: 4 });
    send({ type: "speed", tps: 4096 });
    playTo(200);
    expect(frame().tick).toBeGreaterThan(400);
    send({ type: "resync" });
    // looking at things changes nothing
    ask((requestId) => ({ type: "inspectAgent", id: 5, requestId }), "agent");
    ask((requestId) => ({ type: "inspectTile", x: 20, y: 20, requestId }), "tile");
    ask((requestId) => ({ type: "civics", requestId }), "civics");
    ask((requestId) => ({ type: "branches", requestId }), "branches");
    ask((requestId) => ({ type: "ledger", requestId }), "ledger");
    expect(frame().tick).toBeLessThanOrEqual(1100);
    stepTo(1100);
    const driven = save();
    expect(driven.tick).toBe(1100);
    expect(driven.hash).toBe(plain.hash);
  });

  it("after a long suspension while playing, time resumes at its pace instead of replaying the gap", () => {
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    send({ type: "speed", tps: 2 });
    send({ type: "play" });
    const a = frame().tick;
    // ten minutes pass in one jump, as when a tab is frozen and thawed
    vi.setSystemTime(Date.now() + 600_000);
    vi.advanceTimersByTime(1000);
    const b = frame().tick;
    send({ type: "pause" });
    // at two ticks a second, a second of running is a couple of ticks — not the twelve hundred the gap would be
    expect(b - a).toBeLessThanOrEqual(6);
  });
});

describe("worker: the world is lived at its own pace, the picture sent at the page's", () => {
  const config = makeConfig("first_light", 33, {});
  const framesSent = (): ViewFrame[] => out.flatMap((m) => (m.type === "frame" ? [m.frame] : []));
  /** Start a world and leave nothing owed: the frame the loop has sent is taken. */
  function begin(): void {
    page.taking = true;
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    // the rate frames are asked for at outlives a world (an earlier test left it at four a second)
    send({ type: "frameRate", hz: 30 });
    frame();
    vi.advanceTimersByTime(1);
    carried.length = 0;
    out.length = 0;
  }

  it("a page that takes each frame at once is sent them at the rate asked", () => {
    begin();
    send({ type: "speed", tps: 128 });
    send({ type: "play" });
    vi.advanceTimersByTime(3000);
    send({ type: "pause" });
    // thirty a second (the loop turns every 33 ms: thirty turns and a part of one in each second)
    expect(framesSent().length).toBeGreaterThanOrEqual(88);
    expect(framesSent().length).toBeLessThanOrEqual(92);
    send({ type: "frameRate", hz: 12 });
    out.length = 0;
    vi.advanceTimersByTime(3000);
    expect(framesSent().length).toBeGreaterThanOrEqual(35);
    expect(framesSent().length).toBeLessThanOrEqual(37);
    send({ type: "frameRate", hz: 30 });
  });

  it("no second frame is sent until the first is taken; the world runs on; the frame sent then shows it as it is, with everything the missing ones would have carried", () => {
    // what a page that keeps up is shown, to compare with: every event of the first days, and the world at their end
    begin();
    const until = 4 * TICKS_PER_DAY + 40;
    stepTo(until);
    vi.advanceTimersByTime(1);
    const shown = carried.filter((e) => e.t <= until).map((e) => e.id);
    const reference = save();
    expect(reference.tick).toBe(until);
    expect(shown.length).toBeGreaterThan(50);
    expect(new Set(shown).size).toBe(shown.length);

    // the same world, and a page that stops taking frames while it plays at the fastest speed
    begin();
    page.taking = false;
    send({ type: "speed", tps: 128 });
    send({ type: "play" });
    vi.advanceTimersByTime(2400);
    // one frame went, in the first turn of the loop, and none after it, for all of 2.4 seconds
    expect(framesSent().length).toBe(1);
    const first = framesSent()[0] as ViewFrame;
    // the world did not wait for the page: more than two days have passed
    const now = save().tick;
    expect(now).toBeGreaterThan(2 * TICKS_PER_DAY);
    expect(now).toBeGreaterThan(first.tick + 200);
    expect(now).toBeLessThan(until);
    send({ type: "pause" });

    // the page takes the frame: the next is sent at once, not at the next turn of the loop, and it is the world as it is now
    out.length = 0;
    send({ type: "taken" });
    expect(framesSent().length).toBe(1);
    const next = framesSent()[0] as ViewFrame;
    expect(next.tick).toBe(now);
    expect(next.playing).toBe(false);
    // a list that is sent when it changes (the day's worn paths) comes with it, having changed while nothing was sent
    expect(next.traffic).not.toBeNull();
    // and nothing more until that one is taken, however long the loop turns
    vi.advanceTimersByTime(1000);
    expect(framesSent().length).toBe(1);
    page.taking = true;
    send({ type: "taken" });
    vi.advanceTimersByTime(100);
    expect(framesSent().length).toBeGreaterThan(1);

    // every event the page that kept up was shown, this one was shown too: in two frames instead of hundreds
    const late = carried.filter((e) => e.t <= now).map((e) => e.id);
    stepTo(until);
    vi.advanceTimersByTime(1);
    const all = carried.filter((e) => e.t <= until).map((e) => e.id);
    expect(all).toEqual(shown);
    expect(late).toEqual(shown.slice(0, late.length));
    expect(late.length).toBeGreaterThan(30);
    // and what the page did or did not look at changed nothing in the world
    const lived = save();
    expect(lived.tick).toBe(until);
    expect(lived.hash).toBe(reference.hash);
  });

  it("a slow page is sent one frame for each it takes, and the world keeps the pace it would have kept", () => {
    // a page that keeps up, for the pace
    begin();
    send({ type: "speed", tps: 128 });
    send({ type: "play" });
    vi.advanceTimersByTime(4000);
    send({ type: "pause" });
    const kept = save().tick;
    expect(kept).toBeGreaterThan(400);

    // a page that takes a frame every fifth of a second
    begin();
    page.taking = false;
    send({ type: "speed", tps: 128 });
    send({ type: "play" });
    let taken = 0;
    for (let ms = 0; ms < 4000; ms += 200) {
      vi.advanceTimersByTime(200);
      send({ type: "taken" });
      taken++;
    }
    send({ type: "pause" });
    expect(save().tick).toBe(kept);
    // one sent at the start, and one for each taken
    expect(framesSent().length).toBe(taken + 1);
    // each showed the world as it was when it was sent: time on them only goes forward
    const ticks = framesSent().map((f) => f.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    expect(new Set(ticks).size).toBeGreaterThan(taken - 2);
    page.taking = true;
    send({ type: "taken" });
    vi.advanceTimersByTime(1);
  });

  it("a `taken` that answers nothing changes nothing, and a new world is shown whatever was left untaken of the old one", () => {
    begin();
    // more answers than frames: no frame is sent for them, and they buy nothing — the next frame sent
    // still has to be taken before another goes
    out.length = 0;
    for (let i = 0; i < 5; i++) send({ type: "taken" });
    expect(framesSent().length).toBe(0);
    page.taking = false;
    vi.advanceTimersByTime(300);
    expect(framesSent().length).toBe(1);
    // that frame of this world is left untaken, and another world is asked for
    const ready = ask((requestId) => ({ type: "init", config: makeConfig("first_light", 34, {}), requestId }), "ready");
    out.length = 0;
    vi.advanceTimersByTime(400);
    expect(framesSent().length).toBe(0);
    // the page answers the old world's frame (it answers every frame, whatever it does with it): the new world's first frame follows at once
    send({ type: "taken" });
    expect(framesSent().length).toBe(1);
    expect((framesSent()[0] as ViewFrame).epoch).toBe(ready.frame.epoch);
    page.taking = true;
    send({ type: "taken" });
    vi.advanceTimersByTime(1);
  });
});

describe("worker: when a world cannot be carried on", () => {
  const config = makeConfig("first_light", 12, { population: 10 });

  it("a world file that is well formed but cannot be lived is refused, and the world on hand stays", () => {
    const fresh = ask((requestId) => ({ type: "init", config, requestId }), "ready");
    expect(fresh.frame.history?.provenance).toBe("made"); // every tick of it will have been lived here
    stepTo(200);
    const exported = ask((requestId) => ({ type: "export", extras: {}, requestId }), "exported");
    stepTo(260);
    const before = save();
    // the file is exactly what was exported: every hash and every field is in order. It is the living of it that fails.
    boom.on = true;
    let refusal: { code?: string; message?: string } = {};
    try {
      ask((requestId) => ({ type: "import", text: exported.text, requestId }), "ready");
    } catch (err) {
      refusal = err as { code?: string; message?: string };
    } finally {
      boom.on = false;
    }
    expect(refusal.code).toBe("corrupt");
    expect(refusal.message).toMatch(/cannot be carried on/);
    // nothing was swapped: the world on hand is the one that was there, and it goes on
    expect(save().hash).toBe(before.hash);
    expect(stepTo(300).tick).toBe(300);
    // the same file, when the engine can live it, opens
    const opened = ask((requestId) => ({ type: "import", text: exported.text, requestId }), "ready");
    expect(opened.frame.tick).toBe(200);
    // whole, well formed and able to run — and still only a claim about its own past until that is lived again
    expect(opened.frame.history?.provenance).toBe("opened");
    expect(ask((requestId) => ({ type: "rebuild", requestId }), "rebuilt").ok).toBe(true);
    expect(frame().history?.provenance).toBe("relived");
  });

  it("if the engine throws while a world is being lived, time stops for good, the page is told in words, and a new world starts clean", () => {
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    stepTo(96);
    send({ type: "speed", tps: 64 });
    send({ type: "play" });
    expect(frame().tick).toBeGreaterThan(96);
    out.length = 0;
    boom.on = true;
    vi.advanceTimersByTime(400);
    boom.on = false;
    const faults = out.filter((m) => m.type === "error");
    expect(faults).toHaveLength(1); // said once, not once a frame
    const told = faults[0] as Extract<FromWorker, { type: "error" }>;
    expect(told.requestId).toBe(-1);
    expect(told.code).toBe("fault");
    expect(told.message).toMatch(/^This world has stopped: .*injected engine fault.*Worlds you saved earlier are untouched\.$/);
    // nothing more is asked of that world: no frame, no tick, whatever is pressed
    out.length = 0;
    send({ type: "play" });
    send({ type: "step", ticks: 10 });
    vi.advanceTimersByTime(2000);
    expect(out.filter((m) => m.type === "frame" || m.type === "day")).toHaveLength(0);
    // a single step that throws is a fault too, not a reply to nobody
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    out.length = 0;
    boom.on = true;
    send({ type: "step", ticks: 3 });
    boom.on = false;
    expect(out.filter((m) => m.type === "error" && m.code === "fault")).toHaveLength(1);
    // and a new world is a new start
    ask((requestId) => ({ type: "init", config, requestId }), "ready");
    expect(stepTo(48).tick).toBe(48);
  });
});

describe("worker: the aim on the scenario's card", () => {
  it("is answered when asked and sent each morning, for the world being lived and, once the observer has touched it, for its twin", () => {
    ask((requestId) => ({ type: "init", config: makeConfig("long_winter", 3, {}), requestId }), "ready");
    const first = ask((requestId) => ({ type: "aim", requestId }), "aim").aim;
    expect(first.twin).toBeNull();
    expect(first.yours).toEqual(expect.objectContaining({ id: "spring_60", text: "Bring three in five through to spring.", state: "open", decidedDay: null, figure: "50 of 50 alive" }));

    // two mornings pass: each morning's message carries the reading, and it is the one a question gets
    mornings.length = 0;
    stepTo(2 * TICKS_PER_DAY + 5);
    expect(mornings.map((m) => m.sample.day)).toEqual([1, 2]);
    expect(mornings[1]?.aim.twin).toBeNull();
    expect(mornings[1]?.aim.yours?.state).toBe("open");

    // the observer's hand makes a twin; at that moment the two worlds are one world, and read alike
    expect(ask((requestId) => ({ type: "intervene", kind: "blight", params: {}, requestId }), "intervened").ok).toBe(true);
    const forked = ask((requestId) => ({ type: "aim", requestId }), "aim").aim;
    expect(forked.twin).not.toBeNull();
    expect(forked.twin).toEqual(forked.yours);
    mornings.length = 0;
    stepTo(3 * TICKS_PER_DAY + 5);
    expect(mornings[0]?.aim.twin?.id).toBe("spring_60");
  });

  it("is decided on the morning spring comes, and a save opened again reads the same in both worlds", () => {
    mornings.length = 0;
    stepTo(28 * TICKS_PER_DAY + 3);
    const end = ask((requestId) => ({ type: "aim", requestId }), "aim").aim;
    expect(["met", "lost"]).toContain(end.yours?.state);
    expect(["met", "lost"]).toContain(end.twin?.state);
    // the morning it was decided said so, and no later morning said otherwise
    const states = mornings.map((m) => m.aim.yours?.state);
    expect(states[states.length - 1]).toBe(end.yours?.state);
    const decided = states.indexOf(end.yours?.state as "met" | "lost");
    expect(states.slice(decided).every((s) => s === end.yours?.state)).toBe(true);
    if (end.yours?.state === "met") expect(end.yours.decidedDay).toBe(29);

    const saved = save();
    ask((requestId) => ({ type: "load", snapshot: saved.snapshot, control: saved.control, series: saved.series, controlSeries: saved.controlSeries, requestId }), "ready");
    expect(ask((requestId) => ({ type: "aim", requestId }), "aim").aim).toEqual(end);
  });

  it("an aim with no day of reckoning is a reading from the first morning, never a verdict", () => {
    ask((requestId) => ({ type: "init", config: makeConfig("two_shores", 2, {}), requestId }), "ready");
    const aim = ask((requestId) => ({ type: "aim", requestId }), "aim").aim;
    expect(aim.yours?.state).toBe("reading");
    expect(aim.yours?.decidedDay).toBeNull();
    expect(aim.twin).toBeNull();
  });
});

describe("worker: the goal — ages, legacy and a limited hand", () => {
  it("a world without crafts is sent no progress and no limit; a world with crafts is, from its first frame", () => {
    const plain = ask((requestId) => ({ type: "init", config: makeConfig("first_light", 5, {}), requestId }), "ready");
    expect(plain.frame.progress).toBeNull();
    expect(plain.frame.hand).toBeNull();
    expect(plain.world.capacity).toBe(74);

    const ready = ask((requestId) => ({ type: "init", config: makeConfig("long_road", 5, {}), requestId }), "ready");
    expect(ready.world.capacity).toBe(174); // room for the newcomers a thriving island draws
    const p = ready.frame.progress!;
    expect(p).toMatchObject({ reached: 0, standing: 0, living: 50, twin: null, recorded: 0 });
    expect(p.knowers).toEqual([0, 0, 0, 0, 0, 0]);
    expect(p.legacy).toEqual({ total: 500, people: 500, crafts: 0, works: 0, ages: 0 });
    expect(p.next?.age).toBe(1);
    expect(ready.frame.hand).toEqual({ perSeason: 1, left: 1 });
  });

  it("the island allows one change a season: the second is refused, and the hand comes back when the season turns", () => {
    const first = ask((requestId) => ({ type: "intervene", kind: "bounty", params: { magnitude: 1000 }, requestId }), "intervened");
    expect(first.ok).toBe(true);
    expect(frame().hand).toEqual({ perSeason: 1, left: 0 });
    const second = ask((requestId) => ({ type: "intervene", kind: "windfall", params: { magnitude: 1000 }, requestId }), "intervened");
    expect(second).toMatchObject({ ok: false, reason: "limit" });
    // nothing was done: the world's own record holds one change
    const before = save();
    expect(restoreWorld(before.snapshot).interventions.filter((i) => i.origin === "observer")).toHaveLength(1);
    // summer begins on day 11 of a year of four ten-day seasons
    const f = stepTo(10 * TICKS_PER_DAY + 2);
    expect(f.cal.season).toBe(1);
    expect(f.hand).toEqual({ perSeason: 1, left: 1 });
    const third = ask((requestId) => ({ type: "intervene", kind: "stranger", params: { craft: -1 }, requestId }), "intervened");
    expect(third.ok).toBe(true);
    // the stranger knows the first craft nobody here knew, and the twin is counted beside this world
    const after = frame();
    expect(after.progress?.knowers.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(after.progress?.twin).not.toBeNull();
    expect(after.agentCount).toBeGreaterThan(50);
  });

  it("the aim of the long road is read from the state: open, with the age stood in and what the next asks for", () => {
    const aim = ask((requestId) => ({ type: "aim", requestId }), "aim").aim;
    expect(aim.yours?.id).toBe("letters_in_time");
    expect(aim.yours?.state).toBe("open");
    expect(aim.yours?.lines.join(" ")).toMatch(/They stand in the Age of/);
    expect(aim.yours?.lines.join(" ")).toMatch(/of the 50 who began are alive\. Four in five is 40/);
    expect(aim.yours?.lines.join(" ")).toMatch(/It is year 1 of 5: the fifth year ends with day 200/);
    expect(aim.yours?.figure).toMatch(/^\d+ of 50 · year 1 of 5$/);
    expect(aim.twin?.id).toBe("letters_in_time");
    // each morning's sample carries the legacy and the age, for the almanac
    mornings.length = 0;
    stepTo(12 * TICKS_PER_DAY + 2);
    const sample = mornings[mornings.length - 1]!.sample;
    expect(typeof sample.legacy).toBe("number");
    expect(sample.age).toBeGreaterThanOrEqual(0);
  });
});
