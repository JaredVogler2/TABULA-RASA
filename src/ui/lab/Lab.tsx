"use client";

/**
 * The laboratory: the registered studies, as run. Everything shown is read from a study
 * bundle written by `pnpm study` — per-condition estimates, paired contrasts with their
 * intervals, what the registered rule says, which cells are missing — and any cell can be
 * re-run here, in the reader's own browser, and its final state compared with the published hash.
 */
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DIGEST_COMPATIBLE_ENGINES, ENGINE_VERSION, SCHEMA_VERSION } from "@/engine";
import type { ContrastResult, Plan, StudyReport } from "@/lab/analyse";
import { LIVE_DESIGNS, dollars, estimateLiveStudy, seedsWithin } from "@/lab/cost";
import { METRIC_LABEL, type Metric } from "@/lab/studies";
import { PRICE_TABLE } from "@/providers/prices";
import type { VerifyReply, VerifyRequest } from "@/worker/lab.worker";
import styles from "./lab.module.css";

interface BundleIndexEntry {
  id: string;
  title: string;
  seedClass: "pilot" | "confirmatory" | "mixed";
  date: string;
  path: string;
}

interface Bundle {
  manifest: { engine: string; schema: number; affordances: string; seeds: number[]; runs: number; expectedRuns: number; seedClass: string; machine?: { cpu: string; cores: number; node: string } };
  reports: StudyReport[];
  plans: Plan[];
}

interface Hashes {
  engine?: string;
  schema?: number;
  hashes: { study: string; condition: string; seed: number; sha256: string; digest: string }[];
  studies: { id: string; days: number }[];
}

/** One hue for every interval (rows are named, so colour carries no identity); validated on this surface in the comparison charts. */
const MARK = "#1b84a8";
const INK_MUTED = "#6b5f4a";
const GRID = "rgba(74, 58, 36, 0.22)";

function fmt(v: number, metric: Metric, ratio = false): string {
  // a ratio of counts is not a count: it always needs its decimals
  return Number.isFinite(v) ? v.toFixed(ratio ? 3 : METRIC_LABEL[metric].digits) : "—";
}

/** A paired contrast as an interval on its own axis, with the registered bound marked. */
function IntervalRow({ c, confirmatory }: { c: ContrastResult; confirmatory: boolean }) {
  const titleId = useId();
  const W = 320;
  const H = 44;
  const pad = 14;
  const { estimate, lo, hi } = c.interval;
  // the dashed line is the value the registered rule is stated against (0 for most differences; 0.9 or 0.35 for H5's ratios)
  const bound = typeof c.bound === "number" ? c.bound : c.kind === "ratio" ? 1 : 0;
  const side = c.predicts === "greater" || c.predicts === "at-least" ? "the claim holds to the right of the dashed line" : c.predicts === "less" || c.predicts === "at-most" ? "the claim holds to the left of the dashed line" : "no direction was predicted";
  const values = [estimate, lo, hi, bound].filter((v) => Number.isFinite(v));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.12;
  max += span * 0.12;
  const x = (v: number) => pad + ((v - min) / (max - min)) * (W - 2 * pad);
  const has = Number.isFinite(lo) && Number.isFinite(hi);
  const verdictTone = c.verdict === "supported" ? "good" : c.verdict === "falsified" ? "bad" : "plain";
  return (
    <li className={styles.contrast} data-testid={`contrast-${c.id}`}>
      <div className={styles.contrastHead}>
        <b>{c.hypothesis}</b>
        <span id={titleId}>{c.text}</span>
      </div>
      <div className={styles.contrastBody}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} aria-describedby={`${titleId}-d`}>
          <desc id={`${titleId}-d`}>
            {c.reading} The dashed line is at {bound}; {side}.
          </desc>
          <line x1={pad} x2={W - pad} y1={26} y2={26} stroke={GRID} />
          <line x1={x(bound)} x2={x(bound)} y1={8} y2={38} stroke={INK_MUTED} strokeDasharray="3 3" />
          <text x={x(bound)} y={7} fontSize={9} fill={INK_MUTED} textAnchor="middle">
            {bound}
          </text>
          {has ? <line x1={x(lo)} x2={x(hi)} y1={26} y2={26} stroke={MARK} strokeWidth={2} strokeLinecap="round" /> : null}
          {has ? (
            <>
              <line x1={x(lo)} x2={x(lo)} y1={21} y2={31} stroke={MARK} strokeWidth={2} />
              <line x1={x(hi)} x2={x(hi)} y1={21} y2={31} stroke={MARK} strokeWidth={2} />
            </>
          ) : null}
          {Number.isFinite(estimate) ? <circle cx={x(estimate)} cy={26} r={4.5} fill={MARK} stroke="#f8f1e3" strokeWidth={2} /> : null}
        </svg>
        <div className={styles.contrastNumbers}>
          <span className="tnum">
            {c.kind === "ratio" ? "ratio " : "difference "}
            <b>{fmt(estimate, c.metric, c.kind === "ratio")}</b> [{fmt(lo, c.metric, c.kind === "ratio")}, {fmt(hi, c.metric, c.kind === "ratio")}]
          </span>
          <span className={styles.small}>
            {METRIC_LABEL[c.metric].label.toLowerCase()} · {c.n} paired seeds · SD of differences {fmt(c.sdDiff, c.metric)} · d<sub>z</sub> {Number.isFinite(c.dz) ? c.dz.toFixed(2) : "—"} · Cliff&apos;s δ{" "}
            {Number.isFinite(c.cliffsDelta) ? c.cliffsDelta.toFixed(2) : "—"}
            {Number.isFinite(c.p) ? ` · p ${c.p.toFixed(4)}, Holm ${c.pHolm.toFixed(4)}` : ""}
          </span>
        </div>
        <span className={styles.verdict} data-tone={confirmatory ? verdictTone : "plain"}>
          {confirmatory ? c.verdict : `pilot: the rule would read “${c.verdict}”`}
        </span>
      </div>
      <p className={styles.small}>{c.reading}</p>
    </li>
  );
}

