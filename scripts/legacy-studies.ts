/**
 * Do the published studies still come out as they were published?
 *
 *   pnpm exec tsx scripts/legacy-studies.ts --bundle pilot [--count 24] [--shard 1/4]
 *   pnpm exec tsx scripts/legacy-studies.ts --bundle confirmatory --count 16
 *
 * Re-runs cells of a published bundle from their seeds and compares the digest of the final
 * state with the published one. A bundle made by an engine this one is digest-compatible with
 * (DIGEST_COMPATIBLE_ENGINES) must be reproduced digest for digest: its worlds leave the rules
 * added since switched off, and with them off this engine steps a world as that one did. The
 * file hash beside each digest is not compared: it also covers the version stamp.
 *
 * It runs nothing new and tunes nothing: the cells, their seeds and their configurations are
 * the published ones. `--count N` takes N cells spread evenly over the bundle.
 */
import { readFileSync } from "node:fs";
import { DIGEST_COMPATIBLE_ENGINES, ENGINE_VERSION } from "../src/engine/version";
import { STUDIES, runCell } from "../src/lab/studies";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

interface Manifest {
  engine: string;
  studies: { id: string; days: number }[];
  hashes: { study: string; condition: string; seed: number; sha256: string; digest: string }[];
}

const bundle = arg("bundle", "pilot");
const manifest = JSON.parse(readFileSync(`public/studies/${bundle}/manifest.json`, "utf8")) as Manifest;
if (manifest.engine !== ENGINE_VERSION && !DIGEST_COMPATIBLE_ENGINES.includes(manifest.engine)) {
  console.log(`The ${bundle} bundle was made by engine ${manifest.engine}; this engine (${ENGINE_VERSION}) does not claim to reproduce it.`);
  process.exit(1);
}
const count = Number(arg("count", String(manifest.hashes.length)));
const [shard, shards] = arg("shard", "1/1").split("/").map(Number) as [number, number];
const stride = Math.max(1, Math.floor(manifest.hashes.length / Math.max(1, count)));
const picked = manifest.hashes.filter((_, i) => i % stride === 0).slice(0, count).filter((_, i) => i % shards === shard - 1);

let same = 0;
const started = Date.now();
for (const cell of picked) {
  const base = STUDIES.find((s) => s.id === cell.study);
  const days = manifest.studies.find((s) => s.id === cell.study)?.days ?? base?.days ?? 40;
  const condition = base?.conditions.find((c) => c.id === cell.condition);
  if (!base || !condition) {
    console.log(`UNKNOWN    ${cell.study} ${cell.condition}: this build has no such cell`);
    continue;
  }
  const again = runCell({ ...base, days }, condition, cell.seed);
  const ok = again.digest === cell.digest;
  if (ok) same++;
  console.log(`${ok ? "reproduced" : "DIFFERENT "} ${cell.study} ${cell.condition} seed ${cell.seed}: published ${cell.digest} ${ok ? "=" : "≠"} ${again.digest}`);
}
console.log(`\n${bundle} (made by engine ${manifest.engine}), re-run by engine ${ENGINE_VERSION}: ${same} of ${picked.length} cells end on the published digest (${((Date.now() - started) / 1000).toFixed(0)} s${shards > 1 ? `, shard ${shard} of ${shards}` : ""}).`);
if (same !== picked.length) process.exit(1);
