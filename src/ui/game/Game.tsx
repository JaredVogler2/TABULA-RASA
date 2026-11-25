"use client";

import { useEffect, useRef, useState } from "react";
import type { Quality } from "@/render/WorldRenderer";
import { useGame } from "@/store/game";
import { CivicsPanel } from "./Civics";
import { ComparePanel } from "./Compare";
import { ControllerContext } from "./context";
import { GameController } from "./controller";
import styles from "./game.module.css";
import { Coach, Timebar, Toast, TopBar } from "./Hud";
import { Inspector } from "./Inspector";
import { AffordancesPanel, Chronicle, Interventions, MenuPanel } from "./Panels";
import { Setup, Title } from "./Title";

declare global {
  interface Window {
    /** Read-only handle for automated tests: what the renderer is doing, never a way to change the world. */
    __tr?: { stats: () => unknown; phase: () => string; screenOf: (agent: number) => { x: number; y: number } | null };
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
    // `?recording=<name>` opens straight into a recorded run instead of the title
    const recording = new URLSearchParams(window.location.search).get("recording");
    if (recording) void controller.openRecording(recording.slice(0, 80));
    else void controller.startVista();
    window.__tr = { stats: () => controller.rendererStats(), phase: () => useGame.getState().phase, screenOf: (agent) => controller.screenOf(agent) };
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
      if (e.key === "Escape") {
        if (state.panel !== "none") controller.openPanel(state.panel);
        else if (state.selection) controller.select(null);
        else if (state.phase === "setup") state.set({ phase: "title" });
        return;
      }
      if (state.phase !== "playing") return;
      const modal = state.panel === "interventions" || state.panel === "compare" || state.panel === "civics" || state.panel === "menu" || state.panel === "affordances";
      if (modal) return;
      const rig = controller.camera();
      switch (e.key) {
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
          if (state.forkDay >= 0) controller.openPanel("compare");
          break;
        case "f":
        case "F":
          if (state.selection) controller.follow(!state.following);
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
        <canvas ref={canvasRef} className={styles.canvas} data-testid="world-canvas" tabIndex={playing ? 0 : -1} aria-label="The island. Drag to pan, right-drag or two-finger twist to orbit, scroll or pinch to zoom, click a citizen to inspect." />
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
        {panel === "affordances" ? <AffordancesPanel /> : null}
        <Toast />
      </div>
    </ControllerContext.Provider>
  );
}
