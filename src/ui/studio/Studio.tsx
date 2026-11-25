"use client";

/**
 * Studio: a bare view of a real simulated world for art direction and visual QA.
 * Everything on screen is the live engine; URL parameters only choose the world,
 * how far to advance it, and where the camera stands.
 *
 *   /studio?scenario=first_light&seed=1&days=3&ticks=30&q=high&az=0.6&polar=0.9&dist=80
 *           &tx=30&ty=28&agent=4&play=1&speed=8&policy=reflex
 */
import { useEffect, useRef, useState } from "react";
import { TICKS_PER_DAY, makeConfig, type PolicyKind } from "@/engine";
import { WorldRenderer, type Quality } from "@/render/WorldRenderer";
import { SimClient } from "@/store/simClient";
import type { ViewFrame } from "@/worker/protocol";

declare global {
  interface Window {
    __studio?: {
      budget: () => unknown;
      ready: boolean;
      tick: number;
      stats: () => unknown;
      frame: () => ViewFrame | null;
    };
  }
}

export function Studio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    const num = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
    };
    const quality = (params.get("q") as Quality | null) ?? "high";
    const renderer = new WorldRenderer(canvas, overlayRef.current, { quality, reducedMotion: params.get("still") === "1", maxPixelRatio: num("pr", 2), adaptiveResolution: params.get("adaptive") === "1" });
    const client = new SimClient();
    let latest: ViewFrame | null = null;
    let disposed = false;
    window.__studio = { ready: false, tick: 0, stats: () => renderer.stats(), budget: () => renderer.budget(), frame: () => latest };

    client.onFrame = (frame) => {
      latest = frame;
      if (window.__studio) window.__studio.tick = frame.tick;
      renderer.pushFrame(frame);
    };

    (async () => {
      const config = makeConfig(params.get("scenario") ?? "first_light", num("seed", 1), {
        policy: (params.get("policy") as PolicyKind | null) ?? "planner",
        population: num("population", 50),
      });
      const ready = await client.init(config);
      if (disposed) return;
      renderer.setWorld(ready.world);
      renderer.pushFrame(ready.frame);
      renderer.start();

      const total = Math.round(num("days", 0) * TICKS_PER_DAY + num("ticks", 0));
      for (let done = 0; done < total && !disposed; ) {
        const chunk = Math.min(TICKS_PER_DAY * 2, total - done);
        client.step(chunk);
        done += chunk;
        setStatus(`advancing ${done}/${total}`);
        // wait until the worker reports the tick we asked for
        const want = done;
        await new Promise<void>((resolve) => {
          const check = () => (disposed || (latest && latest.tick >= want) ? resolve() : setTimeout(check, 30));
          check();
        });
      }
      if (disposed) return;

      const rig = renderer.camera();
      if (rig) {
        const w = ready.world.w;
        const tx = num("tx", -1);
        const ty = num("ty", -1);
        if (tx >= 0 && ty >= 0) rig.focus(tx + 0.5 - w / 2, ty + 0.5 - ready.world.h / 2);
        rig.setView(num("az", 0.62), num("polar", 0.92), num("dist", Math.max(w, ready.world.h) * 1.95), true);
        if (tx >= 0 && ty >= 0) rig.setView(num("az", 0.62), num("polar", 0.86), num("dist", 40), true);
      }
      const agent = num("agent", -1);
      if (agent >= 0) {
        // let one frame place the figures before focusing on one of them
        await new Promise((r) => setTimeout(r, 120));
        renderer.select({ type: "agent", id: agent });
        renderer.focusAgent(agent, num("dist", 16));
        renderer.camera()?.setView(num("az", 0.62), num("polar", 1.05), num("dist", 16));
      }
      if (params.get("play") === "1") {
        client.setSpeed(num("speed", 4));
        client.play();
      }
      setStatus("ready");
      // a few frames to settle camera damping and shader compilation
      await new Promise((r) => setTimeout(r, num("settle", 900)));
      if (window.__studio) window.__studio.ready = true;
    })().catch((err) => setStatus(`error: ${err instanceof Error ? err.message : String(err)}`));

    return () => {
      disposed = true;
      client.dispose();
      renderer.dispose();
      delete window.__studio;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b130f" }}>
      <canvas ref={canvasRef} data-testid="studio-canvas" style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }} />
      <div ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} />
      <div data-testid="studio-status" style={{ position: "absolute", left: 8, bottom: 6, fontSize: 11, opacity: 0.4, fontFamily: "var(--font-mono)" }}>
        {status}
      </div>
    </div>
  );
}
