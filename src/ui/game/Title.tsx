"use client";

import { ArrowRight, Film, FlaskConical, FolderOpen, Info, Shuffle, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SCENARIOS, makeConfig, seedFromString, type InstitutionMode, type PolicyKind } from "@/engine";
import { AUTOSAVE_ID } from "@/persist/saves";
import { useGame } from "@/store/game";
import { useController } from "./context";
import styles from "./game.module.css";

export function Title() {
  const controller = useController();
  const saves = useGame((s) => s.saves);
  const set = useGame((s) => s.set);
  const latest = saves[0];
  return (
    <div className={styles.title} data-testid="title">
      <div className={styles.titleTop}>
        <div className={styles.titleKicker}>Civilization without instructions</div>
        <h1 className={styles.titleMark}>Tabula Rasa</h1>
        <p className={styles.titleLede}>A living world. Fifty independent minds. No blueprint for what they should become.</p>
      </div>
      <div className={styles.titleBottom}>
        <div className={styles.titleActions}>
          <button type="button" className={styles.begin} onClick={() => set({ phase: "setup" })} data-testid="begin">
            Begin
            <ArrowRight aria-hidden />
          </button>
          {latest ? (
            <button type="button" className={styles.ghost} onClick={() => void controller.load(latest.id)} data-testid="continue">
              <FolderOpen aria-hidden />
              Continue {latest.id === AUTOSAVE_ID ? "autosave" : "last save"} · day {latest.day + 1}
            </button>
          ) : null}
          <button type="button" className={styles.ghost} onClick={() => set({ panel: "recordings" })} data-testid="title-recordings">
            <Film aria-hidden />
            Recordings
          </button>
          <Link href="/lab" className={styles.ghost} data-testid="title-lab">
            <FlaskConical aria-hidden />
            Laboratory
          </Link>
          <button type="button" className={styles.ghost} onClick={() => controller.openPanel("affordances")} data-testid="title-affordances">
            <Info aria-hidden />
            What was designed
          </button>
        </div>
        <p className={styles.titleNote}>
          The island behind this text is a <b>real simulation running now</b>, not a recording. Its citizens are driven by a built-in BASELINE policy; nothing is sent anywhere and no account is needed.
        </p>
      </div>
    </div>
  );
}

function parseSeed(text: string): number {
  const trimmed = text.trim();
  if (/^\d{1,10}$/.test(trimmed)) return Number(trimmed) >>> 0;
  return seedFromString(trimmed || "tabula rasa");
}

