/**
 * Lab worker: re-runs one cell of a study from scratch, in this browser, so that a reader can
 * check a published result for themselves. It runs the same function the batch runner does,
 * consults nothing and sends nothing anywhere.
 */
import { STUDIES, runCell } from "@/lab/studies";

export interface VerifyRequest {
  study: string;
  condition: string;
  seed: number;
  days: number;
}

export interface VerifyReply {
  ok: boolean;
  sha256: string;
  digest: string;
  alive: number;
  population: number;
  ms: number;
  error?: string;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<VerifyRequest>) => void) | null; postMessage(msg: VerifyReply): void };

ctx.onmessage = (event) => {
  const { study: id, condition: cid, seed, days } = event.data;
  try {
    const base = STUDIES.find((s) => s.id === id);
    const condition = base?.conditions.find((c) => c.id === cid);
    if (!base || !condition || !Number.isInteger(seed) || seed < 1 || seed > 9999 || !Number.isInteger(days) || days < 1 || days > 400) throw new Error("that is not a cell of a registered study");
    const r = runCell({ ...base, days }, condition, seed, () => performance.now());
    ctx.postMessage({ ok: true, sha256: r.sha256, digest: r.digest, alive: r.alive, population: r.population, ms: r.ms });
  } catch (err) {
    ctx.postMessage({ ok: false, sha256: "", digest: "", alive: 0, population: 0, ms: 0, error: err instanceof Error ? err.message : String(err) });
  }
};
