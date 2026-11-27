"use client";

import { Hand, Milestone, RotateCcw, Shuffle, Target } from "lucide-react";
import { AGES, CRAFTS, CRAFT_SPECS, LEGACY_POINTS, STRUCTURE_KINDS, ageTitle, needText, scenarioById } from "@/engine";
import { useGame } from "@/store/game";
import { CRAFT_LABEL, STRUCTURE_LABEL } from "@/worker/describe";
import type { ProgressView } from "@/worker/protocol";
import { useController } from "./context";
import styles from "./game.module.css";
import { seasonName } from "./text";
import { worthLines, worthShort } from "./worth";

/**
 * What an observer steers by in a world with crafts: how far the island has come along the
 * ladder of ages, what the next one asks for, what it has to show (legacy) beside what its
 * untouched twin has, and — where the scenario limits it — how many changes are left this
 * season. All of it is a reading of the world's own state (src/engine/metrics/ages.ts). No
 * citizen is told any of it, and nothing here is a forecast.
 */

const fmt = (n: number): string => n.toLocaleString("en-GB");
const shownDay = (tick: number): number => Math.floor(tick / 96) + 1;

const SEASON_AFTER = ["summer", "autumn", "winter", "spring"];

/** "1 change left this season" · "Changed this season: yours again in summer". */
export function handText(left: number, perSeason: number, season: number): string {
  if (left <= 0) return `Used this season · yours again in ${SEASON_AFTER[season] ?? "the next season"}`;
  return perSeason === 1 ? "1 change this season" : `${left} of ${perSeason} changes left this season`;
}

/** The pill under the top bar: the age, the next one's thresholds, legacy, the hand. It opens the Atlas. */
export function GoalBar() {
  const controller = useController();
  const progress = useGame((s) => s.hud?.progress ?? null);
  const hand = useGame((s) => s.hud?.hand ?? null);
  const season = useGame((s) => s.hud?.cal.season ?? 0);
  const viewing = useGame((s) => s.hud?.viewing ?? "world");
  const replay = useGame((s) => s.hud?.replay ?? null);
  const rerun = useGame((s) => s.hud?.history?.rerun ?? null);
  const rebuilding = useGame((s) => s.hud?.history?.rebuilding ?? null);
  const aim = useGame((s) => s.aim?.yours ?? null);
  // while another bar has something to say about which world this is, it has the place
  if (!progress || viewing === "twin" || replay || rerun || rebuilding) return null;
  const next = progress.next;
  // the aim on the card, in a few words: how it stands while open, the day it was decided once it is
  const aimWords = !aim ? "" : aim.state === "met" ? `aim met on day ${aim.decidedDay ?? "?"}` : aim.state === "lost" ? `aim lost on day ${aim.decidedDay ?? "?"}` : aim.figure;
  return (
    // The button's name is what it shows (a name that differs from the visible words fails people who
    // speak to their screens); the few words that only a listener needs are there for a listener alone.
    <button type="button" className={`${styles.glass} ${styles.goal}`} onClick={() => controller.openPanel("atlas")} title="How far they have come: open the Atlas (L)" data-testid="goal-bar" data-age={progress.reached}>
      <span className={styles.goalAge} data-testid="goal-age">
        <Milestone aria-hidden />
        <b>{ageTitle(progress.reached)}</b>
      </span>
      <span className={styles.goalDots} aria-hidden>
        {AGES.map((name, i) => (
          <i key={name} data-on={i <= progress.reached} />
        ))}
      </span>
      {next ? (
        <span className={styles.goalNext} data-testid="goal-next">
          next, {AGES[next.age]}: {next.needs.map(needText).join(" · ")}
        </span>
      ) : (
        <span className={styles.goalNext} data-testid="goal-next">
          the last age is reached
        </span>
      )}
      <span className={styles.goalLegacy} data-testid="goal-legacy">
        Legacy <b className="tnum">{fmt(progress.legacy.total)}</b>
        {progress.twin ? <span className={styles.goalTwin}> · {worthShort(progress)}</span> : null}
      </span>
      {aim ? (
        <span className={styles.goalAim} data-state={aim.state} title={aim.text}>
          <Target aria-hidden />
          {aim.state === "met" || aim.state === "lost" ? null : <span className="sr-only">The aim: </span>}
          <span data-testid="goal-aim" data-state={aim.state}>{aimWords}</span>
        </span>
      ) : null}
      {hand ? (
        <span className={styles.goalHand} data-testid="goal-hand" data-left={hand.left}>
          <Hand aria-hidden />
          {handText(hand.left, hand.perSeason, season)}
        </span>
      ) : null}
      <span className="sr-only">. Open the Atlas.</span>
    </button>
  );
}

