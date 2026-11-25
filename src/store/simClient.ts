/**
 * UI-side handle on the simulation worker: typed requests with promises, and callbacks
 * for the continuous streams (frames, daily samples).
 */
import type { WorldConfig } from "@/engine";
import type {
  AgentDetail,
  CompareView,
  DaySample,
  FromWorker,
  SavePayload,
  StaticWorldView,
  TileDetail,
  ToWorker,
  ViewFrame,
} from "@/worker/protocol";

type Pending = { resolve: (value: FromWorker) => void; reject: (reason: Error) => void };

export interface ReadyWorld {
  world: StaticWorldView;
  frame: ViewFrame;
  series: DaySample[];
}

export class SimClient {
  private worker: Worker;
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  onFrame: ((frame: ViewFrame) => void) | null = null;
  onDay: ((sample: DaySample, control: DaySample | null) => void) | null = null;
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
        this.onFrame?.(msg.frame);
        return;
      case "day":
        this.onDay?.(msg.sample, msg.control);
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

  async load(snapshot: string, control: string | null, series: DaySample[], controlSeries: DaySample[]): Promise<ReadyWorld> {
    const r = await this.request((requestId) => ({ type: "load", snapshot, control, series, controlSeries, requestId }), "ready");
    return { world: r.world, frame: r.frame, series: r.series };
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

  async compare(): Promise<CompareView | null> {
    return (await this.request((requestId) => ({ type: "compare", requestId }), "compare")).view;
  }

  async save(): Promise<SavePayload> {
    return (await this.request((requestId) => ({ type: "save", requestId }), "saved")).payload;
  }

  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("simulation worker disposed"));
    this.pending.clear();
  }
}
