/**
 * Read a V8 .cpuprofile and print where the time went: self time per function, largest first,
 * and the same rolled up per source file. "Profile before optimizing" needs nothing fancier.
 *
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof --import tsx scripts/bench.ts -- --policy planner --days 5 --only 50
 *   node scripts/cpuprofile-top.mjs /tmp/prof/<file>.cpuprofile [30]
 *
 * Times are sample counts × the sampling interval: good to a few percent, not to the microsecond.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
const top = Number(process.argv[3] ?? 30);
if (!file) {
  console.error("usage: node scripts/cpuprofile-top.mjs <file.cpuprofile> [rows]");
  process.exit(2);
}
const profile = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const deltas = profile.timeDeltas ?? [];
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const dt = deltas[i] ?? 0;
  total += dt;
  self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + dt);
}
const short = (url) => url.replace(/^file:\/\//, "").replace(process.cwd() + "/", "").replace(/^.*node_modules\//, "node_modules/");
const rows = new Map();
const files = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const where = f.url ? `${short(f.url)}:${f.lineNumber + 1}` : "(native)";
  const key = `${f.functionName || "(anonymous)"} ${where}`;
  rows.set(key, (rows.get(key) ?? 0) + us);
  const fileKey = f.url ? short(f.url) : f.functionName || "(native)";
  files.set(fileKey, (files.get(fileKey) ?? 0) + us);
}
const pct = (us) => `${((us / total) * 100).toFixed(1).padStart(5)}%`;
const ms = (us) => `${(us / 1000).toFixed(0).padStart(7)} ms`;
console.log(`total sampled ${(total / 1000).toFixed(0)} ms over ${profile.samples.length} samples\n`);
console.log("self time by function");
for (const [key, us] of [...rows].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${pct(us)} ${ms(us)}  ${key}`);
console.log("\nself time by file");
for (const [key, us] of [...files].sort((a, b) => b[1] - a[1]).slice(0, Math.min(top, 20))) console.log(`${pct(us)} ${ms(us)}  ${key}`);
