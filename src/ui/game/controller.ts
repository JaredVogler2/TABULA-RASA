/**
 * GameController: the one object that connects the simulation worker, the renderer
 * and the UI store. React components call its methods; it never exposes a way to
 * write simulation state other than time control and logged observer interventions.
 */
import { Soundscape, type Cue, type SoundLevels } from "@/audio/soundscape";
import { TICKS_PER_DAY, makeConfig, type WorldConfig } from "@/engine";
import { AUTOSAVE_ID, deleteSave, getSave, listSaves, putSave, toRecord } from "@/persist/saves";
import { WorldRenderer, type Pick, type Quality } from "@/render/WorldRenderer";
import { SPEEDS, loadSettings, saveSettings, useGame, type Panel, type Settings } from "@/store/game";
import { SimClient } from "@/store/simClient";
import { AF, AGENT_STRIDE, type CivicMark, type Recording, type StructureView, type ViewFrame } from "@/worker/protocol";
import { JOURNAL, entryFrom, pageFor, type JournalEntry } from "./journal";
import { chronicle, type ChronicleEntry } from "./text";

const CHRONICLE_CAP = 600;

/** World events that are marked by a tone when sound is on; the most consequential wins when several coincide. */
const CUES: Record<string, { cue: Cue; rank: number }> = {
  ratified: { cue: "ratified", rank: 6 },
  dissolved: { cue: "dissolved", rank: 5 },
  lapsed: { cue: "dissolved", rank: 5 },
  death: { cue: "death", rank: 4 },
  arrival: { cue: "arrival", rank: 3 },
  season: { cue: "season", rank: 2 },
  built: { cue: "built", rank: 1 },
};

const BUNDLED = /^[a-z0-9][a-z0-9-]{2,60}$/;
const SERVER_RUN = /^run_[a-z0-9_]{6,40}$/;

