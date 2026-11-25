/**
 * From per-run tables to a study report: per-condition estimates, paired contrasts with
 * bootstrap intervals and effect sizes, the verdict the registered rule gives, Holm-adjusted
 * p-values across the family, and — always — which registered cells are missing.
 */
import { bootstrapMean, bootstrapP, bootstrapRatio, cliffsDelta, dz, halfWidthFor, holm, mean, paired, sd, seedsForHalfWidth, type Interval } from "./stats";
import { METRIC_LABEL, type Contrast, type Metric, type RunResult, type Study } from "./studies";

export interface ConditionSummary {
  condition: string;
  label: string;
  n: number;
  metrics: Partial<Record<Metric, Interval>>;
}

export type Verdict = "supported" | "not supported" | "falsified" | "reported" | "too few seeds";

export interface ContrastResult {
  id: string;
  hypothesis: string;
  text: string;
  metric: Metric;
  kind: Contrast["kind"];
  /** The registered prediction and the value it is stated against, so that a report can be read without the registry. */
  predicts: Contrast["predicts"];
  bound: number;
  a: string;
  b: string;
  /** Seeds on which both conditions finished. */
  n: number;
  interval: Interval;
  /** Standard deviation of the paired differences (the quantity a pilot exists to estimate). */
  sdDiff: number;
  dz: number;
  cliffsDelta: number;
  p: number;
  pHolm: number;
  verdict: Verdict;
  /** In words, what the interval says about the registered claim. */
  reading: string;
}

export interface StudyReport {
  study: string;
  title: string;
  registered: boolean;
  /** "pilot" (development seeds), "confirmatory" (holdout seeds only) or "mixed" (never analysed as confirmatory). */
  seedClass: "pilot" | "confirmatory" | "mixed";
  seeds: number[];
  days: number;
  runs: number;
  expectedRuns: number;
  /** Registered cells with no finished run: a condition is never analysed on a subset of its seeds without saying so. */
  missing: { condition: string; seed: number }[];
  conditions: ConditionSummary[];
  contrasts: ContrastResult[];
  warnings: string[];
}

const REPORTED: Metric[] = ["survival", "welfare", "cooperation", "reciprocity", "specialization", "gini", "commonsMin", "e2", "e4", "deliberations"];

function verdictOf(c: Contrast, ci: Interval): { verdict: Verdict; reading: string } {
  if (ci.n < 8 || Number.isNaN(ci.lo)) return { verdict: "too few seeds", reading: `Only ${ci.n} paired seeds: no interval worth reading.` };
  const f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toFixed(4));
  const span = `${f(ci.estimate)} [${f(ci.lo)}, ${f(ci.hi)}]`;
  switch (c.predicts) {
    case "greater":
      if (ci.lo > c.bound) return { verdict: "supported", reading: `${span}: the whole interval lies above ${c.bound}.` };
      if (ci.hi < c.bound) return { verdict: "falsified", reading: `${span}: the whole interval lies below ${c.bound} — the opposite of what was predicted.` };
      return { verdict: "falsified", reading: `${span}: the interval includes ${c.bound}, which the registered rule counts as falsified.` };
    case "less":
      if (ci.hi < c.bound) return { verdict: "supported", reading: `${span}: the whole interval lies below ${c.bound}.` };
      return { verdict: "falsified", reading: `${span}: the interval does not lie wholly below ${c.bound}.` };
    case "at-least":
      return ci.lo >= c.bound ? { verdict: "supported", reading: `${span}: the lower end is at or above ${c.bound}.` } : { verdict: "falsified", reading: `${span}: the lower end falls below ${c.bound}.` };
    case "at-most":
      return ci.hi <= c.bound ? { verdict: "supported", reading: `${span}: the upper end is at or below ${c.bound}.` } : { verdict: "not supported", reading: `${span}: the upper end exceeds ${c.bound}.` };
    case "two-sided":
      return { verdict: "reported", reading: ci.lo > c.bound ? `${span}: above ${c.bound}.` : ci.hi < c.bound ? `${span}: below ${c.bound}.` : `${span}: no difference distinguishable from ${c.bound}.` };
  }
}

export function seedClassOf(seeds: readonly number[]): StudyReport["seedClass"] {
  const holdout = seeds.filter((s) => s >= 9000 && s <= 9999).length;
  return holdout === 0 ? "pilot" : holdout === seeds.length ? "confirmatory" : "mixed";
}

