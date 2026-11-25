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
import { autoQuality, simplerOf, simplified } from "./quality";
import { chronicle, outcomeLine, tickLabel, type ChronicleEntry } from "./text";
import { Toasts, type ToastKind } from "./toasts";

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

export class GameController {
  private client: SimClient | null = null;
  private renderer: WorldRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private overlay: HTMLElement | null = null;
  private nameTag: HTMLElement | null = null;
  private lastHud = 0;
  private lastInspect = 0;
  private lastAutosaveDay = -1;
  /**
   * Who writes the autosave. Two tabs each have a world of their own, and there is one
   * autosave slot: without an owner, the last tab to reach a second morning would silently
   * replace the other's. The browser's own lock decides, and frees itself when its tab closes.
   */
  private autosaveOwner: "unasked" | "asking" | "mine" | "other" = "unasked";
  private releaseAutosave: (() => void) | null = null;
  /** The tick of the last autosave written by this tab, so that hiding the tab does not write the same moment twice. */
  private lastAutosaveTick = -1;
  /** True while the tab is hidden and time was running when it went: time starts again when the tab is seen. */
  private resumeOnVisible = false;
  /**
   * When nobody can be watching, time stops: a hidden tab's timers are throttled to a crawl
   * anyway, and a phone may never bring the page back. Hiding is also the last moment a phone
   * promises a page, so what there is gets kept.
   */
  private readonly onVisibility = (): void => {
    if (typeof document === "undefined" || !this.client) return;
    const state = useGame.getState();
    if (document.visibilityState === "hidden") {
      this.resumeOnVisible = this.latest?.playing === true;
      if (this.resumeOnVisible) this.client.pause();
      this.sound.hush(true);
      if (state.phase === "playing" && !state.vista && !state.hud?.replay && this.latest && this.latest.tick > 0 && this.latest.tick !== this.lastAutosaveTick) void this.autosave();
    } else {
      this.sound.hush(false);
      if (this.resumeOnVisible) {
        this.resumeOnVisible = false;
        this.client.play();
      }
    }
  };
  private pendingChronicle: ChronicleEntry[] = [];
  private latest: ViewFrame | null = null;
  private inspecting = false;
  private readonly toasts = new Toasts((message) => useGame.getState().set({ toast: message }));
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

  /** For this visit, the most an automatically chosen preset may be: lowered when the renderer could not keep up. */
  private autoCeiling: Quality = "high";

  private quality(settings: Settings): Quality {
    return this.qualityOverride ?? (settings.quality === "auto" ? simplerOf(autoQuality(), this.autoCeiling) : settings.quality);
  }

