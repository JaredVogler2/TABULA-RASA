/**
 * Record a run with a free provider and write it where the game can replay it.
 *
 *   pnpm record -- --id mock-first-light --title "Fifty mock minds, six days" --seed 7 --days 6
 *
 * The file holds the world's configuration, every decision the minds made (the tape) and the
 * state digest after each epoch — nothing else. Before it is written the recording is
 * replayed against a fresh world and must reproduce every digest.
 *
 * Only the mock provider can be recorded from here: it is a deterministic test double and is
 * labelled as such everywhere it appears. A recording of model-driven minds can only come
 * from an owner-approved run on the server (docs/COST.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TICKS_PER_DAY, createWorld, makeConfig, type DecisionRecord } from "../src/engine";
import { MockProvider } from "../src/providers/mock";
import { PROMPT_VERSION } from "../src/providers/prompt";
import { DEFAULT_SPEC, runEpoch, verifyTape, type RunSpec } from "../src/providers/run";
import { newSchedulerState, type SchedulerKind } from "../src/providers/schedule";
import type { Recording } from "../src/worker/protocol";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const id = arg("id", "mock-first-light");
  if (!/^mock-[a-z0-9-]{2,50}$/.test(id)) throw new Error("the id of a bundled recording starts with mock- and uses lower-case letters, digits and hyphens");
  const title = arg("title", "Fifty mock minds, six days");
  const scenario = arg("scenario", "first_light");
  const seed = Number(arg("seed", "7"));
  const days = Number(arg("days", "6"));
  const population = Number(arg("population", "50"));
  const epochTicks = Number(arg("epoch-ticks", "24"));
  const scheduler = arg("scheduler", "voi") as SchedulerKind;
  const cfg = makeConfig(scenario, seed, { population, externalShare: 1000, institutions: "open", cadence: epochTicks });
  const spec: RunSpec = { ...DEFAULT_SPEC, provider: "mock", epochTicks, epochs: Math.round((days * TICKS_PER_DAY) / epochTicks), scheduler: { kind: scheduler, callsPerEpoch: population, maxPerAgentPerDay: 4, starveAfterEpochs: 8 } };

  const world = createWorld(cfg);
  let st = newSchedulerState(world.agents.length);
  const tape: DecisionRecord[] = [];
  const epochs: Recording["epochs"] = [];
  const provider = new MockProvider();
  for (let e = 0; e < spec.epochs; e++) {
    const { result, next } = await runEpoch(id, world, spec, st, e, provider);
    st = next;
    tape.push(...result.tape);
    epochs.push({ epoch: e, toTick: result.toTick, digest: result.digest });
  }
  const mismatch = verifyTape(createWorld(cfg), tape, epochs);
  if (mismatch !== -1) throw new Error(`the recording does not replay: epoch ${mismatch} differs`);

  const recording: Recording = { format: "tabula-rasa/recording", version: 1, id, title, provider: "mock", model: "mock", promptVersion: PROMPT_VERSION, config: cfg, epochs, tape };
  const dir = join("public", "recordings");
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(recording);
  writeFileSync(join(dir, `${id}.json`), text);

  // the index lists what is bundled, for the Recordings panel
  const indexPath = join(dir, "index.json");
  let index: { id: string; title: string; provider: string; model: string; scenario: string; seed: number; population: number; days: number }[] = [];
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8")) as typeof index;
  } catch {
    // first recording
  }
  index = [...index.filter((r) => r.id !== id), { id, title, provider: "mock", model: "mock", scenario, seed, population, days }].sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  let alive = 0;
  for (const a of world.agents) if (a.alive) alive++;
  console.log(`${id}: ${epochs.length} epochs, ${tape.length} decisions, ${alive}/${population} alive on day ${days}, ${world.inst.proposals.length} agreements written (origin: ${[...new Set(world.inst.proposals.map((p) => p.origin))].join(", ") || "none"}).`);
  console.log(`replayed from the tape alone: every digest matched. Wrote ${join(dir, `${id}.json`)} (${(text.length / 1024).toFixed(0)} KB).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