export function analyse(study: Study, seeds: readonly number[], runs: readonly RunResult[], resamples = 10_000, analysisSeed = 20261125): StudyReport {
  const byCell = new Map<string, RunResult>();
  for (const r of runs) if (r.study === study.id) byCell.set(`${r.condition}:${r.seed}`, r);
  const missing: StudyReport["missing"] = [];
  for (const c of study.conditions) for (const seed of seeds) if (!byCell.has(`${c.id}:${seed}`)) missing.push({ condition: c.id, seed });

  const conditions: ConditionSummary[] = study.conditions.map((c) => {
    const rows = seeds.map((s) => byCell.get(`${c.id}:${s}`)).filter((r): r is RunResult => r !== undefined);
    const metrics: Partial<Record<Metric, Interval>> = {};
    for (const m of REPORTED) metrics[m] = bootstrapMean(rows.map((r) => r.metrics[m]), resamples, analysisSeed);
    return { condition: c.id, label: c.label, n: rows.length, metrics };
  });

  const contrasts: ContrastResult[] = study.contrasts.map((c) => {
    // only seeds on which both conditions finished are paired
    const both = seeds.filter((s) => byCell.has(`${c.a}:${s}`) && byCell.has(`${c.b}:${s}`));
    const a = both.map((s) => byCell.get(`${c.a}:${s}`)!.metrics[c.metric]);
    const b = both.map((s) => byCell.get(`${c.b}:${s}`)!.metrics[c.metric]);
    const diffs = paired(a, b);
    const interval = c.kind === "ratio" ? bootstrapRatio(a, b, resamples, analysisSeed) : bootstrapMean(diffs, resamples, analysisSeed);
    const { verdict, reading } = verdictOf(c, interval);
    return { id: c.id, hypothesis: c.hypothesis, text: c.text, metric: c.metric, kind: c.kind, predicts: c.predicts, bound: c.bound, a: c.a, b: c.b, n: both.length, interval, sdDiff: sd(diffs), dz: dz(diffs), cliffsDelta: cliffsDelta(a, b), p: c.kind === "ratio" ? Number.NaN : bootstrapP(diffs, resamples, analysisSeed), pHolm: Number.NaN, verdict, reading };
  });
  const adjusted = holm(contrasts.map((c) => (Number.isNaN(c.p) ? 1 : c.p)));
  contrasts.forEach((c, i) => (c.pHolm = Number.isNaN(c.p) ? Number.NaN : (adjusted[i] as number)));

  const seedClass = seedClassOf(seeds);
  const warnings: string[] = [];
  if (missing.length) warnings.push(`${missing.length} of ${study.conditions.length * seeds.length} registered cells have no finished run; estimates rest on the rest.`);
  if (seedClass === "pilot") warnings.push("Development seeds: these numbers size a study. They are not a test of any hypothesis, and the verdict column is only what the rule would say.");
  if (seedClass === "mixed") warnings.push("Development and holdout seeds are mixed: this cannot be read as a confirmatory result.");
  if (!study.registered) warnings.push("Exploratory: not part of the registered family; no significance language applies.");
  if (contrasts.length > 1) warnings.push(`${contrasts.length} contrasts in this study: unadjusted intervals are shown; the Holm-adjusted p-values here account for this study's contrasts only.`);
  return { study: study.id, title: study.title, registered: study.registered, seedClass, seeds: [...seeds], days: study.days, runs: byCell.size, expectedRuns: study.conditions.length * seeds.length, missing, conditions, contrasts, warnings };
}

/**
 * Holm's step-down adjustment across the registered family (protocol §6–§7): every contrast
 * that has a p-value, in every registered study of the batch, taken together. `analyse` on
 * its own can only adjust within one study; a batch calls this afterwards. Verdicts are read
 * off the intervals and never off a p-value, so this changes only the adjusted p shown beside
 * them. Returns the size of the family.
 */
export function adjustFamily(reports: StudyReport[]): number {
  const family = reports
    .filter((r) => r.registered)
    .flatMap((r) => r.contrasts)
    .filter((c) => !Number.isNaN(c.p));
  const adjusted = holm(family.map((c) => c.p));
  family.forEach((c, i) => (c.pHolm = adjusted[i] as number));
  for (const r of reports) {
    if (!r.registered) continue;
    r.warnings = r.warnings.filter((w) => !w.includes("account for this study's contrasts only"));
    if (family.length > 1) r.warnings.push(`Unadjusted intervals are shown. Holm-adjusted p-values account for the whole registered family in this batch: ${family.length} contrasts with a p-value (ratio contrasts are read from their interval and have none).`);
  }
  return family.length;
}

export interface Plan {
  contrast: string;
  metric: Metric;
  sdDiff: number;
  /** The half-width the confirmatory interval is sized for. */
  targetHalfWidth: number;
  seeds: number;
  /** The half-width this pilot already achieved, for comparison. */
  pilotHalfWidth: number;
}

/**
 * Precision before power (protocol §7): from a pilot's spread of paired differences, the
 * number of holdout seeds at which a 95% interval would be `fraction` of that spread wide on
 * each side. Capped, because a study nobody can afford to run is not a plan.
 */