  /**
   * The renderer is at its lowest resolution and still slow. If the preset was chosen
   * automatically, take the next simpler one, once per step, and say so. A preset the visitor
   * chose is theirs: it is left alone. Nothing about the world changes either way.
   */
  private simplify(): void {
    const settings = useGame.getState().settings;
    const next = simplified(settings.quality, this.qualityOverride, this.quality(settings));
    if (!next) return;
    this.autoCeiling = next;
    this.rebuildRenderer();
    this.toast("The picture was simplified to keep it moving. Menu → Graphics chooses otherwise. Nothing in the world changed.");
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
    document.addEventListener("visibilitychange", this.onVisibility);
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
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.resumeOnVisible = false;
    this.releaseAutosave?.();
    this.releaseAutosave = null;
    this.autosaveOwner = "unasked";
    this.sound.dispose();
    this.client?.dispose();
    this.client = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.toasts.clear();
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
      // deferred: the renderer must not be rebuilt from inside its own frame
      onStruggle: () => setTimeout(() => this.simplify(), 0),
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
      // the journal is of the world being lived: a path worn in the twin is not something witnessed here
      if (frame.viewing === "world") this.notePath(frame);
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
          viewing: frame.viewing,
          hasTwin: frame.hasTwin,
          replay: frame.replay,
          history: frame.history,
        },
      };
      // the worker is the one that knows when the twin left (a re-run forks again at the tick it forked the first time)
      const forkDay = frame.forkTick >= 0 ? Math.floor(frame.forkTick / TICKS_PER_DAY) : -1;
      if (forkDay !== state.forkDay) patch.forkDay = forkDay;
      // names in the Chronicle and the journal are those of the world being lived, whichever is on screen
      if (frame.roster && frame.viewing === "world") patch.roster = frame.roster;
      // keep the Charters panel current while it is open
      const before = state.hud?.civic;
      if (state.panel === "civics" && (!before || before.proposals !== frame.civic.proposals || before.institutions !== frame.civic.institutions || frame.tick % 24 === 0)) void this.refreshCivics();
      if (this.pendingChronicle.length) {
        const merged = [...state.chronicle, ...this.pendingChronicle];
        patch.chronicle = merged.length > CHRONICLE_CAP ? merged.slice(merged.length - CHRONICLE_CAP) : merged;
        this.pendingChronicle = [];
      }
      state.set(patch);
    } else if (frame.roster && frame.viewing === "world") {
      state.set({ roster: frame.roster });
    }
    if (state.selection && now - this.lastInspect > 280) {
      this.lastInspect = now;
      void this.refreshInspector();
    }
    // autosave every second simulated day while a real game is running (a recording is never saved).
    // The first frame seen on such a day does it: at high speeds several ticks pass between frames, and
    // waiting for the frame that lands exactly on midnight would skip most of them.
    if (!state.vista && !frame.replay && frame.playing && frame.cal.day > 0 && frame.cal.day % 2 === 0 && frame.cal.day !== this.lastAutosaveDay) {
      this.lastAutosaveDay = frame.cal.day;
      void this.autosave();
    }
  }

  /** Ask the browser for the autosave slot. Resolves to whether this tab holds it. */
  private claimAutosave(): Promise<boolean> {
    if (this.autosaveOwner === "mine") return Promise.resolve(true);
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      // a browser without the Web Locks API cannot coordinate tabs: it behaves as a single tab would
      this.autosaveOwner = "mine";
      return Promise.resolve(true);
    }
    this.autosaveOwner = "asking";
    return new Promise<boolean>((resolve) => {
      locks
        .request("tabula-rasa:autosave", { ifAvailable: true }, (lock) => {
          if (!lock) {
            this.autosaveOwner = "other";
            resolve(false);
            return undefined;
          }
          this.autosaveOwner = "mine";
          resolve(true);
          // held for as long as this tab is on the game
          return new Promise<void>((release) => {
            this.releaseAutosave = release;
          });
        })
        .catch(() => {
          this.autosaveOwner = "mine";
          resolve(true);
        });
    });
  }

  /** Write the autosave if this tab holds the slot; say so, once, if another tab does. */
  private async autosave(): Promise<void> {
    if (this.autosaveOwner === "asking") return;
    // a world that stopped on a fault is never written over the last good autosave
    if (useGame.getState().error) return;
    const mine = await this.claimAutosave();
    const state = useGame.getState();
    if (mine) {
      if (state.autosaveElsewhere) state.set({ autosaveElsewhere: false });
      this.lastAutosaveTick = this.latest?.tick ?? -1;
      await this.save(AUTOSAVE_ID, "Autosave", true);
      return;
    }
    if (!state.autosaveElsewhere) {
      state.set({ autosaveElsewhere: true });
      this.toast("Another tab is keeping the autosave. This world is not autosaved here: save it from the menu to keep it.");
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
    this.toast(`Field journal · ${def.title}`, "news");
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

  /**
   * Show a world the worker has made ready. `sameHistory` is for moves within one history
   * (a rewind, a return to a line set aside): journal pages up to the moment arrived at are kept.
   */
  private async adopt(ready: Awaited<ReturnType<SimClient["init"]>>, vista: boolean, sameHistory = false): Promise<void> {
    const renderer = this.ensureRenderer();
    renderer.setWorld(ready.world);
    this.epoch = ready.frame.epoch;
    this.latest = ready.frame;
    renderer.pushFrame(ready.frame);
    renderer.start();
    this.pendingChronicle = [];
    // the day a world is arrived at is not autosaved again: the next one is the next second morning
    this.lastAutosaveDay = ready.frame.cal.day;
    this.structures = ready.frame.structures ?? [];
    this.marks = ready.frame.marks ?? [];
    this.traffic = ready.frame.traffic;
    const keptJournal = sameHistory ? useGame.getState().journal.filter((j) => j.tick <= ready.frame.tick) : [];
    const twin = ready.controlSeries ?? [];
    useGame.getState().set({
      journal: keptJournal,
      journalUnread: 0,
      branches: [],
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
        viewing: ready.frame.viewing,
        hasTwin: ready.frame.hasTwin,
        replay: ready.frame.replay,
        history: ready.frame.history,
      },
      chronicle: [],
      series: ready.series,
      controlSeries: twin,
      // the worker knows when the twin left; nothing here is inferred from the lengths of lists
      forkDay: ready.frame.forkTick >= 0 ? Math.floor(ready.frame.forkTick / TICKS_PER_DAY) : -1,
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
    let ready: Awaited<ReturnType<SimClient["init"]>>;
    try {
      ready = await this.client.init(config);
    } catch (err) {
      // the visitor left the page (for the laboratory, say) while the island was still being shaped: nothing went wrong
      if ((err as { code?: string }).code === "disposed") return;
      throw err;
    }
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
   * Open one cell of a registered study as a world. It is the world the laboratory ran: the
   * same seed and configuration, so left untouched it reaches the published final state.
   */
  async openStudyCell(config: WorldConfig, label: string, days: number): Promise<void> {
    await this.newWorld(config);
    if (useGame.getState().phase !== "playing") return;
    useGame.getState().set({ tutorialStep: -1 });
    this.toast(`${label}: the world the laboratory ran. Left untouched for ${days} days it ends in the published state.`);
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

  // ───────────────────────── history: going back, world lines, files

  /**
   * Go back to a stored moment of this world. "rerun" plays those days again exactly as they
   * went and checks the end against what was left; "branch" leaves from that moment on a new
   * line (the present one is set aside, not lost); "branch_new_luck" does so with weather and
   * chance drawn afresh.
   */
  async rewind(tick: number, mode: "rerun" | "branch" | "branch_new_luck"): Promise<void> {
    if (!this.client) return;
    const gen = ++this.generation;
    try {
      const ready = await this.client.rewind(tick, mode);
      if (gen !== this.generation) return;
      await this.adopt(ready, false, true);
      useGame.getState().set({ phase: "playing", panel: "none" });
      this.setSpeed(useGame.getState().speed);
      const day = Math.floor(ready.frame.tick / TICKS_PER_DAY) + 1;
      this.toast(
        mode === "rerun"
          ? `Back to the morning of day ${day}. Press play: these days will go exactly as they went.`
          : mode === "branch"
            ? `A new line from the morning of day ${day}. The line you left is kept in History.`
            : `A new line from the morning of day ${day}, with new luck. The line you left is kept in History.`,
      );
      if (mode === "rerun") this.client.play();
    } catch (err) {
      this.toast(err instanceof Error ? err.message : "That moment could not be returned to.");
    }
  }

  async refreshBranches(): Promise<void> {
    if (!this.client) return;
    try {
      useGame.getState().set({ branches: await this.client.branches() });
    } catch {
      useGame.getState().set({ branches: [] });
    }
  }

  async switchBranch(id: string): Promise<void> {
    if (!this.client) return;
    const gen = ++this.generation;
    try {
      const ready = await this.client.switchBranch(id);
      if (gen !== this.generation) return;
      await this.adopt(ready, false, true);
      useGame.getState().set({ phase: "playing", panel: "none" });
      this.setSpeed(useGame.getState().speed);
      this.toast("Returned to that line, at the moment it was left.");
    } catch (err) {
      this.toast(err instanceof Error ? err.message : "That line could not be returned to.");
    }
  }

  /** Download this world as a file that says exactly what it is and can be checked on the way back in. */
  async exportWorld(): Promise<void> {
    if (!this.client) return;
    try {
      const { text, manifest } = await this.client.exportWorld({ journal: useGame.getState().journal });
      const name = `tabula-rasa-${manifest.scenario}-seed${manifest.seed}-day${manifest.day + 1}.json`;
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.toast(`Exported ${name} · state ${manifest.snapshot.sha256.slice(0, 12)}…`);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : "This world could not be exported.");
    }
  }

  /** Download the engine's event ledger for this world: every logged event in memory, with its recorded causes. */
  async exportLedger(): Promise<void> {
    if (!this.client) return;
    try {
      const world = useGame.getState().world;
      const hud = useGame.getState().hud;
      const r = await this.client.ledger();
      const name = `tabula-rasa-${world?.config.scenario ?? "world"}-seed${world?.config.seed ?? 0}-day${(hud?.cal.day ?? 0) + 1}-ledger.jsonl`;
      const url = URL.createObjectURL(new Blob([r.text], { type: "application/x-ndjson" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const n = r.events.toLocaleString("en-US");
      this.toast(r.complete ? `Ledger: ${n} events, every one since the first tick.` : `Ledger: ${n} events, from day ${Math.floor(r.firstTick / TICKS_PER_DAY) + 1} on. Earlier ones are not in memory.`);
    } catch (err) {
      this.toast(err instanceof Error ? err.message : "The ledger could not be exported.");
    }
  }

  /** Open a world file. Anything that is not exactly what was exported is refused, and nothing changes. */
  async importWorld(file: File): Promise<void> {
    if (!this.client) return;
    if (file.size > 96 * 1024 * 1024) {
      this.toast("That file is too large to be a world.");
      return;
    }
    const gen = ++this.generation;
    try {
      const ready = await this.client.importWorld(await file.text());
      if (gen !== this.generation) return;
      await this.adopt(ready, false);
      const journal = ready.imported?.extras.journal;
      useGame.getState().set({ phase: "playing", panel: "none", tutorialStep: -1, journal: Array.isArray(journal) ? (journal as JournalEntry[]).filter((j) => j && typeof j.id === "string" && typeof j.tick === "number").slice(0, 64) : [] });
      this.setSpeed(useGame.getState().speed);
      const m = ready.imported?.manifest;
      // a matching hash shows the file is whole, nothing more: say that, and where the real check is
      this.toast(m ? `Opened day ${m.day + 1} of seed ${m.seed}. The file is whole (${m.snapshot.sha256.slice(0, 12)}…); its past is unchecked until History has lived it again.` : "Opened.");
    } catch (err) {
      const code = (err as { code?: string }).code;
      this.toast(code === "corrupt" ? `Refused: ${err instanceof Error ? err.message : "the file is damaged"}.` : code === "schema" || code === "terrain_drift" ? "Refused: this file was made by an incompatible version." : `Refused: ${err instanceof Error ? err.message : "not a world file"}.`);
    }
  }

  /**
   * Look at the twin — the untouched world after an intervention, or the same island with the
   * engine's own minds beside a recording — or back. The camera stays where it is and both
   * worlds are at the same tick, so what changes on screen is exactly what differs.
   */
  viewTwin(on: boolean): void {
    const hud = useGame.getState().hud;
    if (!this.client || !hud || !hud.hasTwin || (hud.viewing === "twin") === on) return;
    this.client.view(on);
    this.lastInspect = 0;
    useGame.getState().set({ panel: "none" });
    this.toast(
      on
        ? hud.replay
          ? "The same island and people with the engine's own minds deciding. Same day, same weather."
          : "The untouched twin: the same island and people at the same moment, without what you did."
        : hud.replay
          ? "Back to the recording."
          : "Back to your world.",
    );
  }

  /**
   * A world opened from a save has only its present in memory. It is deterministic, so its
   * past can be lived again from its seed and the record of what the observer did; the result
   * is kept only if it arrives at exactly the world that was loaded.
   */
  async rebuildPast(): Promise<void> {
    if (!this.client) return;
    try {
      const r = await this.client.rebuild();
      if (!r.ok) {
        this.toast("Lived again from its seed, this world did NOT arrive where the save says it is. Nothing was kept: this save's past cannot be vouched for here.");
        return;
      }
      const state = useGame.getState();
      const have = new Set(state.chronicle.map((c) => c.id));
      const older = r.events.map((e) => chronicle(e, state.world, state.roster)).filter((c): c is ChronicleEntry => c !== null && !have.has(c.id));
      const merged = [...older, ...state.chronicle];
      state.set({ series: r.series, controlSeries: r.controlSeries, chronicle: merged.length > CHRONICLE_CAP ? merged.slice(merged.length - CHRONICLE_CAP) : merged });
      const days = Math.floor(r.ticks / TICKS_PER_DAY);
      this.toast(`Lived again from the seed: ${days} day${days === 1 ? "" : "s"} in ${(r.ms / 1000).toFixed(1)} s, arriving at exactly this world. ${r.moments} moments can be returned to.`);
      void this.refreshBranches();
    } catch (err) {
      this.toast(err instanceof Error ? err.message : "Its past could not be rebuilt.");
    }
  }

  /** The engine's recorded causes of a Chronicle entry, in plain sentences, nearest cause first. */
  async trace(entry: ChronicleEntry): Promise<string[]> {
    if (!this.client) return [];
    const state = useGame.getState();
    const chain = await this.client.trace(entry.id);
    return chain
      .slice(1)
      .map((e) => outcomeLine(e, state.world, state.roster))
      .filter((l): l is NonNullable<typeof l> => l !== null)
      .map((l) => `${tickLabel(l.tick)} — ${l.text}`);
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

  /**
   * Measurements for the performance probe (`scripts/perf.mjs`): the worker's recent tick times
   * and heap, how long a question to the worker takes to come back, how large a save is and
   * how long it takes to make. Reads only.
   */
  async perf(): Promise<Record<string, unknown> | null> {
    if (!this.client) return null;
    const asked = performance.now();
    const worker = await this.client.perf();
    const roundTripMs = performance.now() - asked;
    const inspectStarted = performance.now();
    await this.client.inspectAgent(0);
    const inspectMs = performance.now() - inspectStarted;
    const saveStarted = performance.now();
    const payload = await this.client.save();
    const saveMs = performance.now() - saveStarted;
    const packStarted = performance.now();
    const packedPayload = await this.client.save(true);
    const packMs = performance.now() - packStarted;
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      worker,
      roundTripMs: Math.round(roundTripMs * 10) / 10,
      inspectMs: Math.round(inspectMs * 10) / 10,
      // a save as text (how saves were stored before phase 15) and packed (how they are stored now), same world, same moment
      saveMs: Math.round(saveMs),
      saveKb: Math.round((payload.snapshot.length + (payload.control?.length ?? 0)) / 1024),
      packedMs: Math.round(packMs),
      packedKb: packedPayload.packed ? Math.round((packedPayload.packed.snapshot.byteLength + (packedPayload.packed.control?.byteLength ?? 0)) / 1024) : null,
      pageHeapMb: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
      renderer: this.renderer?.stats() ?? null,
    };
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
    if (!result.ok && result.reason === "rerun") {
      this.toast("These days are being re-run as they went. To change them, open History and leave from here on a new line.");
      return;
    }
    if (!result.ok && result.reason === "twin") {
      this.toast("You are looking at the untouched twin. Go back to your world to change it.");
      return;
    }
    if (!result.ok && result.reason === "rebuild") {
      this.toast("This world's past is being lived again. A moment.");
      return;
    }
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
    if (next === "history") void this.refreshBranches();
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

  /** Say something in passing. A notice keeps its place for its whole time; news (the journal) waits for it: see toasts.ts. */
  toast(message: string, kind: ToastKind = "notice"): void {
    this.toasts.say(message, kind);
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
      const payload = await this.client.save(true);
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
      const ready = await this.client.load(record.snapshot, record.control, record.series, record.controlSeries, record.hash, record.packed ?? null);
      if (gen !== this.generation) return;
      await this.adopt(ready, false);
      useGame.getState().set({ phase: "playing", tutorialStep: -1, journal: record.journal ?? [], journalUnread: 0 });
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
