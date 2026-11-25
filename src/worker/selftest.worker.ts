/// <reference lib="webworker" />
/**
 * Determinism self-test worker.
 *
 * Runs a fixed, seeded workload through the engine's RNG and hashing primitives and
 * reports the digest. The same digest must be produced on the main thread, in Node
 * (unit tests) and in every browser — the diagnostics page and the E2E suite compare them.
 */
import { selfTestDigest } from "@/engine/core/selftest";

export interface SelfTestRequest {
  type: "selftest";
  seed: number;
  rounds: number;
}

export interface SelfTestResponse {
  type: "selftest:done";
  seed: number;
  rounds: number;
  digest: string;
  sha: string;
  elapsedMs: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<SelfTestRequest>) => {
  const msg = event.data;
  if (msg.type !== "selftest") return;
  const started = performance.now();
  const { digest, sha } = selfTestDigest(msg.seed, msg.rounds);
  const response: SelfTestResponse = {
    type: "selftest:done",
    seed: msg.seed,
    rounds: msg.rounds,
    digest,
    sha,
    elapsedMs: performance.now() - started,
  };
  ctx.postMessage(response);
};
