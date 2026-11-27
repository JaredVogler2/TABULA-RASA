/**
 * UI state. The world itself never lives here: this store holds only what the HUD
 * needs to draw (low-frequency mirrors of frame data, selections, panels, settings).
 */
import { create } from "zustand";
import { DEFAULT_LEVELS, type SoundLevels } from "@/audio/soundscape";
import type { Pick, Quality } from "@/render/WorldRenderer";
import type { ChronicleEntry } from "@/ui/game/text";
import type { SaveMeta } from "@/persist/saves";
import type { JournalEntry } from "@/ui/game/journal";
import type { AgentDetail, AimPair, BranchView, CalendarView, ClimateView, CivicsView, CompareView, DaySample, HandView, HistoryView, ProgressView, ReplayView, StaticAgentView, StaticWorldView, TileDetail } from "@/worker/protocol";

export type Phase = "title" | "setup" | "loading" | "playing";
export type Panel = "none" | "chronicle" | "interventions" | "compare" | "civics" | "menu" | "affordances" | "saves" | "about" | "recordings" | "atlas" | "journal" | "history";
export type QualitySetting = "auto" | Quality;

export interface HudState {
  tick: number;
  cal: CalendarView;
  climate: ClimateView;
  alive: number;
  population: number;
  agentCount: number;
  playing: boolean;
  tps: number;
  treated: boolean;
  civic: { proposals: number; institutions: number };
  /** Which world is on screen: the one being lived, or its twin. */
  viewing: "world" | "twin";
  hasTwin: boolean;
  /** Present while a recording is being watched. */
  replay: ReplayView | null;
  /** The world's own history: stored moments, and any re-run of the past in progress. */
  history: HistoryView | null;
  /** Ages, legacy and crafts of the world on screen (null in a world without crafts). */
  progress: ProgressView | null;
  /** The observer's remaining changes this season (null where the world sets no limit). */
  hand: HandView | null;
}

export interface Settings {
  quality: QualitySetting;
  reducedMotion: boolean;
  tutorialDone: boolean;
  /** The visitor's preference. Sound still starts only after a gesture in each visit. */
  sound: boolean;
  levels: SoundLevels;
}

const DEFAULT_SETTINGS: Settings = { quality: "auto", reducedMotion: false, tutorialDone: false, sound: false, levels: DEFAULT_LEVELS };

export const SPEEDS: readonly { label: string; tps: number }[] = [
  { label: "1×", tps: 2 },
  { label: "2×", tps: 4 },
  { label: "4×", tps: 8 },
  { label: "8×", tps: 16 },
  { label: "16×", tps: 32 },
  { label: "64×", tps: 128 },
];

export interface GameState {
  phase: Phase;
  world: StaticWorldView | null;
  roster: StaticAgentView[];
  hud: HudState | null;
  speed: number;
  selection: Pick | null;
  following: boolean;
  /**
   * The inspector drawn back to its head, what the citizen is doing and its first buttons. On a narrow
   * screen it is a sheet over the map, and at its full height it hides whoever it is about: it opens
   * drawn back, following draws it back, and a tap on its head (or a pull up, or its arrow) opens it in
   * full. On a wide screen it is a panel at the side and this changes nothing.
   */
  inspectorCompact: boolean;
  agentDetail: AgentDetail | null;
  tileDetail: TileDetail | null;
  chronicle: ChronicleEntry[];
  /** What has been witnessed in this world so far (see ui/game/journal.ts), and how many pages are unread. */
  journal: JournalEntry[];
  journalUnread: number;
  series: DaySample[];
  controlSeries: DaySample[];
  forkDay: number;
  /** How the scenario's stated aim stands, here and in the untouched twin: read each morning, and when a world arrives. */
  aim: AimPair | null;
  compare: CompareView | null;
  /** The world lines of this history (the one lived now and those set aside), refreshed when the History panel opens. */
  branches: BranchView[];
  civics: CivicsView | null;
  panel: Panel;
  saves: SaveMeta[];
  settings: Settings;
  tutorialStep: number;
  toast: string | null;
  error: string | null;
  /** True when another tab of this browser holds the autosave slot: this tab's world is then saved only by hand. */
  autosaveElsewhere: boolean;
  /** Views of what the selected citizen knows, laid over the world: unseen land washed out; arcs to people they know. */
  overlay: { knowledge: boolean; ties: boolean };
  /** Whether sound is actually playing (the preference is in settings; a gesture is needed each visit). */
  soundOn: boolean;
  /** True for the attract-mode world behind the title screen. */
  vista: boolean;
  /**
   * The closing page, when it is open: everyone has died ("extinct"), or the scenario's aim was
   * met or lost this morning. Shown once for each; closing it changes nothing in the world.
   */
  closing: "extinct" | "met" | "lost" | null;
  set(patch: Partial<GameState>): void;
}

const SETTINGS_KEY = "tabula-rasa.settings.v1";

export function loadSettings(): Settings {
  const fallback: Settings = DEFAULT_SETTINGS;
  if (typeof window === "undefined") return fallback;
  const level = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!raw) return { ...fallback, reducedMotion: prefersReduced };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: parsed.quality === "low" || parsed.quality === "medium" || parsed.quality === "high" ? parsed.quality : "auto",
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : prefersReduced,
      tutorialDone: parsed.tutorialDone === true,
      sound: parsed.sound === true,
      levels: {
        master: level(parsed.levels?.master, DEFAULT_LEVELS.master),
        ambience: level(parsed.levels?.ambience, DEFAULT_LEVELS.ambience),
        music: level(parsed.levels?.music, DEFAULT_LEVELS.music),
        cues: level(parsed.levels?.cues, DEFAULT_LEVELS.cues),
      },
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode or storage disabled: settings simply do not persist
  }
}

export const useGame = create<GameState>((set) => ({
  phase: "title",
  world: null,
  roster: [],
  hud: null,
  speed: 2,
  selection: null,
  following: false,
  inspectorCompact: false,
  agentDetail: null,
  tileDetail: null,
  chronicle: [],
  journal: [],
  journalUnread: 0,
  series: [],
  controlSeries: [],
  forkDay: -1,
  aim: null,
  compare: null,
  branches: [],
  civics: null,
  panel: "none",
  saves: [],
  settings: DEFAULT_SETTINGS,
  tutorialStep: 0,
  toast: null,
  error: null,
  autosaveElsewhere: false,
  overlay: { knowledge: false, ties: false },
  soundOn: false,
  vista: true,
  closing: null,
  set: (patch) => set(patch),
}));