export function planFrom(report: StudyReport, fraction = 0.35, cap = 96): Plan[] {
  return report.contrasts
    .filter((c) => c.kind === "difference" && c.sdDiff > 0)
    .map((c) => {
      const target = c.sdDiff * fraction;
      return { contrast: c.id, metric: c.metric, sdDiff: c.sdDiff, targetHalfWidth: target, seeds: Math.min(cap, seedsForHalfWidth(c.sdDiff, target)), pilotHalfWidth: halfWidthFor(c.sdDiff, c.n) };
    });
}

/**
 * A confirmatory batch is run once, at the size fixed beforehand, on the first holdout seeds in
 * order: no choosing which seeds, no stopping early, no adding more after a look. Returns the
 * reason a batch may not be run as confirmatory, or "" if it may.
 */
export function confirmatoryRefusal(seeds: readonly number[], plans: readonly Plan[], holdoutStart = 9000): string {
  if (plans.length === 0) return "the plan names no contrast: write it from a pilot first";
  const planned = Math.max(...plans.map((p) => p.seeds));
  if (!Number.isInteger(planned) || planned < 8) return "the plan does not fix a usable seed count";
  if (seeds.length !== planned) return `the plan fixes ${planned} seeds per condition; this batch has ${seeds.length}. A confirmatory batch is run once, at the planned size`;
  for (let i = 0; i < planned; i++) if (seeds[i] !== holdoutStart + i) return `a confirmatory batch uses the first ${planned} holdout seeds in order (${holdoutStart}–${holdoutStart + planned - 1}); seeds are not chosen`;
  return "";
}

const num = (v: number, digits: number): string => (Number.isNaN(v) ? "—" : v.toFixed(digits));

/** The report as Markdown tables: what a reader sees, and what is written beside the raw tables. */
export function toMarkdown(report: StudyReport): string {
  const lines: string[] = [];
  lines.push(`### ${report.title}`, "");
  lines.push(`${report.seedClass === "confirmatory" ? "**Confirmatory** (holdout seeds)" : report.seedClass === "pilot" ? "**Pilot** (development seeds)" : "**Mixed seeds — not confirmatory**"} · ${report.seeds.length} seeds (${report.seeds[0]}–${report.seeds[report.seeds.length - 1]}) · ${report.days} days · ${report.runs} of ${report.expectedRuns} runs finished`, "");
  for (const w of report.warnings) lines.push(`> ${w}`);
  lines.push("");
  const metrics = REPORTED.filter((m) => report.conditions.some((c) => (c.metrics[m]?.estimate ?? 0) !== 0));
  lines.push(`| Condition | n | ${metrics.map((m) => METRIC_LABEL[m].label).join(" | ")} |`);
  lines.push(`|---|---|${metrics.map(() => "---").join("|")}|`);
  for (const c of report.conditions) {
    lines.push(`| ${c.label} | ${c.n} | ${metrics.map((m) => `${num(c.metrics[m]?.estimate ?? Number.NaN, METRIC_LABEL[m].digits)} [${num(c.metrics[m]?.lo ?? Number.NaN, METRIC_LABEL[m].digits)}, ${num(c.metrics[m]?.hi ?? Number.NaN, METRIC_LABEL[m].digits)}]`).join(" | ")} |`);
  }
  lines.push("", "| Hypothesis | Claim | Paired estimate [95% interval] | n | SD of differences | d_z | Cliff's δ | p (Holm) | By the registered rule |", "|---|---|---|---|---|---|---|---|---|");
  for (const c of report.contrasts) {
    // a ratio of counts is not a count: it always needs its decimals
    const d = c.kind === "ratio" ? 3 : METRIC_LABEL[c.metric].digits;
    lines.push(`| ${c.hypothesis} | ${c.text} | ${c.kind === "ratio" ? "ratio " : ""}${num(c.interval.estimate, d)} [${num(c.interval.lo, d)}, ${num(c.interval.hi, d)}] | ${c.n} | ${num(c.sdDiff, d)} | ${num(c.dz, 2)} | ${num(c.cliffsDelta, 2)} | ${num(c.p, 4)} (${num(c.pHolm, 4)}) | ${report.seedClass === "confirmatory" ? `**${c.verdict}**` : `would read "${c.verdict}"`} |`);
  }
  if (report.missing.length) lines.push("", `Missing cells: ${report.missing.slice(0, 20).map((m) => `${m.condition}@${m.seed}`).join(", ")}${report.missing.length > 20 ? ` … and ${report.missing.length - 20} more` : ""}.`);
  lines.push("");
  return lines.join("\n");
}

/** One row per run, for spreadsheets and re-analysis. */
export function toCsv(runs: readonly RunResult[]): string {
  const metrics = Object.keys(METRIC_LABEL) as Metric[];
  const head = ["study", "condition", "seed", "days", "alive", "population", ...metrics, "digest", "sha256", "configHash"];
  const rows = runs.map((r) => [r.study, r.condition, r.seed, r.days, r.alive, r.population, ...metrics.map((m) => r.metrics[m]), r.digest, r.sha256, r.configHash].join(","));
  return `${head.join(",")}\n${rows.join("\n")}\n`;
}

export { mean };