function LegacyTable({ progress }: { progress: ProgressView }) {
  const rows: { part: string; how: string; points: number }[] = [
    { part: "People", how: `${progress.living} alive × ${LEGACY_POINTS.person}`, points: progress.legacy.people },
    { part: "Crafts", how: `${LEGACY_POINTS.craftKnown} for each a living person knows, ${LEGACY_POINTS.craftRecorded} for each written down`, points: progress.legacy.crafts },
    { part: "Works", how: "each standing work, up to a limit for its kind", points: progress.legacy.works },
    { part: "Ages", how: `${LEGACY_POINTS.age} for each age reached`, points: progress.legacy.ages },
  ];
  return (
    <table className={styles.table} data-testid="legacy-table">
      <caption className="sr-only">Legacy, part by part</caption>
      <thead>
        <tr>
          <th scope="col">Part</th>
          <th scope="col">Counted as</th>
          <th scope="col">Points</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.part}>
            <th scope="row">{r.part}</th>
            <td>{r.how}</td>
            <td className="tnum">{fmt(r.points)}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">Legacy</th>
          <td>{progress.twin ? `the untouched twin's is ${fmt(progress.twin.legacy)}, with ${progress.twin.living} alive in the ${ageTitle(progress.twin.reached)}` : "nobody has touched this world: there is no twin to set it beside"}</td>
          <td className="tnum">
            <b data-testid="legacy-total">{fmt(progress.legacy.total)}</b>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The Atlas's page on ages, legacy and crafts (worlds with crafts). */
export function Ages() {
  const controller = useController();
  const progress = useGame((s) => s.hud?.progress ?? null);
  const hand = useGame((s) => s.hud?.hand ?? null);
  const season = useGame((s) => s.hud?.cal.season ?? 0);
  if (!progress) return null;
  return (
    <div className={styles.ages} data-testid="ages">
      <div className={styles.sectionTitle} style={{ marginTop: 0 }}>
        How far they have come <span>a reading for you · no citizen is told</span>
      </div>
      <ol className={styles.ladder}>
        {AGES.map((name, i) => {
          const tick = progress.ticks[i] ?? -1;
          const reached = i <= progress.reached;
          const isNext = progress.next?.age === i;
          const fallen = reached && i > progress.standing;
          return (
            <li key={name} data-state={reached ? "reached" : isNext ? "next" : "ahead"} data-testid={`age-${name}`}>
              <i aria-hidden />
              <div>
                <b>{ageTitle(i)}</b>
                <span>
                  {i === 0 ? "where every island begins" : reached ? `reached on day ${shownDay(tick)}${fallen ? " — though not everything it took still stands" : ""}` : isNext && progress.next ? progress.next.needs.map(needText).join(" · ") : "not yet"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {hand ? (
        <p className={styles.aimLine} data-testid="ages-hand">
          Your hand: this island lets you change it {hand.perSeason === 1 ? "once" : `${hand.perSeason} times`} a season. {hand.left > 0 ? (hand.perSeason === 1 ? "You have not used this season's change." : `${hand.left} left this season.`) : `You have used it: it is yours again in ${SEASON_AFTER[season] ?? "the next season"} (it is ${seasonName(season).toLowerCase()} now).`}
        </p>
      ) : null}

      <div className={styles.sectionTitle}>
        Legacy <span>what they have to show this morning</span>
      </div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Legacy, part by part">
        <LegacyTable progress={progress} />
      </div>
      {progress.twin ? (
        <p className={styles.aimLine} data-testid="ages-worth">
          {worthLines(progress).join(" ")} <span className={styles.muted}>One pair of histories: it says what happened in these two, not what a change does in general.</span>
        </p>
      ) : (
        <p className={styles.aimLine} data-testid="ages-worth">
          Nothing has been changed here, so there is no twin yet. The first change you make keeps an untouched copy running beside this world, and from then on this page says what your hand has been worth.
        </p>
      )}

      <div className={styles.sectionTitle}>
        Crafts <span>known by persons · found by practice, by watching, by reading</span>
      </div>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Who knows which craft">
        <table className={styles.table} data-testid="crafts-table">
          <caption className="sr-only">Each craft: what it opens, how many living people know it, whether it is written down</caption>
          <thead>
            <tr>
              <th scope="col">Craft</th>
              <th scope="col">Opens</th>
              <th scope="col">Known by</th>
              <th scope="col">Written down</th>
            </tr>
          </thead>
          <tbody>
            {CRAFT_SPECS.map((c) => {
              const known = progress.knowers[c.id] ?? 0;
              const written = (progress.recorded & (1 << c.id)) !== 0;
              const needs = c.needs.map((n) => CRAFT_LABEL[CRAFTS[n] as string]).join(" and ");
              return (
                <tr key={c.id} data-known={known > 0}>
                  <th scope="row">
                    {CRAFT_LABEL[c.name]}
                    {needs ? <span className={styles.tableNote}> · rests on {needs}</span> : null}
                  </th>
                  <td>{STRUCTURE_LABEL[STRUCTURE_KINDS[c.opens] as string]}</td>
                  <td className="tnum">{known === 0 ? "nobody" : known}</td>
                  <td>{written ? "yes" : "no"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.aimLine}>
        Standing now: {progress.works.fields} fields, {progress.works.granaries} granaries, {progress.works.houses} stone houses, {progress.works.healingHouses} healing houses, {progress.works.mills} mills, {progress.works.recordHouses} record houses.
      </p>
      <p className={styles.muted} style={{ marginTop: 8 }} data-testid="ages-designed">
        The crafts, what each opens, and where one age ends and the next begins were drawn by the designers. Who comes to know a craft, and what they do with it, was not. A world made without crafts has none of this.
      </p>
      <button type="button" className={styles.linkButton} onClick={() => controller.openPanel("affordances")} data-testid="ages-open-designed">
        See what was designed
      </button>
    </div>
  );
}

/**
 * The closing page: shown once when the island's people are all dead, or on the morning the
 * scenario's aim is met. It says what they came to, beside the untouched twin, and offers the
 * same island again or another. Closing it changes nothing: the world goes on.
 */
export function Closing() {
  const controller = useController();
  const closing = useGame((s) => s.closing);
  const progress = useGame((s) => s.hud?.progress ?? null);
  const world = useGame((s) => s.world);
  const aim = useGame((s) => s.aim);
  const series = useGame((s) => s.series);
  const day = useGame((s) => (s.hud ? s.hud.cal.day + 1 : 0));
  const set = useGame((s) => s.set);
  if (!closing || !progress || !world) return null;
  const scenario = scenarioById(world.config.scenario);
  let most = 0;
  let mostDay = 0;
  for (const d of series) {
    if (d.alive > most) {
      most = d.alive;
      mostDay = d.day + 1;
    }
  }
  // "They keep their own record now" is what The Long Road's aim means; any other card's aim is named plainly
  const title = closing === "extinct" ? "No one is left" : closing === "met" ? (aim?.yours?.id === "letters_in_time" ? "They keep their own record now" : "The aim was met") : "The aim was lost";
  const lede =
    closing === "extinct"
      ? `The last of them died on day ${day}. They had come as far as the ${ageTitle(progress.reached)}${progress.reached > 0 ? ` (day ${shownDay(progress.ticks[progress.reached] ?? 0)})` : ""}${most > 0 ? `, and at their most they were ${most}, on day ${mostDay}` : ""}.`
      : closing === "met"
        ? `${aim?.yours?.lines.join(" ") ?? `On day ${day} the aim on this world's card was met.`}`
        : `${aim?.yours?.lines.join(" ") ?? `On day ${day} the aim on this world's card was lost.`}`;
  const close = () => set({ closing: null });
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="closing-title" data-testid="closing" data-kind={closing}>
        <div className={styles.panelHead}>
          <div className={styles.panelTitle}>
            <div className={styles.kicker}>
              {scenario.title} · seed {world.config.seed} · day {day}
            </div>
            <h2 id="closing-title">{title}</h2>
          </div>
        </div>
        <div className={styles.panelBody}>
          <p className={styles.lede} data-testid="closing-lede">
            {lede}
          </p>
          <p className={styles.aimLine}>
            {progress.twin
              ? `${worthLines(progress).join(" ")} (The twin is the same island and luck with nothing you did: it stands in the ${ageTitle(progress.twin.reached)} with ${progress.twin.living} alive.)`
              : "You never changed this world, so there is no twin to say what your hand was worth: this is what they did alone."}
          </p>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Legacy <span>what they have to show this morning</span>
            </div>
            <LegacyTable progress={progress} />
          </div>
          <p className={styles.muted} style={{ marginTop: 12 }}>
            A legacy is a reading the designers chose, not a verdict of the islanders: more people, more know-how and more building count for more. One island is one history; the same seed with a different hand is another.
          </p>
        </div>
        <div className={styles.sheetFoot}>
          <button type="button" className={styles.button} onClick={close} data-testid="closing-stay">
            {closing === "extinct" ? "Look at what is left" : "Keep watching"}
          </button>
          <button type="button" className={styles.button} onClick={() => void controller.again()} data-testid="closing-again">
            <RotateCcw aria-hidden />
            This island again
          </button>
          <button type="button" className={styles.button} data-variant="ember" onClick={() => controller.another()} data-testid="closing-another">
            <Shuffle aria-hidden />
            Another island
          </button>
        </div>
      </section>
    </div>
  );
}