export function Setup() {
  const controller = useController();
  const set = useGame((s) => s.set);
  const error = useGame((s) => s.error);
  const [scenario, setScenario] = useState("long_road");
  const [seedText, setSeedText] = useState("1");
  const [policy, setPolicy] = useState<PolicyKind>("planner");
  const [institutions, setInstitutions] = useState<InstitutionMode>("grammar_search");
  // The five earlier scenarios are made as they were first built unless this is switched on: they are the
  // blank slate the studies ran, and every aim on their cards was counted in such worlds (D-049, D-056).
  const [progress, setProgress] = useState<"on" | "off">("off");
  const chosen = SCENARIOS.find((s) => s.id === scenario) ?? SCENARIOS[0]!;
  const seed = parseSeed(seedText);
  // a scenario that is about crafts has them whatever is chosen below; every other can be played with or without
  const builtIn = chosen.overrides.crafts === true;
  const rules = builtIn ? {} : { crafts: progress === "on", arrivals: progress === "on" };

  return (
    <div className={styles.scrim}>
      <section className={`${styles.paper} ${styles.sheet} ${styles.sheetWide}`} role="dialog" aria-modal="true" aria-labelledby="setup-title" data-testid="setup">
        <div className={styles.panelHead}>
          <div className={styles.panelTitle}>
            <div className={styles.kicker}>A new world</div>
            <h2 id="setup-title">Choose the conditions</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={() => set({ phase: "title" })} aria-label="Back to title" data-testid="setup-close">
            <X aria-hidden />
          </button>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.cards} role="radiogroup" aria-label="Scenario">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={s.id === scenario} className={styles.card} onClick={() => setScenario(s.id)} data-testid={`scenario-${s.id}`}>
                <span className={styles.cardHead}>{s.title}</span>
                <span className={styles.cardText}>{s.tagline}</span>
                <span className={styles.cardFoot}>
                  {s.overrides.crafts ? "The aim" : "Optional aim"}: {s.objective.text}
                </span>
              </button>
            ))}
          </div>
          <p className={styles.lede} style={{ marginTop: 14 }}>
            {chosen.description}
          </p>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              World seed <span>the same seed always grows the same island and the same people</span>
            </div>
            <div className={styles.formRow}>
              <label className={styles.field} style={{ flex: "1 1 180px" }}>
                Seed (a number or any words)
                <input className={styles.input} value={seedText} onChange={(e) => setSeedText(e.target.value.slice(0, 40))} inputMode="text" autoComplete="off" spellCheck={false} data-testid="seed-input" />
              </label>
              <button type="button" className={styles.button} onClick={() => setSeedText(String(1 + Math.floor(Math.random() * 998)))} data-testid="seed-random">
                <Shuffle aria-hidden />
                Surprise me
              </button>
              <label className={styles.field} style={{ flex: "1 1 220px" }}>
                Minds
                <select className={styles.select} value={policy} onChange={(e) => setPolicy(e.target.value as PolicyKind)} data-testid="policy-select">
                  <option value="planner">Baseline — planner (looks ahead: stores, tools, crops, favours)</option>
                  <option value="reflex">Baseline — reflex (serves only the most urgent need)</option>
                </select>
              </label>
            </div>
            <div className={styles.formRow} style={{ marginTop: 10 }}>
              <label className={styles.field} style={{ flex: "1 1 320px" }}>
                Agreements
                <select className={styles.select} value={institutions} onChange={(e) => setInstitutions(e.target.value as InstitutionMode)} data-testid="institutions-select">
                  <option value="grammar_search">Citizens may propose charters (baseline minds: by searching the rule grammar)</option>
                  <option value="off">None: no charters, no pacts</option>
                  <option value="scripted_control">Scripted control: one designer-written charter is offered (not emergence)</option>
                </select>
              </label>
              <label className={styles.field} style={{ flex: "1 1 320px" }}>
                Crafts and newcomers
                <select className={styles.select} value={builtIn ? "on" : progress} onChange={(e) => setProgress(e.target.value as "on" | "off")} disabled={builtIn} data-testid="progress-select">
                  <option value="on">A people that can grow: crafts to be found, works to raise, newcomers drawn by plenty</option>
                  <option value="off">As first built: fifty people, the first toolkit, nobody new (what the studies ran)</option>
                </select>
              </label>
            </div>
            <p className={styles.muted} style={{ marginTop: 8 }}>
              This world will use seed <b className="tnum">{seed}</b>. Both kinds of mind are deterministic programs labelled BASELINE — neither is a language model, and neither is told to form any group or rule.
              {builtIn || progress === "on" ? " The crafts and what each opens are supplied by the designers and listed under “What was designed”; who comes to know them is not." : ""}
            </p>
          </div>
          {error ? (
            <div className={styles.note} data-tone="caution" style={{ marginTop: 12 }} role="alert">
              <Info aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <div className={styles.sheetFoot}>
          <button type="button" className={styles.button} onClick={() => set({ phase: "title" })}>
            Back
          </button>
          <button type="button" className={styles.button} data-variant="ember" onClick={() => void controller.newWorld(makeConfig(scenario, seed, { policy, institutions, ...rules }))} data-testid="create-world">
            Create this world
            <ArrowRight aria-hidden />
          </button>
        </div>
      </section>
    </div>
  );
}
