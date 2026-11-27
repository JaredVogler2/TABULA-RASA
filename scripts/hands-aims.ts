/**
 * Read the files `scripts/hands.ts --json` wrote and say how candidate aims would have fallen
 * for each scripted player: "F of the first fifty alive when the last age is reached, by the
 * end of year Y". Nothing is run here; it only counts.
 *
 *   pnpm exec tsx scripts/hands-aims.ts evidence/long-road/hands/t2-*.json [--founders 40,35,30] [--years 4,5,6,7,8]
 */
import { readFileSync } from "node:fs";
import type { HandRun } from "./hands";

const files = process.argv.slice(2).filter((a) => a.endsWith(".json"));
const list = (name: string, fallback: string): number[] => {
  const i = process.argv.indexOf(`--${name}`);
  return (i >= 0 ? (process.argv[i + 1] as string) : fallback).split(",").map(Number);
};
const founders = list("founders", "45,40,35,30,25");
const years = list("years", "4,5,6,7,8");
const runs: HandRun[] = [];
for (const f of files) runs.push(...(JSON.parse(readFileSync(f, "utf8")) as { runs: HandRun[] }).runs);
const players = [...new Set(runs.map((r) => r.player))];
const seeds = [...new Set(runs.map((r) => r.seed))].sort((a, b) => a - b);
const letters = (r: HandRun): number => r.ageDays[r.ageDays.length - 1] as number;
/** The people each island began with (every scenario here begins with fifty). */
const BEGAN = 50;
/** Founders alive on the morning the last age was reached: those who had not died before that day (as `src/worker/aims.ts` counts). */
const sawLetters = (r: HandRun): number => BEGAN - r.founderDeaths.filter((d) => d < letters(r)).length;

console.log(`${runs.length} runs: ${players.length} players on ${seeds.length} islands (seeds ${seeds.join(",")})\n`);
console.log("When the last age was reached (day; — = not within the run), and how many of the first fifty were alive that morning:");
console.log(`${"seed".padEnd(6)}${players.map((p) => p.padEnd(13)).join("")}`);
for (const s of seeds) {
  console.log(
    `${String(s).padEnd(6)}${players
      .map((p) => {
        const r = runs.find((x) => x.player === p && x.seed === s);
        return (r ? (letters(r) >= 0 ? `${letters(r)} · ${sawLetters(r)}` : `— (${BEGAN - r.founderDeaths.length})`) : "?").padEnd(13);
      })
      .join("")}`,
  );
}
for (const y of years) {
  console.log(`\nAim: the last age by the end of year ${y} (day ${y * 40}), with at least F of the first fifty alive — islands on which it would be met:`);
  console.log(`${"F".padEnd(6)}${players.map((p) => p.padEnd(13)).join("")}`);
  for (const f of founders) {
    console.log(
      `${String(f).padEnd(6)}${players
        .map((p) => {
          const mine = runs.filter((x) => x.player === p);
          const met = mine.filter((r) => letters(r) >= 0 && letters(r) < y * 40 && sawLetters(r) >= f).length;
          return `${met} of ${mine.length}`.padEnd(13);
        })
        .join("")}`,
    );
  }
}
