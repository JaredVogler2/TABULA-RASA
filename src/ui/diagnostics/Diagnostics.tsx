"use client";

import { useEffect, useRef, useState } from "react";
import { selfTestDigest } from "@/engine/core/selftest";
import { AFFORDANCE_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from "@/engine/version";
import type { SelfTestRequest, SelfTestResponse } from "@/worker/selftest.worker";
import styles from "./diagnostics.module.css";

/** Pinned in src/engine/core/core.selftest.test.ts — the cross-runtime determinism contract. */
export const SELFTEST_SEED = 20261125;
export const SELFTEST_ROUNDS = 20000;

interface GlInfo {
  webgl2: boolean;
  renderer: string;
  maxTextureSize: number;
  floatTargets: boolean;
}

type Check = { state: "pending" } | { state: "ok"; detail: string } | { state: "fail"; detail: string };

function probeWebGl(): GlInfo {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) return { webgl2: false, renderer: "unavailable", maxTextureSize: 0, floatTargets: false };
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const info: GlInfo = {
    webgl2: true,
    renderer,
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    floatTargets: Boolean(gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("EXT_color_buffer_float")),
  };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return info;
}

export function Diagnostics() {
  const [mainDigest, setMainDigest] = useState<string | null>(null);
  const [worker, setWorker] = useState<Check>({ state: "pending" });
  const [gl, setGl] = useState<GlInfo | null>(null);
  const [storage, setStorage] = useState<Check>({ state: "pending" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const main = selfTestDigest(SELFTEST_SEED, SELFTEST_ROUNDS);
    // Results are published from callbacks (never synchronously in the effect body).
    queueMicrotask(() => {
      setMainDigest(`${main.digest} / ${main.sha.slice(0, 16)}`);
      setGl(probeWebGl());
    });

    const w = new Worker(new URL("../../worker/selftest.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<SelfTestResponse>) => {
      const r = event.data;
      const same = r.digest === main.digest && r.sha === main.sha;
      setWorker(
        same
          ? { state: "ok", detail: `${r.digest} / ${r.sha.slice(0, 16)} · ${r.elapsedMs.toFixed(1)} ms` }
          : { state: "fail", detail: `worker ${r.digest} differs from main thread ${main.digest}` },
      );
      w.terminate();
    };
    w.onerror = (err) => {
      setWorker({ state: "fail", detail: err.message || "worker failed to start" });
    };
    const request: SelfTestRequest = { type: "selftest", seed: SELFTEST_SEED, rounds: SELFTEST_ROUNDS };
    w.postMessage(request);

    try {
      const req = indexedDB.open("tabula-rasa-diagnostics", 1);
      req.onsuccess = () => {
        req.result.close();
        indexedDB.deleteDatabase("tabula-rasa-diagnostics");
        setStorage({ state: "ok", detail: "IndexedDB available" });
      };
      req.onerror = () => setStorage({ state: "fail", detail: req.error?.message ?? "IndexedDB unavailable" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "IndexedDB unavailable";
      queueMicrotask(() => setStorage({ state: "fail", detail }));
    }

    return () => w.terminate();
  }, []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.kicker}>TABULA RASA</p>
        <h1>System check</h1>
        <p className={styles.lede}>
          Reproducible runs depend on identical arithmetic everywhere. This page runs the same seeded workload on the
          main thread and in a worker and compares the digests.
        </p>
      </header>

      <dl className={styles.grid}>
        <Row label="Engine" value={`${ENGINE_VERSION} · schema ${SCHEMA_VERSION} · affordances ${AFFORDANCE_VERSION}`} />
        <Row label="Main-thread digest" value={mainDigest ?? "…"} testId="digest-main" />
        <Row
          label="Worker digest"
          value={worker.state === "pending" ? "…" : worker.detail}
          status={worker.state}
          testId="digest-worker"
        />
        <Row
          label="WebGL2"
          value={gl ? (gl.webgl2 ? `${gl.renderer} · max texture ${gl.maxTextureSize}` : "not available") : "…"}
          status={gl ? (gl.webgl2 ? "ok" : "fail") : "pending"}
          testId="webgl"
        />
        <Row
          label="Local saves"
          value={storage.state === "pending" ? "…" : storage.detail}
          status={storage.state}
          testId="storage"
        />
      </dl>
    </main>
  );
}

function Row(props: { label: string; value: string; status?: "pending" | "ok" | "fail"; testId?: string }) {
  return (
    <div className={styles.row}>
      <dt>{props.label}</dt>
      <dd data-testid={props.testId} data-status={props.status ?? "info"} className="tnum">
        {props.status && props.status !== "pending" ? (
          <span className={props.status === "ok" ? styles.ok : styles.fail}>{props.status === "ok" ? "PASS" : "FAIL"}</span>
        ) : null}
        {props.value}
      </dd>
    </div>
  );
}
