/**
 * The simulation worker, driven through its message protocol with nothing else in the room:
 * no browser, no renderer, no store. Everything the History panel, the twin view and the
 * Compare panel can ask for is asked here, and the answers are checked against the engine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TICKS_PER_DAY, makeConfig, restoreWorld, serializeWorld, worldDigest } from "@/engine";
import { AF, AGENT_STRIDE, type FromWorker, type Recording, type SavePayload, type ToWorker, type ViewFrame } from "./protocol";

const out: FromWorker[] = [];
// messages cross the boundary by structured clone, as they do between a page and a real worker:
// neither side can reach into the other's arrays
const fake = {
  postMessage: (m: FromWorker) => {
    out.push(structuredClone(m));
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
