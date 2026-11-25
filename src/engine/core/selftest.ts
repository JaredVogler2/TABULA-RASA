import { canonicalJson } from "./canonical";
import { StateHasher, sha256Text } from "./hash";
import { fade, sinTurn } from "./math";
import { Stream, below, u32, unit } from "./rng";

/**
 * A fixed workload exercising integer mixing, float arithmetic, sqrt and canonical
 * serialization. Its outputs for (seed=20261125, rounds=20000) are pinned in
 * core.selftest.test.ts; any runtime that disagrees is not a supported platform
 * for reproducible runs.
 */
export function selfTestDigest(seed: number, rounds: number): { digest: string; sha: string } {
  const h = new StateHasher();
  let acc = 0;
  const sample: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const a = u32(seed, Stream.Lab, i, 1);
    const b = unit(seed, Stream.Lab, i, 2);
    const c = below(1000, seed, Stream.Lab, i, 3);
    // float pipeline: every operation here is exactly specified by IEEE-754
    const f = Math.sqrt(b * 9.75 + 1) * fade(b) + sinTurn(b * 3) / (c + 1);
    acc += Math.floor(f * 1_000_000);
    h.int(a).int(c).int(Math.floor(f * 1_000_000));
    if (i % 997 === 0) sample.push(Math.floor(f * 1e9));
  }
  h.int(acc % 2147483647);
  const sha = sha256Text(canonicalJson({ seed, rounds, acc, sample, typed: new Int32Array(sample.slice(0, 8)) }));
  return { digest: h.digest(), sha };
}
