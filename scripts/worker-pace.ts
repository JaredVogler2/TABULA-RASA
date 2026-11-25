/**
 * Does the simulation worker keep the pace it is asked for, when nothing else wants the processor?
 *
 *   pnpm exec tsx scripts/worker-pace.ts [--seconds 12] [--json evidence/phase-15/worker-pace.json]
 *
 * The browser probe (scripts/perf.mjs) measures the worker beside a renderer. In a container
 * without a graphics chip that renderer is a software rasterizer using every core, and the
 * worker's pace suffers for it. This runs the same worker code — its own loop, its own real
 * timers, its message protocol — in Node with nothing beside it, plays each speed for some
 * seconds of real time and counts the ticks. It answers for the pacing loop, not for any
 * browser or device.
 */
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { makeConfig } from "../src/engine";
import type { FromWorker, ToWorker } from "../src/worker/protocol";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

const seconds = Number(arg("seconds", "12"));
let lastTick = 0;
let frames = 0;
// what the worker sees as itself: everything a global scope has, and a way of posting that counts frames
const fake = Object.assign(Object.create(globalThis) as Record<string, unknown>, {
  postMessage: (m: FromWorker) => {
    if (m.type === "frame") {
      lastTick = m.frame.tick;
      frames++;
    }
  },
  onmessage: null as ((e: { data: ToWorker }) => void) | null,
});
(globalThis as unknown as { self: unknown }).self = fake;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  await import("../src/worker/sim.worker");
  const send = (m: ToWorker): void => {
    if (!fake.onmessage) throw new Error("the worker did not install a handler");
    fake.onmessage({ data: structuredClone(m) });
  };
  const rows: { population: number; size: number; speed: string; asked: number; achieved: number; framesPerSecond: number }[] = [];
  let rid = 1;
  for (const [population, size] of [
    [50, 64],
    [100, 64],
    [250, 96],
  ] as const) {
    send({ type: "init", config: makeConfig("first_light", 1, { population, size }), requestId: rid++ });
    await sleep(300);
    for (const [speed, tps] of [
      ["16×", 32],
      ["64×", 128],
    ] as const) {
      send({ type: "speed", tps });
      send({ type: "play" });
      await sleep(1000); // settle
      const t0 = performance.now();
      const tick0 = lastTick;
      const frames0 = frames;
      await sleep(seconds * 1000);
      const elapsed = (performance.now() - t0) / 1000;
      const achieved = Math.round(((lastTick - tick0) / elapsed) * 10) / 10;
      send({ type: "pause" });
      rows.push({ population, size, speed, asked: tps, achieved, framesPerSecond: Math.round(((frames - frames0) / elapsed) * 10) / 10 });
      console.log(`${String(population).padStart(3)} people, ${size}×${size}, ${speed}: asked ${tps} ticks a second, achieved ${achieved} (${rows[rows.length - 1]!.framesPerSecond} frames a second sent)`);
    }
  }
  const env = { date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, secondsPerMeasurement: seconds, note: "the worker's own loop and timers, in Node, with no renderer and nothing else running" };
  const json = arg("json", "");
  if (json) writeFileSync(json, JSON.stringify({ env, rows }, null, 1) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
