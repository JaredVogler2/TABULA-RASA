"use client";

import { Download, GitBranch, History as HistoryIcon, Hourglass, ListTree, RotateCcw, Shuffle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { TICKS_PER_DAY } from "@/engine";
import { useGame } from "@/store/game";
import type { BranchView } from "@/worker/protocol";
import { useController } from "./context";
import styles from "./game.module.css";
import { PanelHead } from "./Panels";
import { SHOCK_NAMES, clock } from "./text";

const day = (tick: number): number => Math.floor(tick / TICKS_PER_DAY) + 1;
/** A stored moment by name: a morning by its day, any other moment by its day and hour. */
const momentLabel = (tick: number): string => (tick === 0 ? "The start" : tick % TICKS_PER_DAY === 0 ? `Day ${day(tick)}` : `Day ${day(tick)}, ${clock(tick % TICKS_PER_DAY)}`);
const lineName = (b: BranchView): string => (b.current ? "This line" : b.id === "main" || b.id === "root" ? "The first line" : `Line ${b.id.replace("line-", "")}`);

/** The line being lived wears the colour "your timeline" has in Compare; lines set aside are drawn in muted ink. */
const LIVED = "#bf6a1d";
const ASIDE = "#6b5f4a";
const INK = "#2a2318";
const SURFACE = "#f8f1e3";

/**
 * The world lines of this history as a tree: time runs to the right, each line leaves its
 * parent at the moment it forked, and a diamond marks each thing the observer did. The list
 * under it says the same in words and is where a line is returned to.
 */
function WorldLines({ branches, tick }: { branches: BranchView[]; tick: number }) {
  if (branches.length === 0) return null;
  const W = 360;
  const rowH = 30;
  const top = 16;
  const left = 10;
  const right = 118;
  const H = top + branches.length * rowH + 16;
  const tip = (b: BranchView): number => (b.current ? Math.max(b.tipTick, tick) : b.tipTick);
  const maxTick = Math.max(TICKS_PER_DAY, ...branches.map(tip));
  const x = (t: number): number => left + (Math.max(0, t) / maxTick) * (W - left - right);
  const row = new Map(branches.map((b, i) => [b.id, i] as const));
  const y = (i: number): number => top + i * rowH + 6;
  const days = Math.ceil(maxTick / TICKS_PER_DAY);
  const every = days <= 12 ? 2 : days <= 40 ? 10 : days <= 120 ? 20 : 50;
  const marks: number[] = [];
  for (let d = every; d < days; d += every) marks.push(d);
  const summary = branches.map((b) => `${lineName(b)}${row.has(b.parent) && b.forkTick >= 0 ? ` left on day ${day(b.forkTick)}${b.luck === "new" ? " with new luck" : ""}` : ""}, now at day ${day(tip(b))}, ${b.interventions.length} intervention${b.interventions.length === 1 ? "" : "s"}`).join("; ");
  return (
    <svg className={styles.lines} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${branches.length} world line${branches.length === 1 ? "" : "s"}. ${summary}.`} data-testid="world-lines">
      {marks.map((d) => (
        <g key={d}>
          <line x1={x(d * TICKS_PER_DAY)} x2={x(d * TICKS_PER_DAY)} y1={top - 6} y2={H - 14} stroke="rgba(74, 58, 36, 0.14)" strokeWidth={1} />
          <text x={x(d * TICKS_PER_DAY)} y={H - 3} fontSize={9.5} fill={ASIDE} textAnchor="middle">
            day {d + 1}
          </text>
        </g>
      ))}
      <text x={left} y={H - 3} fontSize={9.5} fill={ASIDE}>
        day 1
      </text>
      {branches.map((b, i) => {
        const parent = row.get(b.parent);
        const forked = parent !== undefined && b.forkTick >= 0;
        const from = forked ? b.forkTick : 0;
        const colour = b.current ? LIVED : ASIDE;
        return (
          <g key={b.id} data-testid={`world-line-${b.id}`}>
            {forked ? <path d={`M${x(from).toFixed(1)},${y(parent)} V${y(i)}`} fill="none" stroke={colour} strokeWidth={b.current ? 2.5 : 1.5} strokeDasharray={b.luck === "new" ? "4 3" : undefined} /> : null}
            <line x1={x(from)} x2={x(tip(b))} y1={y(i)} y2={y(i)} stroke={colour} strokeWidth={b.current ? 3 : 2} strokeLinecap="round" strokeDasharray={b.luck === "new" ? "5 4" : undefined} />
            {b.interventions
              .filter((iv) => iv.tick >= from)
              .map((iv, k) => (
                <g key={k} transform={`translate(${x(iv.tick).toFixed(1)},${y(i)}) rotate(45)`}>
                  <rect x={-4} y={-4} width={8} height={8} fill={INK} stroke={SURFACE} strokeWidth={1.5}>
                    <title>{`${SHOCK_NAMES[iv.kind] ?? iv.kind}, day ${day(iv.tick)}`}</title>
                  </rect>
                </g>
              ))}
            <circle cx={x(tip(b))} cy={y(i)} r={b.current ? 5 : 4} fill={colour} stroke={SURFACE} strokeWidth={2} />
            <text x={x(tip(b)) + 9} y={y(i) + 3.5} fontSize={10.5} fontWeight={b.current ? 650 : 500} fill={INK}>
              {lineName(b)} · day {day(tip(b))}
              {b.luck === "new" ? " · new luck" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * History: the moments of this world that can be returned to, the world lines that exist,
 * and the way to carry a world out of the browser and back in.
 *
 * Going back never destroys anything: an exact re-run ends where it left from, checked by
 * the state's digest, and a new line sets the present one aside rather than replacing it.
 */
export function HistoryPanel() {
  const controller = useController();
  const history = useGame((s) => s.hud?.history ?? null);
  const tick = useGame((s) => s.hud?.tick ?? 0);
  const branches = useGame((s) => s.branches);
  const replay = useGame((s) => s.hud?.replay ?? null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const close = () => controller.openPanel("history");
  const moments = (history?.keyTicks ?? []).filter((t) => t <= tick);
  const pick = chosen !== null && moments.includes(chosen) ? chosen : null;
  const act = async (run: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await run();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="history-title" data-testid="history">
        <PanelHead kicker="Nothing here is ever lost" title="History" onClose={close} testId="history" />
        <div className={styles.panelBody}>
          {replay ? (
            <p className={styles.empty}>A recording is its own history: it plays from its record and cannot be branched. Start a world of your own to go back and forth in it.</p>
          ) : (
            <>
              <div className={styles.section} style={{ marginTop: 0 }}>
                <div className={styles.sectionTitle}>
                  Go back <span>the start, and every second morning since</span>
                </div>
                <div className={styles.moments} role="radiogroup" aria-label="A morning to go back to">
                  {moments.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={pick === t} className={styles.moment} onClick={() => setChosen(t)} data-testid={`moment-${t}`}>
                      {momentLabel(t)}
                    </button>
                  ))}
                </div>
                {history?.rebuilding ? (
                  <div className={styles.note} role="status" data-testid="rebuild-progress" style={{ marginTop: 10 }}>
                    <Hourglass aria-hidden />
                    <span>
                      Living its past again from the seed: day {day(history.rebuilding.tick)} of {day(history.rebuilding.untilTick)}. Time is held still until it is done.
                    </span>
                  </div>
                ) : history?.rebuildable ? (
                  <div className={styles.note} style={{ marginTop: 10 }} data-testid="rebuild-offer">
                    <Hourglass aria-hidden />
                    <span>
                      This world was opened from a save, so only the moment it was saved at is in memory. Its past is not lost: the world is deterministic, and its seed and the record of what you did are enough to live every day of it again. The result is kept only if it arrives at exactly this world.
                      <br />
                      <button type="button" className={styles.button} style={{ marginTop: 8 }} disabled={busy} onClick={() => void act(() => controller.rebuildPast())} data-testid="rebuild-past">
                        <RotateCcw aria-hidden />
                        Live its past again
                      </button>
                    </span>
                  </div>
                ) : history?.rebuildBlocked === "new_luck" ? (
                  <p className={styles.muted} data-testid="rebuild-blocked">
                    This line took new luck on the way, so its earlier days cannot be made again from the seed alone. Only the moments since it was opened can be returned to.
                  </p>
                ) : history?.rebuildBlocked === "outside_minds" ? (
                  <p className={styles.muted} data-testid="rebuild-blocked">
                    Some of these people were decided for from outside the engine, and those decisions are not in this world&apos;s own record. Its earlier days can be watched from its recording, not rebuilt here.
                  </p>
                ) : null}
                {pick === null ? (
                  <p className={styles.muted}>Choose a morning. The world is deterministic: from any stored moment it can be run forward again and will do exactly what it did, unless you change something.</p>
                ) : (
                  <div className={styles.cards} style={{ marginTop: 10 }}>
                    <button type="button" className={styles.card} disabled={busy || pick >= tick} onClick={() => void act(() => controller.rewind(pick, "rerun"))} data-testid="rewind-rerun">
                      <span className={styles.cardHead}>
                        <RotateCcw aria-hidden />
                        Watch it again
                      </span>
                      <span className={styles.cardText}>
                        Plays day {day(pick)} to day {day(tick)} again exactly as they went, doing what you did at the moments you did it, and checks at the end that the world is the one you left.
                      </span>
                      <span className={styles.cardFoot}>{pick >= tick ? "this is the present moment" : "exact · verified at the end"}</span>
                    </button>
                    <button type="button" className={styles.card} disabled={busy} onClick={() => void act(() => controller.rewind(pick, "branch"))} data-testid="rewind-branch">
                      <span className={styles.cardHead}>
                        <GitBranch aria-hidden />
                        Leave from there
                      </span>
                      <span className={styles.cardText}>A new line from that morning, without anything you did after it. The same weather and the same luck. The line you are on is set aside, not lost.</span>
                      <span className={styles.cardFoot}>new line · same luck</span>
                    </button>
                    <button type="button" className={styles.card} disabled={busy} onClick={() => void act(() => controller.rewind(pick, "branch_new_luck"))} data-testid="rewind-new-luck">
                      <span className={styles.cardHead}>
                        <Shuffle aria-hidden />
                        Leave with new luck
                      </span>
                      <span className={styles.cardText}>The same, but weather, regrowth and chance are drawn afresh from that morning on. What follows is another possible history, not a matched twin.</span>
                      <span className={styles.cardFoot}>new line · new luck</span>
                    </button>
                  </div>
                )}
              </div>

              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  World lines <span>{branches.length} in this history</span>
                </div>
                <WorldLines branches={branches} tick={tick} />
                <ul className={styles.rows} data-testid="branches">
                  {branches.map((b) => (
                    <li key={b.id} className={styles.row} data-testid={`branch-${b.id}`}>
                      <span>
                        <b>{lineName(b)}</b>
                        {b.forkTick >= 0 && b.parent ? ` · left ${b.parent === "main" || b.parent === "root" ? "the first line" : `line ${b.parent.replace("line-", "")}`} on day ${day(b.forkTick)}${b.luck === "new" ? " with new luck" : ""}` : b.current ? " · the first line of this history" : ""}
                        <br />
                        <span className={styles.rowMeta}>
                          day {day(b.tipTick)} · {b.alive} of {b.population} alive
                          {b.interventions.length ? ` · you: ${b.interventions.map((i) => `${SHOCK_NAMES[i.kind] ?? i.kind} (day ${day(i.tick)})`).join(", ")}` : " · untouched"}
                          {b.sha256 ? ` · state ${b.sha256.slice(0, 10)}…` : ""}
                        </span>
                      </span>
                      {b.current ? (
                        <span className={styles.chip} data-tone="good">
                          being lived
                        </span>
                      ) : (
                        <button type="button" className={styles.button} disabled={busy} onClick={() => void act(() => controller.switchBranch(b.id))} data-testid={`return-${b.id}`}>
                          <HistoryIcon aria-hidden />
                          Return to it
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className={styles.muted} style={{ marginTop: 6 }}>
                  Compare shows the line being lived against its untouched twin. Other lines are shown here as they stood when they were left; two single lines side by side are an anecdote, not a finding. Lines set aside are kept while this page stays open: save or export the one you want to keep.
                </p>
              </div>
            </>
          )}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Take it with you <span>a file that says exactly what it is</span>
            </div>
            <div className={styles.actions} style={{ marginTop: 0 }}>
              {replay ? null : (
                <button type="button" className={styles.button} onClick={() => void controller.exportWorld()} data-testid="export-world">
                  <Download aria-hidden />
                  Export this world
                </button>
              )}
              <button type="button" className={styles.button} onClick={() => void controller.exportLedger()} data-testid="export-ledger">
                <ListTree aria-hidden />
                Download the event ledger
              </button>
              <button type="button" className={styles.button} onClick={() => file.current?.click()} data-testid="import-world">
                <Upload aria-hidden />
                Open a world file
              </button>
              <input
                ref={file}
                type="file"
                accept="application/json,.json"
                hidden
                data-testid="import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void controller.importWorld(f);
                }}
              />
            </div>
            <p className={styles.muted} style={{ marginTop: 8 }}>
              The file holds the world&apos;s state, its untouched twin if it has one, and a manifest: seed, configuration, engine and schema versions, every intervention with its tick, and the SHA-256 of the state. On the way back in the state is hashed again and compared; a file that was damaged or altered is refused and nothing changes. The ledger is the engine&apos;s own list of what happened — one event a line, each with the events recorded as its causes — for the days that are in memory (the most recent 40,000 events: about six weeks of a fifty-person world).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * While a stretch of the world's own past is being re-run this says so, and at the end it
 * says whether the world arrived exactly where it had been.
 */
export function RerunBar() {
  const rerun = useGame((s) => s.hud?.history?.rerun ?? null);
  const tick = useGame((s) => s.hud?.tick ?? 0);
  if (!rerun) return null;
  const state = rerun.verified === null ? "playing" : rerun.verified ? "ended" : "mismatch";
  return (
    <div className={`${styles.glass} ${styles.recording}`} role="status" data-testid="rerun-badge" data-state={state}>
      <RotateCcw aria-hidden />
      <span>
        <b>Your own history, again</b> · day {day(rerun.fromTick)} to day {day(rerun.untilTick)}
        {rerun.pending > 0 ? ` · ${rerun.pending} of your interventions still to come, at the moments you made them` : ""}
      </span>
      <span className={styles.recordingState} data-testid="rerun-state">
        {rerun.verified === null ? `day ${day(tick)} of ${day(rerun.untilTick)}` : rerun.verified ? "arrived: the world is exactly the one you left" : "THIS RE-RUN DID NOT REPRODUCE THE WORLD YOU LEFT"}
      </span>
    </div>
  );
}
