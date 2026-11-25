"use client";

import {
  ArrowLeftRight,
  BookOpen,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Film,
  GitFork,
  History as HistoryIcon,
  Map as MapIcon,
  Menu,
  Moon,
  NotebookPen,
  Pause,
  Play,
  Sparkles,
  StepForward,
  Sun,
  Thermometer,
  ScrollText,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { SPEEDS, useGame } from "@/store/game";
import { scenarioById } from "@/engine";
import { useController } from "./context";
import styles from "./game.module.css";
import { clock, seasonName, weatherName } from "./text";

function WeatherIcon({ weather, night }: { weather: number; night: boolean }) {
  if (weather === 2) return <CloudRain aria-hidden />;
  if (weather === 3) return <CloudLightning aria-hidden />;
  if (weather === 4) return <CloudSnow aria-hidden />;
  if (weather === 1) return <Cloud aria-hidden />;
  return night ? <Moon aria-hidden /> : <Sun aria-hidden />;
}

export function TopBar() {
  const controller = useController();
  const hud = useGame((s) => s.hud);
  const world = useGame((s) => s.world);
  const panel = useGame((s) => s.panel);
  const forkDay = useGame((s) => s.forkDay);
  const civic = useGame((s) => s.hud?.civic);
  const unread = useGame((s) => s.chronicle.length > 0 && s.panel !== "chronicle");
  const soundOn = useGame((s) => s.soundOn);
  const journalUnread = useGame((s) => s.journalUnread);
  if (!hud || !world) return null;
  const scenario = scenarioById(world.config.scenario);
  const night = hud.climate.light < 250;
  const condition = hud.climate.drought ? "Drought" : hud.climate.cold ? "Cold snap" : weatherName(hud.climate.weather);
  return (
    <header className={styles.topbar}>
      <div className={`${styles.glass} ${styles.brand}`} data-testid="brand">
        <span className={styles.wordmark}>Tabula Rasa</span>
        <span className={styles.worldLabel} data-testid="world-label">
          {scenario.title} · seed {world.config.seed}
        </span>
      </div>

      {/* the fork and its twin: one small pill of its own, so that it is never squeezed out of sight by the bars beside it */}
      {forkDay >= 0 || hud.hasTwin ? (
        <div className={`${styles.glass} ${styles.forkGroup}`} role="group" aria-label={forkDay >= 0 ? "This timeline and its untouched twin" : "The recording and the engine's own minds"} data-testid="fork-controls">
          {forkDay >= 0 ? (
            <button type="button" className={styles.forked} onClick={() => controller.openPanel("compare")} data-testid="forked-badge" title="This timeline has been changed by you. Open the comparison (K).">
              <GitFork aria-hidden />
              <span>
                <span className={styles.forkWord}>Forked on </span>day {forkDay + 1}
              </span>
            </button>
          ) : null}
          {hud.hasTwin ? (
            <button
              type="button"
              className={styles.forked}
              aria-pressed={hud.viewing === "twin"}
              onClick={() => controller.viewTwin(hud.viewing !== "twin")}
              data-testid="view-twin"
              title={hud.replay ? "Look at the same island with the engine's own minds deciding (X)" : "Look at the untouched twin: same island, same moment, without what you did (X)"}
            >
              <ArrowLeftRight aria-hidden />
              <span className={styles.twinLabel}>{hud.viewing === "twin" ? "Back" : "Twin"}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={`${styles.glass} ${styles.status}`} role="status" aria-label="World status" data-testid="status-bar">
        <div className={styles.stat} data-testid="stat-date">
          <b className="tnum">Day {hud.cal.day + 1}</b>
          <span className={`${styles.statMuted} ${styles.statOptional}`}>{seasonName(hud.cal.season)}</span>
        </div>
        <span className={styles.divider} aria-hidden />
        <div className={styles.stat} title={`${condition}, ${(hud.climate.temp / 10).toFixed(0)}°C`}>
          <WeatherIcon weather={hud.climate.weather} night={night} />
          <span className={styles.statOptional}>{condition}</span>
        </div>
        <div className={styles.stat}>
          <Thermometer aria-hidden />
          <span className="tnum">{(hud.climate.temp / 10).toFixed(0)}°</span>
        </div>
        <span className={styles.divider} aria-hidden />
        <div className={styles.stat} data-testid="stat-population" title="Living citizens">
          <Users aria-hidden />
          <b className="tnum">{hud.alive}</b>
          <span className={`${styles.statMuted} tnum`}>/ {hud.agentCount}</span>
        </div>
      </div>

      <nav className={`${styles.glass} ${styles.tools}`} aria-label="Panels" data-testid="tools">
        <button type="button" className={styles.iconButton} aria-pressed={panel === "chronicle"} onClick={() => controller.openPanel("chronicle")} data-testid="open-chronicle" title="Chronicle (C)">
          <BookOpen aria-hidden />
          <span>Chronicle</span>
          {unread ? <i className={styles.badge} aria-hidden /> : null}
        </button>
        <button type="button" className={styles.iconButton} aria-pressed={panel === "interventions"} onClick={() => controller.openPanel("interventions")} disabled={hud.replay !== null || hud.viewing === "twin"} data-testid="open-interventions" title={hud.replay ? "A recording shows what happened; it cannot be changed" : hud.viewing === "twin" ? "The twin is never touched. Go back to your world to change it." : "Change the world (I)"}>
          <Sparkles aria-hidden />
          <span>Intervene</span>
        </button>
        <button type="button" className={styles.iconButton} aria-pressed={panel === "civics"} onClick={() => controller.openPanel("civics")} data-testid="open-civics" title="Charters (G)">
          <ScrollText aria-hidden />
          <span>Charters</span>
          {civic && civic.proposals + civic.institutions > 0 ? (
            <b className={styles.count} data-testid="civics-count">
              {civic.institutions}
              {civic.proposals ? `+${civic.proposals}` : ""}
            </b>
          ) : null}
        </button>
        <button type="button" className={styles.iconButton} aria-pressed={panel === "compare"} onClick={() => controller.openPanel("compare")} disabled={forkDay < 0 && !hud.hasTwin} data-testid="open-compare" title={forkDay < 0 && !hud.hasTwin ? "Compare becomes available after you intervene" : "Compare timelines (K)"}>
          <GitFork aria-hidden />
          <span className={styles.labelOptional}>Compare</span>
        </button>
        <button type="button" className={`${styles.iconButton} ${styles.toolTertiary}`} aria-pressed={panel === "history"} onClick={() => controller.openPanel("history")} data-testid="open-history" title="History: go back, world lines, files (H)">
          <HistoryIcon aria-hidden />
          <span className="sr-only">History</span>
        </button>
        <button type="button" className={styles.iconButton} aria-pressed={panel === "atlas"} onClick={() => controller.openPanel("atlas")} data-testid="open-atlas" title="Atlas and almanac (L)">
          <MapIcon aria-hidden />
          <span className="sr-only">Atlas</span>
        </button>
        <button type="button" className={`${styles.iconButton} ${styles.toolSecondary}`} aria-pressed={panel === "journal"} onClick={() => controller.openPanel("journal")} data-testid="open-journal" title="Field journal (J)">
          <NotebookPen aria-hidden />
          <span className="sr-only">Field journal</span>
          {journalUnread > 0 ? <i className={styles.badge} aria-hidden /> : null}
        </button>
        <button type="button" className={`${styles.iconButton} ${styles.toolSecondary}`} aria-pressed={soundOn} onClick={() => void controller.setSound(!soundOn)} data-testid="toggle-sound" title={soundOn ? "Sound is on (M)" : "Sound is off (M)"}>
          {soundOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
          <span className="sr-only">{soundOn ? "Turn sound off" : "Turn sound on"}</span>
        </button>
        <button type="button" className={styles.iconButton} aria-pressed={panel === "menu"} onClick={() => controller.openPanel("menu")} data-testid="open-menu" title="Menu">
          <Menu aria-hidden />
          <span className="sr-only">Menu</span>
        </button>
      </nav>
    </header>
  );
}

/**
 * While a recording is watched this says, in full and at all times, whose minds were
 * recorded and how far the replay has been checked against the record. It is never
 * abbreviated to something that could be mistaken for a live model.
 */
export function RecordingBar() {
  const replay = useGame((s) => s.hud?.replay ?? null);
  const viewing = useGame((s) => s.hud?.viewing ?? "world");
  // while the twin is on screen its own banner says what is being looked at
  if (!replay || viewing === "twin") return null;
  const minds = replay.provider === "anthropic" ? `language model ${replay.model}` : replay.provider === "mock" ? "MOCK minds, a test double (not a language model)" : "baseline minds";
  const days = Math.max(1, Math.round(replay.endTick / 96));
  const day = Math.floor(replay.verifiedTick / 96);
  const state =
    replay.state === "mismatch"
      ? "THIS ENGINE DID NOT REPRODUCE THE RECORD"
      : replay.state === "ended"
        ? replay.verifiedTick >= replay.endTick
          ? `ended: all ${days} days matched the record`
          : `ended: matched the record to day ${day} of ${days}`
        : `matches the record to day ${day} of ${days}`;
  return (
    <div className={`${styles.glass} ${styles.recording}`} role="status" data-testid="recording-badge" data-state={replay.state} title={replay.title || "Recording"}>
      <Film aria-hidden />
      <span>
        <b>Recording</b> · {minds} · {replay.decisions} decisions replayed, nobody consulted
      </span>
      <span className={styles.recordingState} data-testid="recording-state">
        {state}
      </span>
    </div>
  );
}

/**
 * While the twin is on screen this says so, always: what is shown is not the world being
 * lived (or not the recording), and nothing done here can change it.
 */
export function TwinBar() {
  const controller = useController();
  const viewing = useGame((s) => s.hud?.viewing ?? "world");
  const replay = useGame((s) => s.hud?.replay ?? null);
  const forkDay = useGame((s) => s.forkDay);
  if (viewing !== "twin") return null;
  return (
    <div className={`${styles.glass} ${styles.recording}`} role="status" data-testid="twin-badge" data-state="twin">
      <ArrowLeftRight aria-hidden />
      <span>
        {replay ? (
          <>
            <b>Not the recording</b> · the same island, people and weather, with the engine&apos;s own minds deciding instead of the recorded ones
          </>
        ) : (
          <>
            <b>The untouched twin</b> · the same island, people, weather and luck at the same moment, without anything you did since day {forkDay + 1}
          </>
        )}
      </span>
      <button type="button" className={styles.bannerButton} onClick={() => controller.viewTwin(false)} data-testid="twin-back">
        {replay ? "Back to the recording" : "Back to your world"}
      </button>
    </div>
  );
}

export function Timebar() {
  const controller = useController();
  const hud = useGame((s) => s.hud);
  const speed = useGame((s) => s.speed);
  if (!hud) return null;
  const dayFraction = hud.cal.tickOfDay / 96;
  return (
    <div className={`${styles.glass} ${styles.timebar}`} role="group" aria-label="Time controls">
      <button type="button" className={styles.playButton} onClick={() => controller.toggle()} aria-label={hud.playing ? "Pause" : "Play"} data-testid="play-toggle" data-playing={hud.playing}>
        {hud.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
      </button>
      <button type="button" className={styles.iconButton} onClick={() => controller.step(1)} aria-label="Step one tick" title="Step one tick (.)" data-testid="step-tick">
        <StepForward aria-hidden />
      </button>
      <div className={styles.speeds} role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((s, i) => (
          <button key={s.label} type="button" role="radio" aria-checked={i === speed} className={styles.speed} onClick={() => controller.setSpeed(i)} data-testid={`speed-${i}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className={styles.clock} role="group" aria-label={`Day ${hud.cal.day + 1}, ${clock(hud.cal.tickOfDay)}`}>
        <div className={styles.clockText}>
          <strong className="tnum" data-testid="clock">
            {clock(hud.cal.tickOfDay)}
          </strong>
          <span className={`${styles.statMuted} tnum`} data-testid="tick">
            tick {hud.tick}
          </span>
        </div>
        <div className={styles.dayTrack} aria-hidden>
          <i className={styles.dayMarker} style={{ left: `${(dayFraction * 100).toFixed(1)}%` }} />
        </div>
      </div>
    </div>
  );
}

const COACH: readonly string[] = [
  "Nobody here has been told what to do. Press play and watch what they do with their morning.",
  "Tap a citizen to see what they need, what they believe, and why they are doing what they do.",
  "Open the Chronicle: every line is something the engine actually logged, with its recorded cause.",
  "You cannot command anyone — but you can change the world. Open Intervene and try something.",
  "Your change forked history. Open Compare to see your timeline beside the untouched one.",
];

export function Coach() {
  const controller = useController();
  const step = useGame((s) => s.tutorialStep);
  const panel = useGame((s) => s.panel);
  if (step < 0 || step >= COACH.length || panel === "interventions" || panel === "compare" || panel === "menu") return null;
  return (
    <aside className={`${styles.glass} ${styles.coach}`} data-testid="coach" aria-live="polite">
      <div>
        <div className={styles.coachStep}>
          First steps · {step + 1} of {COACH.length}
        </div>
        <p className={styles.coachText}>{COACH[step]}</p>
      </div>
      <button type="button" className={styles.coachSkip} onClick={() => controller.finishTutorial()} data-testid="coach-skip">
        Skip
      </button>
    </aside>
  );
}

export function Toast() {
  const toast = useGame((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`${styles.glass} ${styles.toast}`} role="status" data-testid="toast">
      {toast}
    </div>
  );
}
