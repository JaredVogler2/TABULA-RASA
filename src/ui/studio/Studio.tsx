"use client";

/**
 * Studio: a bare view of a real simulated world for art direction and visual QA.
 * Everything on screen is the live engine; URL parameters only choose the world,
 * how far to advance it, and where the camera stands.
 *
 *   /studio?scenario=first_light&seed=1&days=3&ticks=30&q=high&az=0.6&polar=0.9&dist=80
 *           &tx=30&ty=28&agent=4&play=1&speed=8&policy=reflex&inst=grammar_search
 *           &crafts=1&work=8   (a world with crafts and newcomers; look at the first standing structure of kind 8, a mill)
 */
import { useEffect, useRef, useState } from "react";
import { TICKS_PER_DAY, makeConfig, type InstitutionMode, type PolicyKind } from "@/engine";
import { WorldRenderer, type Quality } from "@/render/WorldRenderer";
import { SimClient } from "@/store/simClient";
import { ACTION_CODES, AF, AGENT_STRIDE, type ViewFrame } from "@/worker/protocol";

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
    // the list of structures is sent only when it changes: keep the last one that came
    let structures: NonNullable<ViewFrame["structures"]> = [];
    // frames arrive in a callback: read the latest through a function so its type is not narrowed away
    const current = (): ViewFrame | null => latest;
    let disposed = false;
    window.__studio = { ready: false, tick: 0, stats: () => renderer.stats(), budget: () => renderer.budget(), frame: () => latest };

    client.onFrame = (frame) => {
      latest = frame;
      if (frame.structures) structures = frame.structures;
      if (window.__studio) window.__studio.tick = frame.tick;
      renderer.pushFrame(frame);
    };

    (async () => {
      const config = makeConfig(params.get("scenario") ?? "first_light", num("seed", 1), {
        policy: (params.get("policy") as PolicyKind | null) ?? "planner",
        population: num("population", 50),
        ...(params.get("inst") ? { institutions: params.get("inst") as InstitutionMode } : {}),
        ...(params.get("crafts") === "1" ? { crafts: true, arrivals: true } : {}),
      });
      const ready = await client.init(config);
      if (disposed) return;
      renderer.setWorld(ready.world);
      renderer.pushFrame(ready.frame);
      renderer.start();

      const total = Math.round(num("days", 0) * TICKS_PER_DAY + num("ticks", 0));
      // a long advance is not watched: drawing it would only keep the page from hearing the worker
      if (total > TICKS_PER_DAY * 4) renderer.stop();
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
      renderer.start();

      const rig = renderer.camera();
      if (rig) {
        const w = ready.world.w;
        const tx = num("tx", -1);
        const ty = num("ty", -1);
        if (tx >= 0 && ty >= 0) rig.focus(tx + 0.5 - w / 2, ty + 0.5 - ready.world.h / 2);
        rig.setView(num("az", 0.62), num("polar", 0.92), num("dist", Math.max(w, ready.world.h) * 1.95), true);
        if (tx >= 0 && ty >= 0) rig.setView(num("az", 0.62), num("polar", 0.86), num("dist", 40), true);
      }
      // `charter=1` looks at the seat of the first agreement in force, if any was ratified
      if (params.get("charter") === "1") {
        const civics = await client.civics();
        const seat = civics?.charters.find((c) => c.state === "active");
        setStatus(seat ? `charter ${seat.name} at ${seat.x},${seat.y}` : "no charter in force");
        if (seat && rig) {
          rig.focus(seat.x + 0.5 - ready.world.w / 2, seat.y + 0.5 - ready.world.h / 2);
          rig.setView(num("az", 0.62), num("polar", 0.9), num("dist", 12), true);
        }
      }
      // `work=8` looks at the first standing structure of that kind (the works are kinds 4 to 9), if there is one
      const workKind = num("work", -1);
      if (workKind >= 0 && rig) {
        const found = structures.find((s) => s.kind === workKind && s.complete);
        setStatus(found ? `structure ${found.id} of kind ${workKind} at ${found.x},${found.y}` : `no standing structure of kind ${workKind}`);
        if (found) {
          rig.focus(found.x + 0.5 - ready.world.w / 2, found.y + 0.5 - ready.world.h / 2);
          rig.setView(num("az", 0.62), num("polar", 0.95), num("dist", 9), true);
        }
      }
      // for a script that wants several stills of one world: `__studio.look(8)` turns to the first standing
      // structure of a kind (or the nth with a second argument) and says where it is, or null if there is none
      if (window.__studio && rig) {
        (window.__studio as { look?: (kind: number, nth?: number, dist?: number, az?: number, polar?: number) => { id: number; x: number; y: number; of: number } | null }).look = (kind, nth = 0, dist = 9, az = 0.62, polar = 0.95) => {
          const all = structures.filter((s) => s.kind === kind && s.complete);
          const found = all[nth];
          if (!found) return null;
          rig.focus(found.x + 0.5 - ready.world.w / 2, found.y + 0.5 - ready.world.h / 2);
          rig.setView(az, polar, dist, true);
          return { id: found.id, x: found.x, y: found.y, of: all.length };
        };
      }
      let agent = num("agent", -1);
      // `doing=gather_wood` frames the first living person performing that action, stepping on until someone is
      const doing = ACTION_CODES.indexOf((params.get("doing") ?? "") as (typeof ACTION_CODES)[number]);
      for (let tries = 0; doing >= 0 && agent < 0 && tries < TICKS_PER_DAY * 2 && !disposed; tries++) {
        const f = current();
        if (f) {
          for (let i = num("skip", 0); i < f.agentCount; i++) {
            if (f.agents[i * AGENT_STRIDE + AF.alive] === 1 && f.agents[i * AGENT_STRIDE + AF.action] === doing) {
              agent = i;
              break;
            }
          }
        }
        if (agent >= 0) break;
        const want = (f?.tick ?? 0) + 1;
        client.step(1);
        await new Promise<void>((resolve) => {
          const check = () => (disposed || (latest && latest.tick >= want) ? resolve() : setTimeout(check, 20));
          check();
        });
      }
      if (agent >= 0) {
        // let one frame place the figures before focusing on one of them
        await new Promise((r) => setTimeout(r, 120));
        renderer.select({ type: "agent", id: agent });
        renderer.focusAgent(agent, num("dist", 16));
        renderer.camera()?.setView(num("az", 0.62), num("polar", 1.05), num("dist", 16));
      }
      // `know=1` and `ties=1` lay the selected citizen's knowledge and acquaintances over the world
      if (agent >= 0 && (params.get("know") === "1" || params.get("ties") === "1")) {
        const detail = await client.inspectAgent(agent);
        if (detail && params.get("know") === "1") renderer.setKnowledge(detail.seen);
        if (detail && params.get("ties") === "1") renderer.setTies(agent, detail.people);
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