/** Load a recording: a bundled file, or a run assembled page by page from this server. */
export async function fetchRecording(ref: string): Promise<Recording> {
  if (SERVER_RUN.test(ref)) {
    const epochs: Recording["epochs"] = [];
    const tape: Recording["tape"] = [];
    interface RunHead {
      id: string;
      title: string;
      provider: string;
      model: string;
      promptVersion: string;
      config: Recording["config"];
      epoch: number;
    }
    const page = async (from: number): Promise<{ run: RunHead; epochs: { epoch: number; toTick: number; digest: string; tape: Recording["tape"] }[] }> => {
      const res = await fetch(`/api/runs/${ref}?from=${from}`, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 404) throw new Error("There is no published recording by that name.");
      if (!res.ok) throw new Error("The recording could not be fetched.");
      return (await res.json()) as { run: RunHead; epochs: { epoch: number; toTick: number; digest: string; tape: Recording["tape"] }[] };
    };
    let data = await page(0);
    const run = data.run;
    for (let guard = 0; guard < 2000 && data.epochs.length > 0; guard++) {
      for (const e of data.epochs) {
        epochs.push({ epoch: e.epoch, toTick: e.toTick, digest: e.digest });
        tape.push(...e.tape);
      }
      const next = (data.epochs[data.epochs.length - 1] as { epoch: number }).epoch + 1;
      if (next >= run.epoch) break;
      data = await page(next);
    }
    if (epochs.length === 0) throw new Error("That run has no completed epochs to watch yet.");
    return { format: "tabula-rasa/recording", version: 1, id: run.id, title: run.title, provider: run.provider, model: run.model, promptVersion: run.promptVersion, config: run.config, epochs, tape };
  }
  if (!BUNDLED.test(ref)) throw new Error("That is not the name of a recording.");
  const res = await fetch(`/recordings/${ref}.json`, { cache: "force-cache" });
  if (!res.ok) throw new Error("There is no recording by that name.");
  return (await res.json()) as Recording;
}

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
  /** The lists a frame carries only when they change, kept for the atlas. */
  private structures: StructureView[] = [];
  private marks: CivicMark[] = [];
  private traffic: Uint16Array | null = null;
  private readonly sound = new Soundscape();
  private lastSound = 0;
  private lastCue = 0;
  private wake: (() => void) | null = null;

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
    // someone who chose sound on an earlier visit gets it back at their first gesture, never before one
    if (settings.sound) {
      const wake = (): void => {
        this.unwake();
        void this.setSound(true);
      };
      this.wake = wake;
      window.addEventListener("pointerdown", wake, { once: true });
      window.addEventListener("keydown", wake, { once: true });
    }
  }

  private unwake(): void {
    if (!this.wake) return;
    window.removeEventListener("pointerdown", this.wake);
    window.removeEventListener("keydown", this.wake);
    this.wake = null;
  }

  detach(): void {
    this.unwake();
    this.sound.dispose();
    this.client?.dispose();
    this.client = null;
    this.renderer?.dispose();
    this.renderer = null;
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  // ───────────────────────── sound

  /** Turn sound on or off. Call from a user gesture: browsers refuse to start audio otherwise. */
  async setSound(on: boolean): Promise<void> {
    this.unwake();
    const state = useGame.getState();
    if (on) {
      this.sound.setLevels(state.settings.levels);
      const ok = await this.sound.enable();
      useGame.getState().set({ soundOn: ok });
      if (!ok) this.toast("Sound could not be started in this browser.");
      else this.feedSound(true);
    } else {
      this.sound.disable();
      useGame.getState().set({ soundOn: false });
    }
    if (state.settings.sound !== on) this.updateSettings({ sound: on });
  }

  setSoundLevels(patch: Partial<SoundLevels>): void {
    const levels = { ...useGame.getState().settings.levels, ...patch };
    this.sound.setLevels(levels);
    this.updateSettings({ levels });
  }

  /** What is being sent to the speakers (for tests and the level meter): 0 when off or silent. */
  soundLevel(): number {
    return this.sound.level();
  }

  /** Tell the soundscape what the world and the camera are like right now. */
  private feedSound(force = false): void {
    const frame = this.latest;
    if (!frame || !this.sound.isEnabled()) return;
    const now = performance.now();
    if (!force && now - this.lastSound < 240) return;
    this.lastSound = now;
    const near = this.renderer?.ambience() ?? { fire: 0, shore: 0.5, closeness: 0 };
    this.sound.update({
      weather: frame.climate.weather,
      daylight: Math.max(0, Math.min(1, frame.climate.light / 1000)),
      season: frame.cal.season,
      fire: near.fire,
      shore: near.shore,
      closeness: near.closeness,
      running: frame.playing && frame.tps > 0,
    });
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
    if (this.latest) r.pushFrame({ ...this.latest, structures: null, piles: null, marks: null, traffic: null, roster: null, events: [] });
    r.start();
    this.client?.resync();
  }

  // ───────────────────────── frames

  private onFrame(frame: ViewFrame): void {
    if (frame.epoch !== this.epoch) return;
    this.latest = frame;
    if (frame.structures) this.structures = frame.structures;
    if (frame.marks) this.marks = frame.marks;
    if (frame.traffic) {
      this.traffic = frame.traffic;
      this.notePath(frame);
    }
    this.renderer?.pushFrame(frame);
    const state = useGame.getState();
    const now = performance.now();
    if (frame.events.length) {
      let best: { cue: Cue; rank: number } | null = null;
      for (const e of frame.events) {
        const entry = chronicle(e, state.world, state.roster);
        if (entry) this.pendingChronicle.push(entry);
        const c = CUES[e.k];
        if (c && (!best || c.rank > best.rank)) best = c;
        const page = state.vista ? null : pageFor(e);
        if (page) this.witness(entryFrom(page, e, entry));
      }
      // one tone at a time, and none over the title's passing island
      if (best && !state.vista && now - this.lastCue > 450) {
        this.lastCue = now;
        this.sound.cue(best.cue);
      }
    }
    this.feedSound();
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
          civic: frame.civic,
          replay: frame.replay,
        },
      };
      if (frame.roster) patch.roster = frame.roster;
      // keep the Charters panel current while it is open
      const before = state.hud?.civic;
      if (state.panel === "civics" && (!before || before.proposals !== frame.civic.proposals || before.institutions !== frame.civic.institutions || frame.tick % 24 === 0)) void this.refreshCivics();
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
    // autosave every second simulated day while a real game is running (a recording is never saved)
    if (!state.vista && !frame.replay && frame.playing && frame.cal.tickOfDay === 0 && frame.cal.day > 0 && frame.cal.day % 2 === 0 && frame.cal.day !== this.lastAutosaveDay) {
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
        if (useGame.getState().selection === sel) {
          useGame.getState().set({ agentDetail: detail, tileDetail: null });
          this.applyOverlays();
        }
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

  // ───────────────────────── field journal

  /** Enter something in the journal the first time it is seen (later sightings of the same kind are not news). */
  private witness(entry: JournalEntry): void {
    const state = useGame.getState();
    if (state.journal.some((j) => j.id === entry.id)) return;
    // the second half of a pair is only an answer once the first half has been asked
    if (entry.id === "spring" && !state.journal.some((j) => j.id === "winter")) return;
    if (entry.id === "recovered" && !state.journal.some((j) => j.id === "depleted")) return;
    const def = JOURNAL.find((d) => d.id === entry.id);
    if (!def) return;
    state.set({ journal: [...state.journal, entry], journalUnread: state.panel === "journal" ? 0 : state.journalUnread + 1 });
    this.toast(`Field journal · ${def.title}`);
  }

  /** A path is beaten once some tile has been walked as often as the engine needs to make it easier going (24). */
  private notePath(frame: ViewFrame): void {
    const traffic = frame.traffic;
    const world = useGame.getState().world;
    if (!traffic || !world || useGame.getState().vista) return;
    let best = -1;
    for (let t = 0; t < traffic.length; t++) if ((traffic[t] as number) >= 24 && (best < 0 || (traffic[t] as number) > (traffic[best] as number))) best = t;
    if (best < 0) return;
    const x = best % world.w;
    const y = Math.floor(best / world.w);
    this.witness({ id: "path", tick: frame.tick, text: "Enough feet have gone the same way that the ground shows it.", agents: [], x, y });
  }

  /** Go to where and whom a journal page is about. */
  openJournalEntry(entry: JournalEntry): void {
    if (entry.x !== undefined && entry.y !== undefined) this.renderer?.focusTile(entry.x, entry.y, 28);
    const agent = entry.agents[0];
    if (agent !== undefined && this.latest && (this.latest.agents[agent * AGENT_STRIDE + AF.alive] ?? 0) > 0.5) {
      this.select({ type: "agent", id: agent });
      if (entry.x === undefined) this.renderer?.focusAgent(agent, 26);
    }
  }

  /** What the atlas draws: where everyone and everything is right now. Read-only views of the latest frame. */
  mapData(): { agents: Float32Array; count: number; structures: StructureView[]; marks: CivicMark[]; traffic: Uint16Array | null } | null {
    if (!this.latest) return null;
    return { agents: this.latest.agents, count: this.latest.agentCount, structures: this.structures, marks: this.marks, traffic: this.traffic };
  }

  /** Show, or stop showing, what the selected citizen knows. The views follow the selection and the inspector's data. */
  setOverlay(patch: Partial<{ knowledge: boolean; ties: boolean }>): void {
    const state = useGame.getState();
    state.set({ overlay: { ...state.overlay, ...patch } });
    this.applyOverlays();
  }

  private applyOverlays(): void {
    const { overlay, agentDetail, selection } = useGame.getState();
    const detail = selection?.type === "agent" && agentDetail && agentDetail.id === selection.id && agentDetail.alive ? agentDetail : null;
    this.renderer?.setKnowledge(detail && overlay.knowledge ? detail.seen : null);
    this.renderer?.setTies(detail ? detail.id : -1, detail && overlay.ties ? detail.people : null);
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
    this.structures = ready.frame.structures ?? [];
    this.marks = ready.frame.marks ?? [];
    this.traffic = ready.frame.traffic;
    useGame.getState().set({
      journal: [],
      journalUnread: 0,
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
        civic: ready.frame.civic,
        replay: ready.frame.replay,
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
    // the visitor may already have pressed Begin while the island was being shaped: do not pull them back
    if (useGame.getState().phase !== "setup") useGame.getState().set({ phase: "title" });
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

  /**
   * Watch a recorded run. The world is rebuilt here from the recording's configuration and
   * its tape of decisions; no mind is consulted and nothing is sent anywhere. The worker
   * checks the state against the recorded digest at the end of every epoch.
   */
  async watch(recording: Recording): Promise<void> {
    if (!this.client) return;
    const gen = ++this.generation;
    useGame.getState().set({ phase: "loading", panel: "none" });
    try {
      const ready = await this.client.replay(recording);
      if (gen !== this.generation) return;
      await this.adopt(ready, false);
      this.setSpeed(Math.max(useGame.getState().speed, 3));
      useGame.getState().set({ phase: "playing", tutorialStep: -1 });
      this.client.play();
    } catch (err) {
      useGame.getState().set({ phase: "title", error: err instanceof Error ? err.message : String(err) });
      this.toast("That recording could not be played.");
      await this.startVista();
    }
  }

  /**
   * Fetch a recording by reference and watch it: a bundled file name (`mock-…`) under
   * /recordings, or the id of a run on this server (published, or the signed-in owner's own).
   */
  async openRecording(ref: string): Promise<void> {
    try {
      const recording = await fetchRecording(ref);
      await this.watch(recording);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : "That recording could not be opened.");
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
    // the views belong to a selected citizen: they go when the selection does, and return with the next one
    this.applyOverlays();
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
    if (useGame.getState().hud?.replay) {
      this.toast("A recording shows what happened. Start a world of your own to change one.");
      return;
    }
    const result = await this.client.intervene(kind, params);
    if (result.ok) {
      const state = useGame.getState();
      state.set({ forkDay: state.forkDay >= 0 ? state.forkDay : Math.floor(result.forkTick / TICKS_PER_DAY), panel: "none" });
      this.toast("The timeline forked. The untouched world keeps running for comparison.");
      this.sound.cue("fork");
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

  async refreshCivics(): Promise<void> {
    if (!this.client) return;
    useGame.getState().set({ civics: await this.client.civics() });
  }

  // ───────────────────────── panels, settings, tutorial

  openPanel(panel: Panel): void {
    const state = useGame.getState();
    const next = state.panel === panel ? "none" : panel;
    state.set({ panel: next });
    if (next === "compare") void this.refreshCompare();
    if (next === "civics") void this.refreshCivics();
    if (next === "saves" || next === "menu") void this.refreshSaves();
    if (next === "chronicle") this.advanceTutorial(2);
    if (next === "journal") state.set({ journalUnread: 0 });
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
      await putSave(toRecord(saveId, label, payload, stamp, useGame.getState().journal));
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
      useGame.getState().set({ phase: "playing", controlSeries: record.controlSeries, forkDay, tutorialStep: -1, journal: record.journal ?? [], journalUnread: 0 });
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
