/**
 * GameController: the one object that connects the simulation worker, the renderer
 * and the UI store. React components call its methods; it never exposes a way to
 * write simulation state other than time control and logged observer interventions.
 */
import { TICKS_PER_DAY, makeConfig, type WorldConfig } from "@/engine";
import { AUTOSAVE_ID, deleteSave, getSave, listSaves, putSave, toRecord } from "@/persist/saves";
import { WorldRenderer, type Pick, type Quality } from "@/render/WorldRenderer";
import { SPEEDS, loadSettings, saveSettings, useGame, type Panel, type Settings } from "@/store/game";
import { SimClient } from "@/store/simClient";
import { AF, AGENT_STRIDE, type ViewFrame } from "@/worker/protocol";
import { chronicle, type ChronicleEntry } from "./text";

const CHRONICLE_CAP = 600;

function autoQuality(): Quality {
  if (typeof window === "undefined") return "medium";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse || small) return "medium";
  return cores >= 6 ? "high" : "medium";
}

export class GameController {
  private client: SimClient | null = null;
  private renderer: WorldRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private overlay: HTMLElement | null = null;
  private nameTag: HTMLElement | null = null;
  private lastHud = 0;
  private lastInspect = 0;
  private lastAutosaveDay = -1;
  private pendingChronicle: ChronicleEntry[] = [];
  private latest: ViewFrame | null = null;
  private inspecting = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private qualityOverride: Quality | null = null;
  /** Bumped by every request for a new world; replies to superseded requests are dropped. */
  private generation = 0;
  /** Epoch of the world the renderer currently shows; frames from any other world are ignored. */
  private epoch = -1;

  private pixelRatioCap: number | undefined;

  /** `?q=low|medium|high` forces a quality preset (used by automated tests on software renderers). */
  setQualityOverride(q: Quality | null): void {
    this.qualityOverride = q;
  }

  /** `?pr=0.6` caps the internal render resolution (drawing only; never the simulation). */
  setPixelRatioCap(cap: number | undefined): void {
    this.pixelRatioCap = cap;
  }

  private quality(settings: Settings): Quality {
    return this.qualityOverride ?? (settings.quality === "auto" ? autoQuality() : settings.quality);
  }

  attach(canvas: HTMLCanvasElement, overlay: HTMLElement, nameTag: HTMLElement): void {
    this.canvas = canvas;
    this.overlay = overlay;
    this.nameTag = nameTag;
    const settings = loadSettings();
    useGame.getState().set({ settings });
    this.client = new SimClient();
    this.client.onFrame = (frame) => this.onFrame(frame);
    this.client.onDay = (sample, control) => {
      const s = useGame.getState();
      s.set({ series: [...s.series, sample], controlSeries: control ? [...s.controlSeries, control] : s.controlSeries });
    };
    this.client.onError = (message) => useGame.getState().set({ error: message });
    void this.refreshSaves();
  }

