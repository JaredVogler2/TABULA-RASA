/**
 * UI-side handle on the simulation worker: typed requests with promises, and callbacks
 * for the continuous streams (frames, daily samples).
 */
import type { Manifest, SimEvent, WorldConfig } from "@/engine";
import type {
  AgentDetail,
  AimPair,
  BranchView,
  CivicsView,
  CompareView,
  DaySample,
  FromWorker,
  PackedWorld,
  Recording,
  SavePayload,
  StaticWorldView,
  TileDetail,
  ToWorker,
  ViewFrame,
  WorkerPerf,
} from "@/worker/protocol";

type Pending = { resolve: (value: FromWorker) => void; reject: (reason: Error) => void };

export interface ReadyWorld {
  world: StaticWorldView;
  frame: ViewFrame;
  series: DaySample[];
  /** The untouched twin's daily samples, when the world arrives with one (a load, a rewind, an import). */
  controlSeries?: DaySample[];
  /** Present when the world came from a file: what the file says it is, and what was kept beside it. */
  imported?: { manifest: Manifest; extras: Record<string, unknown> };
}

export class SimClient {
  private worker: Worker;
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  onFrame: ((frame: ViewFrame) => void) | null = null;
  onDay: ((sample: DaySample, control: DaySample | null, aim: AimPair) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      const message = event.message || "simulation worker failed";
      for (const p of this.pending.values()) p.reject(new Error(message));
      this.pending.clear();
      this.onError?.(message);
    };
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case "frame":
        // every frame is answered, whatever becomes of it here: the worker sends the next only then
        try {
          this.onFrame?.(msg.frame);
        } finally {
          this.send({ type: "taken" });
        }
        return;
      case "day":
        this.onDay?.(msg.sample, msg.control, msg.aim);
        return;
      case "error": {
        const p = this.pending.get(msg.requestId);
        if (p) {
          this.pending.delete(msg.requestId);
          const err = new Error(msg.message);
          (err as Error & { code?: string }).code = msg.code;
          p.reject(err);
        } else {
          this.onError?.(msg.message);
        }
        return;
      }
      default: {
        const p = this.pending.get(msg.requestId);
        if (p) {
          this.pending.delete(msg.requestId);
          p.resolve(msg);
        }
      }
    }
  }

  private send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  private request<T extends FromWorker["type"]>(build: (requestId: number) => ToWorker, expect: T): Promise<Extract<FromWorker, { type: T }>> {
    const requestId = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => {
          if (value.type === expect) resolve(value as Extract<FromWorker, { type: T }>);
          else reject(new Error(`unexpected reply ${value.type}`));
        },
        reject,
      });
      this.send(build(requestId));
    });
  }

  async init(config: WorldConfig): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "init", config, requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series };
  }

  async load(snapshot: string, control: string | null, series: DaySample[], controlSeries: DaySample[], hash?: string, packed?: PackedWorld | null): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "load", snapshot, control, ...(packed ? { packed } : {}), series, controlSeries, ...(hash !== undefined ? { hash } : {}), requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series, controlSeries: r.controlSeries };
  }

  /** Watch a recorded run: the world is rebuilt from its configuration and its tape, consulting no mind. */
  async replay(recording: Recording): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "replay", recording, requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series, controlSeries: r.controlSeries };
  }

  play(): void {
    this.send({ type: "play" });
  }
  pause(): void {
    this.send({ type: "pause" });
  }
  setSpeed(tps: number): void {
    this.send({ type: "speed", tps });
  }
  step(ticks: number): void {
    this.send({ type: "step", ticks });
  }
  setFrameRate(hz: number): void {
    this.send({ type: "frameRate", hz });
  }
  resync(): void {
    this.send({ type: "resync" });
  }

  async intervene(kind: string, params: Record<string, number>): Promise<{ ok: boolean; forkTick: number; reason?: string }> {
    const r = await this.request((requestId) => ({ type: "intervene", kind, params, requestId }), "intervened");
    return { ok: r.ok, forkTick: r.forkTick, ...(r.reason ? { reason: r.reason } : {}) };
  }

  async inspectAgent(id: number): Promise<AgentDetail | null> {
    return (await this.request((requestId) => ({ type: "inspectAgent", id, requestId }), "agent")).detail;
  }

  async inspectTile(x: number, y: number): Promise<TileDetail | null> {
    return (await this.request((requestId) => ({ type: "inspectTile", x, y, requestId }), "tile")).detail;
  }

  async civics(): Promise<CivicsView | null> {
    return (await this.request((requestId) => ({ type: "civics", requestId }), "civics")).view;
  }

  /** How the scenario's stated aim stands, in the world being lived and in its twin. */
  async aim(): Promise<AimPair> {
    return (await this.request((requestId) => ({ type: "aim", requestId }), "aim")).aim;
  }

  async compare(): Promise<CompareView | null> {
    return (await this.request((requestId) => ({ type: "compare", requestId }), "compare")).view;
  }

  /** The world as it stands. `packed` asks for it gzip-compressed, the form the browser's storage keeps. */
  async save(packed = false): Promise<SavePayload> {
    return (await this.request((requestId) => ({ type: "save", packed, requestId }), "saved")).payload;
  }

  /** Go back to a stored moment: re-run from it exactly, or leave from it on a new line. */
  async rewind(tick: number, mode: "rerun" | "branch" | "branch_new_luck"): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "rewind", tick, mode, requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series, controlSeries: r.controlSeries };
  }

  async branches(): Promise<BranchView[]> {
    return (await this.request((requestId) => ({ type: "branches", requestId }), "branches")).list;
  }

  async switchBranch(id: string): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "switchBranch", id, requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series, controlSeries: r.controlSeries };
  }

  async exportWorld(extras: Record<string, unknown>): Promise<{ text: string; manifest: Manifest }> {
    const r = await this.request((requestId) => ({ type: "export", extras, requestId }), "exported");
    return { text: r.text, manifest: r.manifest };
  }

  async importWorld(text: string): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "import", text, requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series, controlSeries: r.controlSeries, ...(r.imported ? { imported: r.imported } : {}) };
  }

  /** Measurements from inside the worker: recent tick times, heap, what history it holds. */
  async perf(): Promise<WorkerPerf> {
    return (await this.request((requestId) => ({ type: "perf", requestId }), "perf")).perf;
  }

  /** The event ledger held in memory for the world being lived, as JSON Lines with a header line. */
  async ledger(): Promise<Extract<FromWorker, { type: "ledger" }>> {
    return this.request((requestId) => ({ type: "ledger", requestId }), "ledger");
  }

  /** Look at the twin instead of the world being lived, or back. Changes nothing in either. */
  view(twin: boolean): void {
    this.send({ type: "view", twin });
  }

  /** Re-live a loaded world's past from its seed; resolves when it has been checked against the world as loaded. */
  async rebuild(): Promise<Extract<FromWorker, { type: "rebuilt" }>> {
    return this.request((requestId) => ({ type: "rebuild", requestId }), "rebuilt");
  }

  /** The engine's recorded causes of an event, nearest first. */
  async trace(id: number): Promise<SimEvent[]> {
    return (await this.request((requestId) => ({ type: "trace", id, requestId }), "trace")).chain;
  }

  /**
   * Stop the worker. Anything still waiting for an answer is told so with an error whose `code`
   * is "disposed": leaving the page is not a failure, and callers that started long requests
   * (a world being shaped behind the title) check for it rather than report it.
   */
  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(Object.assign(new Error("simulation worker disposed"), { code: "disposed" }));
    this.pending.clear();
  }
}
