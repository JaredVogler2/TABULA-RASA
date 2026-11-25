/**
 * UI state. The world itself never lives here: this store holds only what the HUD
 * needs to draw (low-frequency mirrors of frame data, selections, panels, settings).
 */
import { create } from "zustand";
import type { Pick, Quality } from "@/render/WorldRenderer";
import type { ChronicleEntry } from "@/ui/game/text";
import type { SaveMeta } from "@/persist/saves";
import type { AgentDetail, CalendarView, ClimateView, CivicsView, CompareView, DaySample, StaticAgentView, StaticWorldView, TileDetail } from "@/worker/protocol";

export type Phase = "title" | "setup" | "loading" | "playing";
export type Panel = "none" | "chronicle" | "interventions" | "compare" | "civics" | "menu" | "affordances" | "saves" | "about";
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
}

export interface Settings {
  quality: QualitySetting;
  reducedMotion: boolean;
  tutorialDone: boolean;
}

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
  agentDetail: AgentDetail | null;
  tileDetail: TileDetail | null;
  chronicle: ChronicleEntry[];
  series: DaySample[];
  controlSeries: DaySample[];
  forkDay: number;
  compare: CompareView | null;
  civics: CivicsView | null;
  panel: Panel;
  saves: SaveMeta[];
  settings: Settings;
  tutorialStep: number;
  toast: string | null;
  error: string | null;
  /** True for the attract-mode world behind the title screen. */
  vista: boolean;
  set(patch: Partial<GameState>): void;
}

const SETTINGS_KEY = "tabula-rasa.settings.v1";

export function loadSettings(): Settings {
  const fallback: Settings = { quality: "auto", reducedMotion: false, tutorialDone: false };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!raw) return { ...fallback, reducedMotion: prefersReduced };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: parsed.quality === "low" || parsed.quality === "medium" || parsed.quality === "high" ? parsed.quality : "auto",
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : prefersReduced,
      tutorialDone: parsed.tutorialDone === true,
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
  agentDetail: null,
  tileDetail: null,
  chronicle: [],
  series: [],
  controlSeries: [],
  forkDay: -1,
  compare: null,
  civics: null,
  panel: "none",
  saves: [],
  settings: { quality: "auto", reducedMotion: false, tutorialDone: false },
  tutorialStep: 0,
  toast: null,
  error: null,
  vista: true,
  set: (patch) => set(patch),
}));
