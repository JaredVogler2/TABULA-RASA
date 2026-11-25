"use client";

import { ArrowLeftRight, Info, X } from "lucide-react";
import { useId, useState } from "react";
import { useGame } from "@/store/game";
import type { DaySample } from "@/worker/protocol";
import { useController } from "./context";
import { useSwipeDown } from "./swipe";
import styles from "./game.module.css";

/**
 * Two-series palette validated with the data-visualisation checker against the
 * parchment surface (#f5ecd8): lightness band, chroma floor, colour-vision-deficiency
 * separation (ΔE 18.3), normal-vision separation (ΔE 24.3) and 3:1 contrast all pass.
 * Identity never relies on colour alone: a legend and direct end labels name each line.
 */
const TREATED = "#bf6a1d";
const CONTROL = "#1b84a8";
const INK = "#2a2318";
const INK_MUTED = "#6b5f4a";
const GRID = "rgba(74, 58, 36, 0.16)";
const SURFACE = "#f8f1e3";

interface Point {
  day: number;
  value: number;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function SeriesChart(props: { title: string; subtitle: string; treated: Point[]; control: Point[]; forkDay: number; max?: number; format: (v: number) => string; mine: string; other: string }) {
  const { treated, control, forkDay, format } = props;
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 340;
  const H = 168;
  const m = { l: 36, r: 52, t: 12, b: 24 };
  const days = treated.map((p) => p.day);
  const d0 = days[0] ?? 0;
  const d1 = Math.max(d0 + 1, days[days.length - 1] ?? 1);
  const yMax = props.max ?? niceMax(Math.max(1, ...treated.map((p) => p.value), ...control.map((p) => p.value)));
  const x = (day: number) => m.l + ((day - d0) / (d1 - d0)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (Math.max(0, Math.min(yMax, v)) / yMax) * (H - m.t - m.b);
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const ticks = [0, yMax / 2, yMax];
  const lastT = treated[treated.length - 1];
  const lastC = control[control.length - 1];
  // keep the two end labels from sitting on top of one another
  let labelT = lastT ? y(lastT.value) : 0;
  let labelC = lastC ? y(lastC.value) : 0;
  if (lastT && lastC && Math.abs(labelT - labelC) < 13) {
    const mid = (labelT + labelC) / 2;
    const tAbove = lastT.value >= lastC.value;
    labelT = mid + (tAbove ? -7 : 7);
    labelC = mid + (tAbove ? 7 : -7);
  }
  const controlByDay = new Map(control.map((p) => [p.day, p.value]));
  const hovered = hover !== null ? treated[hover] : undefined;
  const hoveredControl = hovered ? controlByDay.get(hovered.day) : undefined;

  const pick = (clientX: number, rect: DOMRect) => {
    if (treated.length === 0) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < treated.length; i++) {
      const d = Math.abs(x(treated[i]!.day) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  };

  return (
    <figure className={styles.figure} style={{ margin: 0 }}>
      <figcaption>
        <div className={styles.figureTitle} id={titleId}>
          {props.title}
        </div>
        <div className={styles.figureSub}>{props.subtitle}</div>
      </figcaption>
      <div className={styles.chartWrap}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(treated.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? treated.length - 1) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(treated.length - 1, (h ?? 0) + 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
                {format(t)}
              </text>
            </g>
          ))}
          <text x={m.l} y={H - 7} fontSize={10} fill={INK_MUTED}>
            day {d0 + 1}
          </text>
          <text x={W - m.r} y={H - 7} fontSize={10} fill={INK_MUTED} textAnchor="end">
            day {d1 + 1}
          </text>
          {forkDay >= d0 && forkDay <= d1 ? (
            <g>
              <line x1={x(forkDay)} x2={x(forkDay)} y1={m.t} y2={H - m.b} stroke={INK_MUTED} strokeWidth={1} />
              <text x={x(forkDay) + 4} y={m.t + 8} fontSize={10} fill={INK_MUTED}>
                fork
              </text>
            </g>
          ) : null}
          <path d={path(control)} fill="none" stroke={CONTROL} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(treated)} fill="none" stroke={TREATED} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {lastC ? (
            <g>
              <circle cx={x(lastC.day)} cy={y(lastC.value)} r={4} fill={CONTROL} stroke={SURFACE} strokeWidth={2} />
              <text x={x(lastC.day) + 8} y={labelC + 3.5} fontSize={11} fontWeight={600} fill={INK}>
                {format(lastC.value)}
              </text>
            </g>
          ) : null}
          {lastT ? (
            <g>
              <circle cx={x(lastT.day)} cy={y(lastT.value)} r={4} fill={TREATED} stroke={SURFACE} strokeWidth={2} />
              <text x={x(lastT.day) + 8} y={labelT + 3.5} fontSize={11} fontWeight={600} fill={INK}>
                {format(lastT.value)}
              </text>
            </g>
          ) : null}
          {hovered ? (
            <g pointerEvents="none">
              <line x1={x(hovered.day)} x2={x(hovered.day)} y1={m.t} y2={H - m.b} stroke={INK} strokeWidth={1} opacity={0.55} />
              <circle cx={x(hovered.day)} cy={y(hovered.value)} r={4} fill={TREATED} stroke={SURFACE} strokeWidth={2} />
              {hoveredControl !== undefined ? <circle cx={x(hovered.day)} cy={y(hoveredControl)} r={4} fill={CONTROL} stroke={SURFACE} strokeWidth={2} /> : null}
            </g>
          ) : null}
        </svg>
        {hovered ? (
          <div className={styles.tooltip} style={{ left: `${Math.min(82, Math.max(18, (x(hovered.day) / W) * 100))}%` }} role="status">
            <div style={{ opacity: 0.75 }}>Day {hovered.day + 1}</div>
            <div>
              <i className={styles.tooltipKey} style={{ borderColor: TREATED }} />
              <b>{format(hovered.value)}</b>
              {props.mine}
            </div>
            {hoveredControl !== undefined ? (
              <div>
                <i className={styles.tooltipKey} style={{ borderColor: CONTROL }} />
                <b>{format(hoveredControl)}</b>
                {props.other}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

/**
 * The difference between the two worlds, day by day: one line about a zero baseline. It is
 * drawn in ink, not in either world's colour, because it belongs to neither.
 */
function DeltaChart(props: { title: string; subtitle: string; points: Point[]; forkDay: number; format: (v: number) => string }) {
  const { points, forkDay, format } = props;
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 340;
  const H = 118;
  const m = { l: 36, r: 52, t: 10, b: 22 };
  const d0 = points[0]?.day ?? 0;
  const d1 = Math.max(d0 + 1, points[points.length - 1]?.day ?? 1);
  // two worlds that do not differ still get an axis with numbers on it, not "+0" and "−0"
  const peak = Math.max(0, ...points.map((p) => Math.abs(p.value)));
  const span = peak > 0 ? niceMax(peak) : 1;
  const x = (day: number) => m.l + ((day - d0) / (d1 - d0)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * (H - m.t - m.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const hovered = hover !== null ? points[hover] : undefined;
  const signed = (v: number) => (Math.abs(v) < 1e-9 ? "0" : `${v > 0 ? "+" : "−"}${format(Math.abs(v))}`);
  const pick = (clientX: number, rect: DOMRect) => {
    if (points.length === 0) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(x(points[i]!.day) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHover(best);
  };
  return (
    <figure className={styles.figure} style={{ margin: 0 }}>
      <figcaption>
        <div className={styles.figureTitle} id={titleId}>
          {props.title}
        </div>
        <div className={styles.figureSub}>{props.subtitle}</div>
      </figcaption>
      <div className={styles.chartWrap}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(points.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length - 1) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? 0) + 1));
          }}
        >
          {[span, -span].map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
                {signed(t)}
              </text>
            </g>
          ))}
          <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke={INK_MUTED} strokeWidth={1} />
          <text x={m.l - 6} y={y(0) + 3.5} textAnchor="end" fontSize={10} fill={INK_MUTED}>
            0
          </text>
          {forkDay >= d0 && forkDay <= d1 ? <line x1={x(forkDay)} x2={x(forkDay)} y1={m.t} y2={H - m.b} stroke={INK_MUTED} strokeWidth={1} strokeDasharray="3 3" /> : null}
          <path d={path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last ? (
            <g>
              <circle cx={x(last.day)} cy={y(last.value)} r={4} fill={INK} stroke={SURFACE} strokeWidth={2} />
              <text x={x(last.day) + 8} y={y(last.value) + 3.5} fontSize={11} fontWeight={600} fill={INK}>
                {signed(last.value)}
              </text>
            </g>
          ) : null}
          {hovered ? (
            <g pointerEvents="none">
              <line x1={x(hovered.day)} x2={x(hovered.day)} y1={m.t} y2={H - m.b} stroke={INK} strokeWidth={1} opacity={0.55} />
              <circle cx={x(hovered.day)} cy={y(hovered.value)} r={4} fill={INK} stroke={SURFACE} strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {hovered ? (
          <div className={styles.tooltip} style={{ left: `${Math.min(82, Math.max(18, (x(hovered.day) / W) * 100))}%` }} role="status">
            <div style={{ opacity: 0.75 }}>Day {hovered.day + 1}</div>
            <div>
              <b>{signed(hovered.value)}</b>
            </div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}

const series = (s: DaySample[], pick: (d: DaySample) => number): Point[] => s.map((d) => ({ day: d.day, value: pick(d) }));

/**
 * A difference between the two timelines. Only measures with an uncontroversial direction
 * (people alive, their well-being, the commons) are tinted; the rest stay in plain ink, because
 * whether more inequality or more building is "better" is the observer's judgement, not ours.
 */
function Delta({ treated, control, digits = 0, unit = "", higherIsBetter = false }: { treated: number; control: number; digits?: number; unit?: string; higherIsBetter?: boolean }) {
  const d = treated - control;
  const sign = Math.abs(d) < Math.pow(10, -digits) / 2 ? "same" : d > 0 ? "up" : "down";
  const valence = sign === "same" || !higherIsBetter ? "neutral" : sign === "up" ? "good" : "bad";
  return (
    <span className={styles.delta} data-sign={sign} data-valence={valence}>
      {sign === "same" ? "no difference" : `${sign === "up" ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(digits)}${unit}`}
    </span>
  );
}

export function ComparePanel() {
  const controller = useController();
  const view = useGame((s) => s.compare);
  const treatedSeries = useGame((s) => s.series);
  const controlSeries = useGame((s) => s.controlSeries);
  const forkDay = useGame((s) => s.forkDay);
  const roster = useGame((s) => s.roster);
  const [showTable, setShowTable] = useState(false);
  const close = () => controller.openPanel("compare");
  const swipe = useSwipeDown(close);
  const t = view?.treated.summary;
  const c = view?.control.summary;
  const tS = treatedSeries.length ? treatedSeries : (view?.treated.series ?? []);
  const cPost = controlSeries.length ? controlSeries : (view?.control.series ?? []);
  // before the fork the two timelines are literally the same world, so the untouched line shares that history
  const firstControlDay = cPost.length ? (cPost[0] as DaySample).day : Infinity;
  const cS = cPost.length ? [...tS.filter((d) => d.day < firstControlDay), ...cPost] : cPost;
  const controlByDay = new Map(cS.map((d) => [d.day, d]));
  const labels: Record<string, string> = {
    cold_snap: "a cold snap",
    drought: "a drought",
    blight: "blight",
    rain: "long rain",
    bounty: "a bounty",
    windfall: "a windfall",
    newcomers: "newcomers",
    hush: "a hush",
  };
  const what = view ? view.interventions.map((i) => labels[i.kind] ?? i.kind).join(", ") : "";
  const recording = view?.kind === "recording";
  // the two worlds are named for what they are: a world and its untouched twin, or a record and the engine's own minds
  const L = recording
    ? { kicker: "One island, two ways of deciding", title: "The recording and the engine's own minds", mine: "The recording", other: "Built-in minds", mineShort: "recorded", otherShort: "built-in", look: "Look at the built-in minds' island" }
    : { kicker: "Two timelines, one difference", title: "What your hand changed", mine: "Your timeline", other: "Untouched timeline", mineShort: "yours", otherShort: "untouched", look: "Look at the untouched world" };
  const delta = (pick: (d: DaySample) => number): Point[] =>
    tS.flatMap((d) => {
      const o = controlByDay.get(d.day);
      return o ? [{ day: d.day, value: pick(d) - pick(o) }] : [];
    });

  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet} ${styles.sheetWide}`} role="dialog" aria-modal="true" aria-labelledby="compare-title" data-testid="compare">
        <div className={styles.panelHead} {...swipe}>
          <div className={styles.panelTitle}>
            <div className={styles.kicker}>{L.kicker}</div>
            <h2 id="compare-title">{L.title}</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={close} aria-label="Close comparison" data-testid="compare-close">
            <X aria-hidden />
          </button>
        </div>
        <div className={styles.panelBody}>
          {!view || !t || !c ? (
            <p className={styles.empty}>There is nothing to compare yet. Intervene once, and an untouched twin of this world will start running alongside it.</p>
          ) : (
            <>
              <p className={styles.lede} data-testid="compare-lede">
                {recording
                  ? "The same seed makes the same land, the same people and the same weather. In the recording, the people who were given to an outside mind do what that mind decided; beside it, the engine's own planner decides for them instead. Nothing else differs."
                  : `On day ${view.forkDay + 1} you introduced ${what}. Both worlds share the same land, people, weather and luck; they differ only by that.`}
              </p>
              <div className={styles.legend} aria-label="Legend" style={{ marginTop: 10, alignItems: "center" }}>
                <span className={styles.legendItem}>
                  <i className={styles.legendKey} style={{ borderColor: TREATED }} />
                  {L.mine}
                </span>
                <span className={styles.legendItem}>
                  <i className={styles.legendKey} style={{ borderColor: CONTROL }} />
                  {L.other}
                </span>
                <button type="button" className={styles.button} onClick={() => controller.viewTwin(true)} data-testid="compare-view-twin" style={{ marginLeft: "auto" }}>
                  <ArrowLeftRight aria-hidden />
                  {L.look}
                </button>
              </div>
              <div className={styles.compareGrid}>
                <SeriesChart title="People alive" subtitle="living citizens at the end of each day" treated={series(tS, (d) => d.alive)} control={series(cS, (d) => d.alive)} forkDay={forkDay} format={(v) => String(Math.round(v))} mine={L.mine.toLowerCase()} other={L.other.toLowerCase()} />
                <SeriesChart title="Well-being" subtitle="mean of each citizen's worst need, 0–100" treated={series(tS, (d) => d.welfare / 10)} control={series(cS, (d) => d.welfare / 10)} forkDay={forkDay} max={100} format={(v) => String(Math.round(v))} mine={L.mine.toLowerCase()} other={L.other.toLowerCase()} />
                <SeriesChart title="Wild food" subtitle="berries, roots and fish left in the wild" treated={series(tS, (d) => d.wild)} control={series(cS, (d) => d.wild)} forkDay={forkDay} format={(v) => String(Math.round(v))} mine={L.mine.toLowerCase()} other={L.other.toLowerCase()} />
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Day by day, the difference <span>{L.mineShort} minus {L.otherShort}</span>
                </div>
                <div className={styles.compareGrid} data-testid="delta-charts">
                  <DeltaChart title="People alive" subtitle="more or fewer living" points={delta((d) => d.alive)} forkDay={forkDay} format={(v) => String(Math.round(v))} />
                  <DeltaChart title="Well-being" subtitle="points, 0–100 scale" points={delta((d) => d.welfare / 10)} forkDay={forkDay} format={(v) => v.toFixed(1)} />
                  <DeltaChart title="Wild food" subtitle="units left in the wild" points={delta((d) => d.wild)} forkDay={forkDay} format={(v) => String(Math.round(v))} />
                </div>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  Since the start <span>computed from engine state, not from anyone&apos;s account</span>
                </div>
                <table className={styles.table} data-testid="compare-table">
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col">{recording ? "Recorded" : "Yours"}</th>
                      <th scope="col">{recording ? "Built-in" : "Untouched"}</th>
                      <th scope="col">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Alive now</th>
                      <td>{t.alive}</td>
                      <td>{c.alive}</td>
                      <td>
                        <Delta treated={t.alive} control={c.alive} higherIsBetter />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Well-being incl. the dead</th>
                      <td>{(t.welfare / 10).toFixed(1)}</td>
                      <td>{(c.welfare / 10).toFixed(1)}</td>
                      <td>
                        <Delta treated={t.welfare / 10} control={c.welfare / 10} digits={1} higherIsBetter />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Inequality of holdings (Gini)</th>
                      <td>{(t.gini / 1000).toFixed(2)}</td>
                      <td>{(c.gini / 1000).toFixed(2)}</td>
                      <td>
                        <Delta treated={t.gini / 1000} control={c.gini / 1000} digits={2} />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Gifts per 1,000 person-days</th>
                      <td>{t.cooperation}</td>
                      <td>{c.cooperation}</td>
                      <td>
                        <Delta treated={t.cooperation} control={c.cooperation} />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Lowest commons health</th>
                      <td>{(t.commonsMin / 10).toFixed(0)}%</td>
                      <td>{(c.commonsMin / 10).toFixed(0)}%</td>
                      <td>
                        <Delta treated={t.commonsMin / 10} control={c.commonsMin / 10} unit=" pts" higherIsBetter />
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Structures built</th>
                      <td>{t.structuresBuilt}</td>
                      <td>{c.structuresBuilt}</td>
                      <td>
                        <Delta treated={t.structuresBuilt} control={c.structuresBuilt} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  As the two worlds stand <span>counted the same way in each</span>
                </div>
                <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="The two worlds as they stand">
                  <table className={styles.table} data-testid="state-table">
                    <thead>
                      <tr>
                        <th scope="col">Now</th>
                        <th scope="col">{recording ? "Recorded" : "Yours"}</th>
                        <th scope="col">{recording ? "Built-in" : "Untouched"}</th>
                        <th scope="col">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.state.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td>{row.yours}</td>
                          <td>{row.twin}</td>
                          <td>{row.yours === row.twin ? "—" : `${row.yours > row.twin ? "+" : "−"}${Math.abs(row.yours - row.twin)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.sectionTitle} style={{ marginTop: 18 }}>
                  What has happened in each <span>events of each kind, as the engine counted them</span>
                </div>
                <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="What has happened in each world, by kind">
                  <table className={styles.table} data-testid="happened-table">
                    <thead>
                      <tr>
                        <th scope="col">Since the start</th>
                        <th scope="col">{recording ? "Recorded" : "Yours"}</th>
                        <th scope="col">{recording ? "Built-in" : "Untouched"}</th>
                        <th scope="col">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.happened.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td>{row.yours}</td>
                          <td>{row.twin}</td>
                          <td>{row.yours === row.twin ? "—" : `${row.yours > row.twin ? "+" : "−"}${Math.abs(row.yours - row.twin)}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {view.deadOnlyYours.length + view.deadOnlyTwin.length > 0 ? (
                  <p className={styles.muted} style={{ marginTop: 8 }} data-testid="death-diff">
                    {view.deadOnlyYours.length ? `Dead in ${recording ? "the recording" : "your world"}, alive in the ${recording ? "built-in minds' world" : "untouched one"}: ${view.deadOnlyYours.map((id) => roster[id]?.name ?? `#${id}`).join(", ")}. ` : ""}
                    {view.deadOnlyTwin.length ? `Alive in ${recording ? "the recording" : "your world"}, dead in the ${recording ? "built-in minds' world" : "untouched one"}: ${view.deadOnlyTwin.map((id) => roster[id]?.name ?? `#${id}`).join(", ")}.` : ""}
                  </p>
                ) : (
                  <p className={styles.muted} style={{ marginTop: 8 }}>
                    The same people are alive in both worlds.
                  </p>
                )}
              </div>

              <div className={styles.actions}>
                <button type="button" className={styles.button} aria-pressed={showTable} onClick={() => setShowTable((v) => !v)} data-testid="toggle-series-table">
                  {showTable ? "Hide daily table" : "Show daily table"}
                </button>
                <button type="button" className={styles.button} onClick={() => void controller.refreshCompare()}>
                  Refresh
                </button>
              </div>
              {showTable ? (
                <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Both worlds day by day">
                <table className={styles.table} style={{ marginTop: 10 }} data-testid="series-table">
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Alive ({L.mineShort})</th>
                      <th scope="col">Alive ({L.otherShort})</th>
                      <th scope="col">Well-being ({L.mineShort})</th>
                      <th scope="col">Well-being ({L.otherShort})</th>
                      <th scope="col">Wild food ({L.mineShort})</th>
                      <th scope="col">Wild food ({L.otherShort})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tS.map((d) => {
                      const o = controlByDay.get(d.day);
                      return (
                        <tr key={d.day}>
                          <th scope="row">{d.day + 1}</th>
                          <td>{d.alive}</td>
                          <td>{o ? o.alive : "—"}</td>
                          <td>{Math.round(d.welfare / 10)}</td>
                          <td>{o ? Math.round(o.welfare / 10) : "—"}</td>
                          <td>{d.wild}</td>
                          <td>{o ? o.wild : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              ) : null}

              <div className={styles.note} data-tone="caution" style={{ marginTop: 16 }}>
                <Info aria-hidden />
                <span>
                  {recording
                    ? "One pair of histories is an anecdote, not a finding. It shows what these minds did on this island, once; it does not show what such minds tend to do. That takes many seeds, counted the same way — which is what the Laboratory is for."
                    : "One pair of timelines is an anecdote, not a finding. Until the fork the two were one world, so every difference here starts at zero and what follows is the whole difference between this pair — but small early differences can grow for reasons that have nothing to do with your change. To learn what an intervention tends to do, it has to be repeated across many worlds — that is what the Laboratory is for."}
                </span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
