/**
 * Run registered studies offline and write a bundle that can be re-analysed and re-verified.
 *
 *   pnpm study -- --study all --seeds 1-12 --out evidence/phase-14/pilot
 *   pnpm study -- --study h6-institutions --seeds 1-24 --out /tmp/h6 --shard 1/4      (one of four processes)
 *   pnpm study -- --analyse --study all --seeds 1-12 --out evidence/phase-14/pilot    (report from finished runs only)
 *   pnpm study -- --verify 6 --study all --seeds 1-12 --out evidence/phase-14/pilot   (re-run six cells, compare hashes)
 *
 * Every finished run is appended to `<out>/runs.jsonl` at once, so the batch can be stopped
 * and resumed: cells already present are skipped. Costs nothing and consults no model.
 *
 * Seed hygiene (docs/EXPERIMENT_PROTOCOL.md §2): development seeds are 1–999. Holdout seeds
 * (9000–9999) are refused unless `--confirmatory` is given together with `--plan <file>`, the
 * plan written from a pilot that fixes the seed count beforehand.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { AFFORDANCE_VERSION, ENGINE_VERSION, SCHEMA_VERSION } from "../src/engine";
import { adjustFamily, analyse, confirmatoryRefusal, planFrom, seedClassOf, toCsv, toMarkdown, type Plan, type StudyReport } from "../src/lab/analyse";
import { STUDIES, runCell, type RunResult, type Study } from "../src/lab/studies";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function seedList(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const m = /^(\d+)-(\d+)$/.exec(part.trim());
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
    else if (/^\d+$/.test(part.trim())) out.push(Number(part.trim()));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function readRuns(dir: string): RunResult[] {
  if (!existsSync(dir)) return [];
  const runs = new Map<string, RunResult>();
  for (const file of readdirSync(dir).filter((f) => /^runs(\.\d+)?\.jsonl$/.test(f)).sort()) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as RunResult;
        runs.set(`${r.study}:${r.condition}:${r.seed}`, r);
      } catch {
        // a line cut short by an interrupted write is a run that did not finish: it will be run again
      }
    }
  }
  return [...runs.values()];
}

function main(): void {
  const out = arg("out", "");
  if (!out) throw new Error("say where the bundle goes: --out <directory>");
  const which = arg("study", "all");
  const studies: Study[] = which === "all" ? [...STUDIES] : which.split(",").map((id) => {
    const s = STUDIES.find((x) => x.id === id);
    if (!s) throw new Error(`no study "${id}". Known: ${STUDIES.map((x) => x.id).join(", ")}`);
    return s;
  });
  const seeds = seedList(arg("seeds", "1-8"));
  if (seeds.length === 0) throw new Error("no seeds given");
  const seedClass = seedClassOf(seeds);
  let plan: Plan[] | null = null;
  if (seedClass !== "pilot") {
    if (seedClass === "mixed") throw new Error("development and holdout seeds cannot be mixed in one batch");
    if (!flag("confirmatory") || !arg("plan", "")) throw new Error("holdout seeds (9000–9999) are reserved for the confirmatory batch: pass --confirmatory and --plan <plan.json> written from a pilot");
    plan = (JSON.parse(readFileSync(arg("plan", ""), "utf8")) as { plan: Plan[] }).plan;
    const wanted = new Set(studies.flatMap((st) => st.contrasts.map((c) => c.id)));
    const refusal = confirmatoryRefusal(seeds, plan.filter((p) => wanted.has(p.contrast)));
    if (refusal) throw new Error(`not run: ${refusal}.`);
  }
  const days = Number(arg("days", "0"));
  mkdirSync(out, { recursive: true });

  const shard = /^(\d+)\/(\d+)$/.exec(arg("shard", "1/1"));
  const shardIndex = shard ? Number(shard[1]) : 1;
  const shardCount = shard ? Number(shard[2]) : 1;
  const sink = join(out, shardCount > 1 ? `runs.${shardIndex}.jsonl` : "runs.jsonl");

  const cells: { study: Study; condition: Study["conditions"][number]; seed: number }[] = [];
  for (const base of studies) {
    const study = days > 0 ? { ...base, days } : base;
    for (const seed of seeds) for (const condition of study.conditions) cells.push({ study, condition, seed });
  }

  if (!flag("analyse") && !arg("verify", "")) {
    const done = new Set(readRuns(out).map((r) => `${r.study}:${r.condition}:${r.seed}`));
    const mine = cells.filter((_, i) => i % shardCount === shardIndex - 1).filter((c) => !done.has(`${c.study.id}:${c.condition.id}:${c.seed}`));
    console.log(`${cells.length} cells registered (${studies.length} studies × conditions × ${seeds.length} seeds); ${done.size} already finished; this process runs ${mine.length}${shardCount > 1 ? ` (shard ${shardIndex}/${shardCount})` : ""}.`);
    const started = Date.now();
    let n = 0;
    for (const c of mine) {
      const r = runCell(c.study, c.condition, c.seed, () => performance.now());
      appendFileSync(sink, `${JSON.stringify(r)}\n`);
      n++;
      if (n % 10 === 0 || n === mine.length) console.log(`  ${n}/${mine.length} · ${c.study.id} ${c.condition.id} seed ${c.seed}: ${r.alive}/${r.population} alive, ${(r.ms / 1000).toFixed(1)} s · ${((Date.now() - started) / 1000).toFixed(0)} s elapsed`);
    }
    if (shardCount > 1) return; // the report is written by a final --analyse pass over all shards
  }

  const runs = readRuns(out);
  if (arg("verify", "")) {
    // reproducibility: the same cell run again must end in the same state, to the hash
    const want = Math.max(1, Number(arg("verify", "4")));
    const pool = runs.filter((r) => studies.some((s) => s.id === r.study) && seeds.includes(r.seed));
    const picked = pool.filter((_, i) => i % Math.max(1, Math.floor(pool.length / want)) === 0).slice(0, want);
    let ok = 0;
    const lines: string[] = [];
    for (const r of picked) {
      const base = STUDIES.find((s) => s.id === r.study)!;
      const study = { ...base, days: r.days };
      const again = runCell(study, study.conditions.find((c) => c.id === r.condition)!, r.seed);
      const same = again.sha256 === r.sha256 && again.digest === r.digest;
      if (same) ok++;
      lines.push(`${same ? "reproduced" : "DIFFERENT "} ${r.study} ${r.condition} seed ${r.seed}: ${r.sha256.slice(0, 16)}… ${same ? "=" : "≠"} ${again.sha256.slice(0, 16)}…`);
    }
    const text = `Re-ran ${picked.length} of ${pool.length} cells from scratch: ${ok} reproduced their final state hash exactly.\n${lines.join("\n")}\n`;
    writeFileSync(join(out, "verify.txt"), text);
    console.log(text);
    if (ok !== picked.length) process.exit(1);
    return;
  }

  const reports: StudyReport[] = studies.map((base) => analyse(days > 0 ? { ...base, days } : base, seeds, runs));
  // the protocol registers Holm "across the family": every registered contrast with a p-value in this batch, together
  const family = adjustFamily(reports);
  const relevant = runs.filter((r) => studies.some((s) => s.id === r.study) && seeds.includes(r.seed));
  const plans = seedClass === "pilot" ? reports.flatMap((r) => planFrom(r)) : [];
  const manifest = {
    format: "tabula-rasa/study-bundle",
    version: 1,
    seedClass,
    engine: ENGINE_VERSION,
    schema: SCHEMA_VERSION,
    affordances: AFFORDANCE_VERSION,
    studies: studies.map((s) => ({ id: s.id, title: s.title, registered: s.registered, days: days > 0 ? days : s.days, conditions: s.conditions, contrasts: s.contrasts, note: s.note })),
    seeds,
    analysis: { resamples: 10_000, seed: 20261125, interval: "95% percentile bootstrap over seeds", multiplicity: `Holm step-down across the registered family in this batch (${family} contrasts with a p-value); verdicts are read from intervals, not from p-values` },
    plan,
    runs: relevant.length,
    expectedRuns: reports.reduce((s, r) => s + r.expectedRuns, 0),
    machine: { cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, node: process.version },
    cost: { apiCalls: 0, usd: 0 },
    hashes: relevant.map((r) => ({ study: r.study, condition: r.condition, seed: r.seed, sha256: r.sha256, digest: r.digest })).sort((a, b) => a.study.localeCompare(b.study) || a.condition.localeCompare(b.condition) || a.seed - b.seed),
  };
  const head = [
    `# Study bundle — ${seedClass === "confirmatory" ? "confirmatory (holdout seeds)" : "pilot (development seeds)"}`,
    "",
    `Engine ${ENGINE_VERSION} · schema ${SCHEMA_VERSION} · affordances ${AFFORDANCE_VERSION} · ${relevant.length} of ${manifest.expectedRuns} runs finished · seeds ${seeds[0]}–${seeds[seeds.length - 1]} (${seeds.length}) · no model consulted, no cost.`,
    "",
    "Intervals are 95% percentile bootstrap intervals over seeds (10,000 resamples, fixed analysis seed). Conditions are paired by seed. Nothing here is a claim about human societies (protocol §1).",
    "",
  ];
  const body = reports.map(toMarkdown);
  const tail: string[] = [];
  if (plans.length) {
    tail.push("### Sizing the confirmatory batch (precision before power)", "", "Seeds needed for a 95% interval on each paired difference to be 0.35 standard deviations of that difference wide on each side, from the spread seen in this pilot (capped at 96).", "", "| Contrast | Measure | SD of paired differences | Half-width in this pilot | Target half-width | Seeds |", "|---|---|---|---|---|---|");
    for (const p of plans) tail.push(`| ${p.contrast} | ${p.metric} | ${p.sdDiff.toFixed(4)} | ${p.pilotHalfWidth.toFixed(4)} | ${p.targetHalfWidth.toFixed(4)} | ${p.seeds} |`);
    tail.push("");
  }
  writeFileSync(join(out, "report.md"), [...head, ...body, ...tail].join("\n"));
  writeFileSync(join(out, "report.json"), `${JSON.stringify({ manifest: { ...manifest, hashes: undefined }, reports, plans }, null, 1)}\n`);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  writeFileSync(join(out, "runs.csv"), toCsv(relevant));
  if (plans.length) writeFileSync(join(out, "plan.json"), `${JSON.stringify({ from: out, engine: ENGINE_VERSION, pilotSeeds: seeds, plan: plans }, null, 1)}\n`);
  console.log([...head, ...body, ...tail].join("\n"));
  console.log(`wrote ${out}/{report.md, report.json, manifest.json, runs.csv${plans.length ? ", plan.json" : ""}}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