function StudySection({ report }: { report: StudyReport }) {
  const confirmatory = report.seedClass === "confirmatory";
  const metrics = (["survival", "welfare", "cooperation", "reciprocity", "specialization", "gini", "commonsMin", "e2", "e4", "deliberations"] as Metric[]).filter((m) => report.conditions.some((c) => (c.metrics[m]?.estimate ?? 0) !== 0));
  return (
    <section className={styles.panel} data-testid={`study-${report.study}`}>
      <h2>{report.title}</h2>
      <p className={styles.small}>
        {confirmatory ? "Confirmatory · holdout seeds" : report.seedClass === "pilot" ? "Pilot · development seeds" : "Mixed seeds · not confirmatory"} · {report.seeds.length} seeds ({report.seeds[0]}–{report.seeds[report.seeds.length - 1]}) · {report.days} days ·{" "}
        {report.runs} of {report.expectedRuns} runs finished
      </p>
      {report.warnings.length ? (
        <ul className={styles.warnings}>
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <ul className={styles.contrasts}>
        {report.contrasts.map((c) => (
          <IntervalRow key={c.id} c={c} confirmatory={confirmatory} />
        ))}
      </ul>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${report.title}: every condition, mean over seeds`}>
        <table className={styles.table}>
          <caption>Mean over seeds, with a 95% bootstrap interval</caption>
          <thead>
            <tr>
              <th scope="col">Condition</th>
              <th scope="col">n</th>
              {metrics.map((m) => (
                <th key={m} scope="col" title={METRIC_LABEL[m].unit}>
                  {METRIC_LABEL[m].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.conditions.map((c) => (
              <tr key={c.condition}>
                <th scope="row">{c.label}</th>
                <td className="tnum">{c.n}</td>
                {metrics.map((m) => (
                  <td key={m} className="tnum">
                    <b>{fmt(c.metrics[m]?.estimate ?? Number.NaN, m)}</b>
                    <span>
                      {" "}
                      [{fmt(c.metrics[m]?.lo ?? Number.NaN, m)}, {fmt(c.metrics[m]?.hi ?? Number.NaN, m)}]
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.missing.length ? (
        <p className={styles.small}>
          Missing cells: {report.missing.slice(0, 12).map((m) => `${m.condition}@${m.seed}`).join(", ")}
          {report.missing.length > 12 ? ` and ${report.missing.length - 12} more` : ""}.
        </p>
      ) : null}
    </section>
  );
}

function Verify({ path }: { path: string }) {
  const [hashes, setHashes] = useState<Hashes | null>(null);
  const [pick, setPick] = useState(0);
  const [state, setState] = useState<{ status: "idle" | "running" | "done"; reply?: VerifyReply; expected?: string }>({ status: "idle" });
  const worker = useRef<Worker | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${path}/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Hashes>) : null))
      .then((m) => {
        if (live) setHashes(m);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      worker.current?.terminate();
    };
  }, [path]);
  const cells = hashes?.hashes ?? [];
  const cell = cells[pick];
  if (!hashes || !cell) return null;
  // A file hash is only comparable with one made by the same engine writing the same snapshot format.
  // An earlier engine whose rules this one keeps for worlds like these (none has crafts or draws
  // newcomers) is checked on the digest of the state instead: the file also holds the version
  // that wrote it, the digest does not. Any other version's bundle is still a record of what
  // that version did, but this build cannot check it.
  const made = hashes.engine ?? ENGINE_VERSION;
  const sameEngine = made === ENGINE_VERSION && (hashes.schema ?? SCHEMA_VERSION) === SCHEMA_VERSION;
  const byDigest = !sameEngine && DIGEST_COMPATIBLE_ENGINES.includes(made) && typeof cell.digest === "string" && cell.digest.length > 0;
  const checkable = sameEngine || byDigest;
  const run = (): void => {
    worker.current?.terminate();
    const w = new Worker(new URL("../../worker/lab.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const expected = byDigest ? cell.digest : cell.sha256;
    setState({ status: "running", expected });
    w.onmessage = (e: MessageEvent<VerifyReply>) => {
      setState({ status: "done", reply: e.data, expected });
      w.terminate();
    };
    const days = hashes.studies.find((s) => s.id === cell.study)?.days ?? 40;
    const request: VerifyRequest = { study: cell.study, condition: cell.condition, seed: cell.seed, days };
    w.postMessage(request);
  };
  const computed = state.reply ? (byDigest ? state.reply.digest : state.reply.sha256) : "";
  const same = state.status === "done" && state.reply?.ok && computed === state.expected;
  return (
    <section className={styles.panel} data-testid="verify">
      <h2>Check a run yourself</h2>
      <p className={styles.small}>
        Pick any cell of this bundle. Your browser builds that world from its seed and configuration, runs it to the horizon and hashes the final state. If {byDigest ? "the state's digest" : "the hash"} equals the published one, you have reproduced the run; nothing is sent anywhere. Or open the cell as a world and watch what the numbers are numbers of.
      </p>
      <div className={styles.verifyRow}>
        <label className={styles.field}>
          Cell
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} data-testid="verify-cell">
            {cells.map((c, i) => (
              <option key={`${c.study}:${c.condition}:${c.seed}`} value={i}>
                {c.study} · {c.condition} · seed {c.seed}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={styles.primary} onClick={run} disabled={state.status === "running" || !checkable} data-testid="verify-run">
          {state.status === "running" ? "Running…" : "Run it here"}
        </button>
        <Link href={`/?study=${encodeURIComponent(cell.study)}&condition=${encodeURIComponent(cell.condition)}&seed=${cell.seed}`} className={styles.secondary} data-testid="verify-open">
          Open it as a world
        </Link>
      </div>
      <p className={styles.mono}>
        published {cell.sha256}
        {byDigest ? (
          <>
            <br />
            state digest {cell.digest}
          </>
        ) : null}
      </p>
      {byDigest ? (
        <p className={styles.small} role="note" data-testid="verify-by-digest">
          This bundle was made by engine {made} (snapshot format {hashes.schema ?? "?"}); this page runs engine {ENGINE_VERSION} (format {SCHEMA_VERSION}). The newer engine adds crafts and newcomers as rules a world has to switch on. None of these worlds does, so they are stepped by the rules that made the bundle and must end in the same state: the check here is on the digest of that state. The file hash above is not compared, because the file also records the version that wrote it.
        </p>
      ) : null}
      {checkable ? null : (
        <p className={styles.result} data-tone="bad" role="note" data-testid="verify-other-engine">
          This bundle was made by engine {hashes.engine ?? "?"} (snapshot format {hashes.schema ?? "?"}); this page runs engine {ENGINE_VERSION} (format {SCHEMA_VERSION}). A different engine is a different model, so re-running here would not be a check of these runs. To reproduce them, check out the commit that made the bundle.
        </p>
      )}
      {state.status === "done" && state.reply ? (
        <p className={styles.result} data-tone={same ? "good" : "bad"} role="status" data-testid="verify-result">
          {state.reply.ok ? (
            <>
              <span className={styles.mono}>computed&nbsp; {computed}</span>
              <br />
              {same
                ? `Reproduced: the same final state, ${byDigest ? "digest for digest" : "bit for bit"} (${state.reply.alive} of ${state.reply.population} alive; ${(state.reply.ms / 1000).toFixed(1)} s here).`
                : "DIFFERENT: this browser did not reproduce the published run."}
            </>
          ) : (
            `Could not run it: ${state.reply.error ?? "unknown error"}`
          )}
        </p>
      ) : null}
    </section>
  );
}

/** The envelope the owner has mentioned. It is a number to size designs against, not an authorization. */
const MENTIONED_ENVELOPE_MICRO_USD = 200_000_000;

/**
 * What the same designs would cost at most with a language model deciding for everyone:
 * ceilings from the published price list and the bounds the server holds before every call.
 * Nothing here has been spent, and nothing on this page can spend.
 */
function LiveCost() {
  const models = useMemo(() => Object.keys(PRICE_TABLE.models).sort((a, b) => (PRICE_TABLE.models[a]?.output ?? 0) - (PRICE_TABLE.models[b]?.output ?? 0)), []);
  const rows = useMemo(() => LIVE_DESIGNS.map((d) => ({ design: d, costs: models.map((m) => estimateLiveStudy(d, m)) })), [models]);
  const contrast = LIVE_DESIGNS.find((d) => d.liveConditions === 2 && d.seeds.length === 32);
  const first = rows[0]?.costs ?? [];
  const short = (model: string): string => model.replace(/^claude-/, "");
  const list = (names: string[]): string => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`);
  const fits = contrast ? models.map((m) => ({ model: m, seeds: seedsWithin(MENTIONED_ENVELOPE_MICRO_USD, contrast, m) })) : [];
  const some = fits.filter((f) => f.seeds > 0);
  const none = fits.filter((f) => f.seeds === 0);
  return (
    <section className={styles.panel} data-testid="live-cost">
      <h2>If the minds were a language model</h2>
      <p className={styles.small}>
        Every run above used the engine&apos;s own minds and cost nothing. This is what the same shapes of study could cost <b>at most</b> with a model deciding for all fifty people at the product&apos;s default ration ({first[0] && LIVE_DESIGNS[0] ? Math.round(first[0].callsPerRun / LIVE_DESIGNS[0].days) : "—"} consultations a day among them): every permitted call made, every call using its whole output limit, nothing read from the prompt cache. Real costs would be lower and are unknown: no call has ever been made. Prices as published on {PRICE_TABLE.verifiedOn}.
      </p>
      <p className={styles.small} style={{ marginTop: 8 }}>
        <b>No spend is authorized.</b> A live study needs the owner&apos;s explicit approval of a stated amount; this page cannot start one.
      </p>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Cost ceilings by design and model">
        <table className={styles.table}>
          <caption>Ceilings in US dollars</caption>
          <thead>
            <tr>
              <th scope="col">Design</th>
              <th scope="col">Calls at most</th>
              {models.map((m) => (
                <th key={m} scope="col" className={styles.modelHead} title={m}>
                  {short(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">One consultation (the amount held before it is sent)</th>
              <td className="tnum">1</td>
              {first.map((c) => (
                <td key={c.model} className="tnum">
                  {dollars(c.perCallMicroUsd)}
                </td>
              ))}
            </tr>
            {rows.map(({ design, costs }) => (
              <tr key={design.label}>
                <th scope="row">{design.label}</th>
                <td className="tnum">{(costs[0]?.calls ?? 0).toLocaleString("en-US")}</td>
                {costs.map((c) => (
                  <td key={c.model} className="tnum">
                    <b>{dollars(c.worstCaseMicroUsd)}</b>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {contrast ? (
        <p className={styles.small} data-testid="live-cost-envelope" style={{ marginTop: 10 }}>
          An envelope of $200 has been mentioned; it is not an authorization. Sized against it, these ceilings would cover a two-condition, forty-day contrast on{" "}
          {some.length ? some.map((f) => `${f.seeds} seed${f.seeds === 1 ? "" : "s"} per condition with ${short(f.model)}`).join(", ") : "no seed at all"}
          {some.length && none.length ? `, and not one seed with ${list(none.map((f) => short(f.model)))}` : ""}. The baseline studies above are sized at {contrast.seeds.length} seeds per condition.
        </p>
      ) : null}
    </section>
  );
}

export function Lab() {
  const [index, setIndex] = useState<BundleIndexEntry[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/studies/index.json")
      .then((r) => (r.ok ? (r.json() as Promise<{ bundles: BundleIndexEntry[] }>) : { bundles: [] }))
      .then((d) => {
        if (!live) return;
        setIndex(d.bundles);
        setChosen(d.bundles[0]?.id ?? "");
      })
      .catch(() => live && setIndex([]));
    return () => {
      live = false;
    };
  }, []);

  const entry = useMemo(() => index?.find((b) => b.id === chosen) ?? null, [index, chosen]);
  useEffect(() => {
    if (!entry) return;
    let live = true;
    fetch(`${entry.path}/report.json`)
      .then((r) => {
        if (!r.ok) throw new Error("the bundle could not be read");
        return r.json() as Promise<Bundle>;
      })
      .then((b) => {
        if (live) {
          setBundle(b);
          setError("");
        }
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [entry]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>TABULA RASA</div>
          <h1>Laboratory</h1>
          <p className={styles.lede}>
            The same island, the same people and the same weather, run under different conditions. Each question below was written down, with the rule that would falsify it, before any engine existed. What is shown here is what the runs gave — within this designed model, and about nothing else.
          </p>
        </div>
        <Link href="/" className={styles.link}>
          Back to the island
        </Link>
      </header>

      {index === null ? <p className={styles.muted}>Loading…</p> : null}
      {index !== null && index.length === 0 ? (
        <section className={styles.panel}>
          <h2>No study has been published with this build</h2>
          <p className={styles.small}>
            Studies are run offline with <code>pnpm study</code> and cost nothing. See the experiment protocol in the repository.
          </p>
        </section>
      ) : null}

      {index && index.length > 0 ? (
        <section className={styles.panel}>
          <div className={styles.verifyRow}>
            <label className={styles.field}>
              Bundle
              <select value={chosen} onChange={(e) => setChosen(e.target.value)} data-testid="bundle-select">
                {index.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} · {b.date}
                  </option>
                ))}
              </select>
            </label>
            {entry ? (
              <div className={styles.downloads}>
                <a href={`${entry.path}/report.md`} download>
                  report.md
                </a>
                <a href={`${entry.path}/runs.csv`} download>
                  runs.csv
                </a>
                <a href={`${entry.path}/manifest.json`} download>
                  manifest.json
                </a>
                <a href={`${entry.path}/report.json`} download>
                  report.json
                </a>
              </div>
            ) : null}
          </div>
          {bundle && entry ? (
            <p className={styles.small} data-testid="bundle-summary">
              {entry.seedClass === "confirmatory"
                ? "Confirmatory: holdout seeds, used once, at a seed count fixed beforehand."
                : "Pilot: development seeds. These runs size the confirmatory batch; they test nothing, and the verdicts beside them are only what the rule would say on this data."}{" "}
              Engine {bundle.manifest.engine} · {bundle.manifest.runs} of {bundle.manifest.expectedRuns} runs · seeds {bundle.manifest.seeds[0]}–{bundle.manifest.seeds[bundle.manifest.seeds.length - 1]} · no model consulted · cost $0.
            </p>
          ) : null}
          {error ? <p className={styles.result} data-tone="bad">{error}</p> : null}
        </section>
      ) : null}

      {bundle?.reports.map((r) => <StudySection key={r.study} report={r} />)}

      {bundle && bundle.plans.length ? (
        <section className={styles.panel} data-testid="plan">
          <h2>Sizing the confirmatory batch</h2>
          <p className={styles.small}>Precision before power: the number of holdout seeds at which a 95% interval on each paired difference would be 0.35 of that difference&apos;s standard deviation wide on each side (capped at 96).</p>
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Seeds planned for each contrast">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Contrast</th>
                  <th scope="col">Measure</th>
                  <th scope="col">SD of paired differences</th>
                  <th scope="col">Half-width in the pilot</th>
                  <th scope="col">Target half-width</th>
                  <th scope="col">Seeds</th>
                </tr>
              </thead>
              <tbody>
                {bundle.plans.map((p) => (
                  <tr key={p.contrast}>
                    <th scope="row">{p.contrast}</th>
                    <td>{METRIC_LABEL[p.metric].label}</td>
                    <td className="tnum">{p.sdDiff.toFixed(4)}</td>
                    <td className="tnum">{p.pilotHalfWidth.toFixed(4)}</td>
                    <td className="tnum">{p.targetHalfWidth.toFixed(4)}</td>
                    <td className="tnum">
                      <b>{p.seeds}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {entry ? <Verify path={entry.path} /> : null}

      <LiveCost />

      <section className={styles.panel}>
        <h2>How to read this</h2>
        <ul className={styles.notes}>
          <li>Every condition is run on the same seeds, so differences are paired: same geography, same people, same weather.</li>
          <li>Intervals are 95% percentile bootstrap intervals over seeds (10,000 resamples, fixed analysis seed). A verdict is stated on the interval, by the rule registered with the hypothesis.</li>
          <li>Agents here are hand-written baselines. Nothing on this page involves a language model, and nothing is a claim about human societies.</li>
          <li>A scripted charter is a positive control. Whatever it does is never counted as emergence.</li>
        </ul>
      </section>
    </main>
  );
}
