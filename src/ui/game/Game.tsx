"use client";

import { useEffect, useRef, useState } from "react";
import { makeConfig, type WorldConfig } from "@/engine";
import { cellConfig } from "@/lab/studies";
import type { Quality } from "@/render/WorldRenderer";
import { useGame } from "@/store/game";
import { AtlasPanel } from "./Atlas";
import { CivicsPanel } from "./Civics";
import { RecordingsPanel } from "./Recordings";
import { ComparePanel } from "./Compare";
import { ControllerContext } from "./context";
import { GameController } from "./controller";
import styles from "./game.module.css";
import { Coach, RecordingBar, Timebar, Toast, TopBar, TwinBar } from "./Hud";
import { HistoryPanel, RerunBar } from "./History";
import { Inspector } from "./Inspector";
import { JournalPanel } from "./Journal";
import { AffordancesPanel, Chronicle, Fault, Interventions, MenuPanel } from "./Panels";
import { Setup, Title } from "./Title";

declare global {
  interface Window {
    /** Read-only handle for automated tests: what the renderer is doing, never a way to change the world. */
    __tr?: { stats: () => unknown; phase: () => string; screenOf: (agent: number) => { x: number; y: number } | null; soundLevel: () => number; perf: () => Promise<unknown> };
  }
}