  detach(): void {
    this.client?.dispose();
    this.client = null;
    this.renderer?.dispose();
    this.renderer = null;
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  private ensureRenderer(): WorldRenderer {
    if (this.renderer) return this.renderer;
    const settings = useGame.getState().settings;
    this.renderer = new WorldRenderer(this.canvas!, this.overlay, {
      quality: this.quality(settings),
      reducedMotion: settings.reducedMotion,
      ...(this.pixelRatioCap !== undefined ? { maxPixelRatio: this.pixelRatioCap } : {}),
      onPick: (pick) => this.select(pick),
      onUserCamera: () => {
        if (useGame.getState().following) useGame.getState().set({ following: false });
      },
    });
    this.renderer.setNameTag(this.nameTag);
    return this.renderer;
  }

  /** Rebuild the renderer (after a quality or motion setting change). */
  private rebuildRenderer(): void {
    const world = useGame.getState().world;
    this.renderer?.dispose();
    this.renderer = null;
    if (!world) return;
    const r = this.ensureRenderer();
    r.setWorld(world);
    if (this.latest) r.pushFrame({ ...this.latest, structures: null, piles: null, traffic: null, roster: null, events: [] });
    r.start();
    this.client?.resync();
  }

  // ───────────────────────── frames

  private onFrame(frame: ViewFrame): void {
    if (frame.epoch !== this.epoch) return;
    this.latest = frame;
    this.renderer?.pushFrame(frame);
    const state = useGame.getState();
    if (frame.events.length) {
      for (const e of frame.events) {
        const entry = chronicle(e, state.world, state.roster);
        if (entry) this.pendingChronicle.push(entry);
      }
    }
    const now = performance.now();
    if (now - this.lastHud > 120) {
      this.lastHud = now;
      const patch: Partial<ReturnType<typeof useGame.getState>> = {
        hud: {
          tick: frame.tick,
          cal: frame.cal,
          climate: frame.climate,
          alive: frame.alive,
          population: frame.population,
          agentCount: frame.agentCount,
          playing: frame.playing,
          tps: frame.tps,
          treated: frame.treated,
        },
      };
      if (frame.roster) patch.roster = frame.roster;
      if (this.pendingChronicle.length) {
        const merged = [...state.chronicle, ...this.pendingChronicle];
        patch.chronicle = merged.length > CHRONICLE_CAP ? merged.slice(merged.length - CHRONICLE_CAP) : merged;
        this.pendingChronicle = [];
      }
      state.set(patch);
    } else if (frame.roster) {
      state.set({ roster: frame.roster });
    }
    if (state.selection && now - this.lastInspect > 280) {
      this.lastInspect = now;
      void this.refreshInspector();
    }
    // autosave every second simulated day while a real game is running
    if (!state.vista && frame.playing && frame.cal.tickOfDay === 0 && frame.cal.day > 0 && frame.cal.day % 2 === 0 && frame.cal.day !== this.lastAutosaveDay) {
      this.lastAutosaveDay = frame.cal.day;
      void this.save(AUTOSAVE_ID, "Autosave", true);
    }
  }

  private async refreshInspector(): Promise<void> {
    if (this.inspecting || !this.client) return;
    const sel = useGame.getState().selection;
    if (!sel) return;
    this.inspecting = true;
    try {
      if (sel.type === "agent") {
        const detail = await this.client.inspectAgent(sel.id);
        if (useGame.getState().selection === sel) useGame.getState().set({ agentDetail: detail, tileDetail: null });
      } else {
        const detail = await this.client.inspectTile(sel.x, sel.y);
        if (useGame.getState().selection === sel) useGame.getState().set({ tileDetail: detail, agentDetail: null });
      }
    } catch {
      // the worker was replaced while a request was in flight; the next frame will retry
    } finally {
      this.inspecting = false;
    }
  }

  // ───────────────────────── worlds

  private async adopt(ready: Awaited<ReturnType<SimClient["init"]>>, vista: boolean): Promise<void> {
    const renderer = this.ensureRenderer();
    renderer.setWorld(ready.world);
    this.epoch = ready.frame.epoch;
    this.latest = ready.frame;
    renderer.pushFrame(ready.frame);
    renderer.start();
    this.pendingChronicle = [];
    this.lastAutosaveDay = -1;
    useGame.getState().set({
      world: ready.world,
      roster: ready.world.agents,
      hud: {
        tick: ready.frame.tick,
        cal: ready.frame.cal,
        climate: ready.frame.climate,
        alive: ready.frame.alive,
        population: ready.frame.population,
        agentCount: ready.frame.agentCount,
        playing: false,
        tps: 0,
        treated: ready.frame.treated,
      },
      chronicle: [],
      series: ready.series,
      controlSeries: [],
      forkDay: -1,
      compare: null,
      selection: null,
      agentDetail: null,
      tileDetail: null,
      following: false,
      vista,
      error: null,
    });
    renderer.select(null);
    renderer.camera()?.setAutoOrbit(vista ? 0.035 : 0);
  }

  /** The attract-mode world behind the title: a real simulation, slowly turning. */
  async startVista(): Promise<void> {
    if (!this.client) return;
    const gen = ++this.generation;
    const config = makeConfig("first_light", 20261125 % 997, { startDay: 12 });
    const ready = await this.client.init(config);
    if (gen !== this.generation) return; // the player already asked for another world
    await this.adopt(ready, true);
    // begin in the morning and let the day pass slowly, so the first impression is a lit, busy island
    this.client.step(14);
    this.client.setSpeed(1.5);
    this.client.play();
    useGame.getState().set({ phase: "title" });
  }

  async newWorld(config: WorldConfig): Promise<void> {
    if (!this.client) return;
    const gen = ++this.generation;
    useGame.getState().set({ phase: "loading", panel: "none" });
    try {
      const ready = await this.client.init(config);
      if (gen !== this.generation) return;
      await this.adopt(ready, false);
      this.setSpeed(useGame.getState().speed);
      const settings = useGame.getState().settings;
      useGame.getState().set({ phase: "playing", tutorialStep: settings.tutorialDone ? -1 : 0 });
    } catch (err) {
      useGame.getState().set({ phase: "setup", error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ───────────────────────── time

  play(): void {
    this.client?.play();
    this.advanceTutorial(0);
  }
  pause(): void {
    this.client?.pause();
  }
  toggle(): void {
    if (useGame.getState().hud?.playing) this.pause();
    else this.play();
  }
  step(ticks = 1): void {
    this.client?.step(ticks);
  }
  stepDay(): void {
    const tod = useGame.getState().hud?.cal.tickOfDay ?? 0;
    this.client?.step(TICKS_PER_DAY - tod);
  }
  setSpeed(index: number): void {
    const i = Math.max(0, Math.min(SPEEDS.length - 1, index));
    useGame.getState().set({ speed: i });
    this.client?.setSpeed(SPEEDS[i]!.tps);
  }

  // ───────────────────────── selection & camera

  select(pick: Pick | null): void {
    const state = useGame.getState();
    if (state.vista) return;
    state.set({ selection: pick, following: false, agentDetail: pick?.type === "agent" ? state.agentDetail : null, tileDetail: null });
    this.renderer?.select(pick);
    this.lastInspect = 0;
    if (pick) {
      void this.refreshInspector();
      if (pick.type === "agent") this.advanceTutorial(1);
    } else {
      state.set({ agentDetail: null, tileDetail: null });
    }
  }

  selectAgent(id: number, focus = true): void {
    this.select({ type: "agent", id });
    if (focus) this.renderer?.focusAgent(id);
  }

  follow(on: boolean): void {
    this.renderer?.followSelection(on);
    useGame.getState().set({ following: on && (this.renderer?.isFollowing() ?? false) });
  }

  focusTile(x: number, y: number): void {
    this.renderer?.focusTile(x, y);
  }

  jumpTo(entry: ChronicleEntry): void {
    const agent = entry.agents[0];
    if (entry.x !== undefined && entry.y !== undefined) this.renderer?.focusTile(entry.x, entry.y, 30);
    else if (agent !== undefined) this.renderer?.focusAgent(agent, 28);
    if (agent !== undefined && this.latest && (this.latest.agents[agent * AGENT_STRIDE + AF.alive] ?? 0) > 0.5) this.select({ type: "agent", id: agent });
  }

  camera() {
    return this.renderer?.camera() ?? null;
  }

  rendererStats() {
    return this.renderer?.stats() ?? null;
  }

  screenOf(agent: number) {
    return this.renderer?.screenOf(agent) ?? null;
  }

  // ───────────────────────── interventions & comparison

  async intervene(kind: string, params: Record<string, number>): Promise<void> {
    if (!this.client) return;
    const result = await this.client.intervene(kind, params);
    if (result.ok) {
      const state = useGame.getState();
      state.set({ forkDay: state.forkDay >= 0 ? state.forkDay : Math.floor(result.forkTick / TICKS_PER_DAY), panel: "none" });
      this.toast("The timeline forked. The untouched world keeps running for comparison.");
      this.advanceTutorial(3);
    } else {
      this.toast("That intervention could not be applied.");
    }
  }

  async refreshCompare(): Promise<void> {
    if (!this.client) return;
    const view = await this.client.compare();
    useGame.getState().set({ compare: view });
    if (view) this.advanceTutorial(4);
  }

  // ───────────────────────── panels, settings, tutorial

  openPanel(panel: Panel): void {
    const state = useGame.getState();
    const next = state.panel === panel ? "none" : panel;
    state.set({ panel: next });
    if (next === "compare") void this.refreshCompare();
    if (next === "saves" || next === "menu") void this.refreshSaves();
    if (next === "chronicle") this.advanceTutorial(2);
  }

  updateSettings(patch: Partial<Settings>): void {
    const state = useGame.getState();
    const settings = { ...state.settings, ...patch };
    state.set({ settings });
    saveSettings(settings);
    if (patch.quality !== undefined || patch.reducedMotion !== undefined) this.rebuildRenderer();
  }

  /** Advance the coach marks when the player has done what step `done` asked for. */
  advanceTutorial(done: number): void {
    const state = useGame.getState();
    if (state.tutorialStep !== done) return;
    const next = done + 1;
    if (next > 4) this.finishTutorial();
    else state.set({ tutorialStep: next });
  }

  finishTutorial(): void {
    const state = useGame.getState();
    state.set({ tutorialStep: -1 });
    this.updateSettings({ tutorialDone: true });
  }

  toast(message: string): void {
    useGame.getState().set({ toast: message });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => useGame.getState().set({ toast: null }), 5200);
  }

  // ───────────────────────── saves

  async refreshSaves(): Promise<void> {
    try {
      useGame.getState().set({ saves: await listSaves() });
    } catch {
      useGame.getState().set({ saves: [] });
    }
  }

  async save(id?: string, name?: string, quiet = false): Promise<void> {
    if (!this.client) return;
    try {
      const payload = await this.client.save();
      const stamp = Date.now();
      const saveId = id ?? `save-${stamp}`;
      const label = name ?? `${payload.scenario.replace(/_/g, " ")} · seed ${payload.seed} · day ${payload.day + 1}`;
      await putSave(toRecord(saveId, label, payload, stamp));
      await this.refreshSaves();
      if (!quiet) this.toast(`Saved. Snapshot ${payload.hash.slice(0, 12)}…`);
    } catch (err) {
      if (!quiet) this.toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async load(id: string): Promise<void> {
    if (!this.client) return;
    const gen = ++this.generation;
    useGame.getState().set({ phase: "loading", panel: "none" });
    try {
      const record = await getSave(id);
      if (!record) throw new Error("That save no longer exists.");
      const ready = await this.client.load(record.snapshot, record.control, record.series, record.controlSeries);
      if (gen !== this.generation) return;
      await this.adopt(ready, false);
      const forkDay = record.control ? Math.max(0, record.series.length - record.controlSeries.length) : -1;
      useGame.getState().set({ phase: "playing", controlSeries: record.controlSeries, forkDay, tutorialStep: -1 });
      this.setSpeed(useGame.getState().speed);
      this.toast(`Loaded “${record.name}”.`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message =
        code === "terrain_drift" || code === "schema"
          ? "This save was made by an incompatible version and cannot be loaded."
          : code === "corrupt" || code === "format" || code === "config"
            ? "This save is damaged and was not loaded."
            : err instanceof Error
              ? err.message
              : String(err);
      useGame.getState().set({ phase: useGame.getState().world && !useGame.getState().vista ? "playing" : "title", error: message });
      this.toast(message);
    }
  }

  async remove(id: string): Promise<void> {
    await deleteSave(id);
    await this.refreshSaves();
  }

  async toTitle(): Promise<void> {
    this.pause();
    useGame.getState().set({ panel: "none", selection: null, agentDetail: null, tileDetail: null });
    await this.startVista();
  }
}