/** A world configuration from the address bar, or null if it is not a valid one (the engine's own validation decides). */
function directConfig(params: URLSearchParams): WorldConfig | null {
  try {
    const overrides: Partial<WorldConfig> = {};
    const population = Number(params.get("population"));
    const size = Number(params.get("size"));
    if (Number.isInteger(population) && population > 0) overrides.population = population;
    if (Number.isInteger(size) && size > 0) overrides.size = size;
    const seed = Number(params.get("seed") ?? "1");
    return makeConfig((params.get("start") ?? "").slice(0, 40), Number.isInteger(seed) && seed >= 0 ? seed : 1, overrides);
  } catch {
    return null;
  }
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const nameTagRef = useRef<HTMLDivElement>(null);
  const [controller] = useState(() => new GameController());
  const phase = useGame((s) => s.phase);
  const panel = useGame((s) => s.panel);
  const selectedName = useGame((s) => (s.selection?.type === "agent" ? (s.roster[s.selection.id]?.name ?? "") : ""));

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const nameTag = nameTagRef.current;
    if (!canvas || !overlay || !nameTag) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q === "low" || q === "medium" || q === "high") controller.setQualityOverride(q as Quality);
    const pr = Number(new URLSearchParams(window.location.search).get("pr"));
    if (Number.isFinite(pr) && pr >= 0.4 && pr <= 3) controller.setPixelRatioCap(pr);
    controller.attach(canvas, overlay, nameTag);
    // `?recording=<name>` opens straight into a recorded run instead of the title;
    // `?study=…&condition=…&seed=…` opens one cell of a registered study as a world to watch
    const params = new URLSearchParams(window.location.search);
    const recording = params.get("recording");
    const cell = params.get("study") ? cellConfig((params.get("study") ?? "").slice(0, 40), (params.get("condition") ?? "").slice(0, 40), Number(params.get("seed"))) : null;
    // `?start=<scenario>&seed=…[&population=…&size=…]` opens a world directly (the performance probe's way in to larger populations)
    const direct = params.get("start") ? directConfig(params) : null;
    if (recording) void controller.openRecording(recording.slice(0, 80));
    else if (cell) void controller.openStudyCell(cell.config, `${cell.study.title.split(" — ")[0]} · ${cell.condition.label} · seed ${cell.config.seed}`, cell.study.days);
    else if (direct) void controller.newWorld(direct);
    else void controller.startVista();
    window.__tr = { stats: () => controller.rendererStats(), phase: () => useGame.getState().phase, screenOf: (agent) => controller.screenOf(agent), soundLevel: () => controller.soundLevel(), perf: () => controller.perf() };
    return () => {
      controller.detach();
      delete window.__tr;
    };
  }, [controller]);

  // keyboard: the whole game is operable without a pointer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const state = useGame.getState();
      // a world that has stopped takes no orders: the only way on is the button that says so
      if (state.phase === "playing" && state.error) return;
      if (e.key === "Escape") {
        if (state.panel !== "none") controller.openPanel(state.panel);
        else if (state.selection) controller.select(null);
        else if (state.phase === "setup") state.set({ phase: "title" });
        return;
      }
      if (state.phase !== "playing") return;
      const modal = state.panel === "interventions" || state.panel === "compare" || state.panel === "civics" || state.panel === "menu" || state.panel === "affordances" || state.panel === "recordings" || state.panel === "atlas" || state.panel === "journal" || state.panel === "history";
      if (modal) return;
      const rig = controller.camera();
      // letters mean the same with Shift held or Caps Lock on
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (key) {
        case " ":
          e.preventDefault();
          controller.toggle();
          break;
        case ".":
          controller.step(1);
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
          controller.setSpeed(Number(e.key) - 1);
          break;
        case "c":
        case "C":
          controller.openPanel("chronicle");
          break;
        case "i":
        case "I":
          controller.openPanel("interventions");
          break;
        case "g":
        case "G":
          controller.openPanel("civics");
          break;
        case "k":
        case "K":
          if (state.forkDay >= 0 || state.hud?.hasTwin) controller.openPanel("compare");
          break;
        case "x":
        case "X":
          if (state.hud?.hasTwin) controller.viewTwin(state.hud.viewing !== "twin");
          break;
        case "f":
        case "F":
          if (state.selection) controller.follow(!state.following);
          break;
        case "l":
        case "L":
          controller.openPanel("atlas");
          break;
        case "h":
        case "H":
          controller.openPanel("history");
          break;
        case "j":
        case "J":
          controller.openPanel("journal");
          break;
        case "m":
        case "M":
          void controller.setSound(!state.soundOn);
          break;
        case "v":
        case "V":
          if (state.selection?.type === "agent") controller.setOverlay({ knowledge: !state.overlay.knowledge });
          break;
        case "t":
        case "T":
          if (state.selection?.type === "agent") controller.setOverlay({ ties: !state.overlay.ties });
          break;
        case "ArrowLeft":
        case "a":
          rig?.nudge(60, 0);
          break;
        case "ArrowRight":
        case "d":
          rig?.nudge(-60, 0);
          break;
        case "ArrowUp":
        case "w":
          rig?.nudge(0, 60);
          break;
        case "ArrowDown":
        case "s":
          rig?.nudge(0, -60);
          break;
        case "q":
          rig?.rotate(-0.25);
          break;
        case "e":
          rig?.rotate(0.25);
          break;
        case "+":
        case "=":
          rig?.zoom(0.82);
          break;
        case "-":
        case "_":
          rig?.zoom(1.22);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);

  const playing = phase === "playing";
  return (
    <ControllerContext.Provider value={controller}>
      <div className={styles.root} data-phase={phase} data-testid="game-root">
        <canvas ref={canvasRef} className={styles.canvas} data-testid="world-canvas" tabIndex={playing ? 0 : -1} role="application" aria-roledescription="view of the island" aria-label="The island. Drag to pan, right-drag or two-finger twist to orbit, scroll or pinch to zoom, click a citizen to inspect." />
        <div ref={overlayRef} className={styles.overlay} aria-hidden>
          <div ref={nameTagRef} className={styles.nameTag}>
            {selectedName}
          </div>
        </div>

        {phase === "title" || phase === "setup" ? <Title /> : null}
        {phase === "setup" ? <Setup /> : null}
        {phase === "loading" ? (
          <div className={styles.veil} role="status">
            Shaping the island…
          </div>
        ) : null}

        {playing ? (
          <div className={styles.hud}>
            <TopBar />
            <RecordingBar />
            <RerunBar />
            <TwinBar />
            {panel === "chronicle" ? <Chronicle /> : null}
            <Inspector />
            <Coach />
            <Timebar />
          </div>
        ) : null}

        {playing && panel === "interventions" ? <Interventions /> : null}
        {playing && panel === "compare" ? <ComparePanel /> : null}
        {playing && panel === "civics" ? <CivicsPanel /> : null}
        {playing && panel === "menu" ? <MenuPanel /> : null}
        {playing && panel === "atlas" ? <AtlasPanel /> : null}
        {playing && panel === "journal" ? <JournalPanel /> : null}
        {playing && panel === "history" ? <HistoryPanel /> : null}
        {panel === "affordances" ? <AffordancesPanel /> : null}
        {panel === "recordings" ? <RecordingsPanel /> : null}
        {playing ? <Fault /> : null}
        <Toast />
      </div>
    </ControllerContext.Provider>
  );
}
