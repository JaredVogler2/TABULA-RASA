"use client";

import {
  CloudRain,
  FolderOpen,
  Info,
  Leaf,
  Map as MapIcon,
  Megaphone,
  NotebookPen,
  Save,
  Snowflake,
  Sprout,
  Sun,
  Trash2,
  UsersRound,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AFFORDANCES, AFFORDANCE_CATEGORIES, AFFORDANCE_VERSION, ENGINE_VERSION, type AffordanceCategory } from "@/engine";
import { useGame } from "@/store/game";
import { useController } from "./context";
import styles from "./game.module.css";
import { clock, type ChronicleGroup } from "./text";

export function PanelHead({ kicker, title, onClose, testId }: { kicker: string; title: string; onClose: () => void; testId?: string }) {
  return (
    <div className={styles.panelHead}>
      <div className={styles.panelTitle}>
        <div className={styles.kicker}>{kicker}</div>
        <h2 id={testId ? `${testId}-title` : undefined}>{title}</h2>
      </div>
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label={`Close ${title}`} data-testid={testId ? `${testId}-close` : undefined}>
        <X aria-hidden />
      </button>
    </div>
  );
}

// ───────────────────────── Chronicle

const FILTERS: { id: "all" | ChronicleGroup; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "people", label: "People" },
  { id: "making", label: "Making" },
  { id: "institutions", label: "Agreements" },
  { id: "nature", label: "Nature" },
  { id: "observer", label: "Your hand" },
];

export function Chronicle() {
  const controller = useController();
  const entries = useGame((s) => s.chronicle);
  const selection = useGame((s) => s.selection);
  const roster = useGame((s) => s.roster);
  const [filter, setFilter] = useState<"all" | ChronicleGroup>("all");
  const [onlySelected, setOnlySelected] = useState(false);
  const selectedAgent = selection?.type === "agent" ? selection.id : -1;

  const shown = useMemo(() => {
    const list = entries.filter((e) => (filter === "all" || e.group === filter) && (!onlySelected || selectedAgent < 0 || e.agents.includes(selectedAgent)));
    return list.slice(-220).reverse();
  }, [entries, filter, onlySelected, selectedAgent]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  return (
    <aside className={`${styles.paper} ${styles.side} ${styles.sideLeft}`} aria-label="Chronicle" data-testid="chronicle">
      <PanelHead kicker="Logged by the engine" title="Chronicle" onClose={() => controller.openPanel("chronicle")} testId="chronicle" />
      <div className={styles.filters} role="toolbar" aria-label="Filter the Chronicle">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={styles.filter} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`filter-${f.id}`}>
            {f.label}
          </button>
        ))}
        {selectedAgent >= 0 ? (
          <button type="button" className={styles.filter} aria-pressed={onlySelected} onClick={() => setOnlySelected((v) => !v)}>
            Only {roster[selectedAgent]?.name ?? "selected"}
          </button>
        ) : null}
      </div>
      <div className={styles.panelBody}>
        {shown.length === 0 ? (
          <p className={styles.empty}>Nothing has been logged yet. Press play: every line that appears here is an event the engine validated and executed.</p>
        ) : (
          <ol className={styles.entries} data-testid="chronicle-entries">
            {shown.map((e, index) => {
              const day = Math.floor(e.tick / 96);
              const previous = shown[index - 1];
              const heading = !previous || Math.floor(previous.tick / 96) !== day;
              const cause = e.parents.map((p) => byId.get(p)).find((p) => p !== undefined);
              return (
                <li key={e.id}>
                  {heading ? <div className={styles.dayHeading}>Day {day + 1}</div> : null}
                  <button type="button" className={styles.entry} data-group={e.group} data-weight={e.weight} onClick={() => controller.jumpTo(e)} title="Go to where this happened">
                    <span className={styles.entryTime}>{clock(e.tick % 96)}</span>
                    <span>
                      <span className={styles.entryText}>{e.text}</span>
                      {cause ? <span className={styles.cause}>Recorded cause: {cause.text}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}

// ───────────────────────── Interventions

interface InterventionDef {
  kind: string;
  title: string;
  icon: React.ReactNode;
  text: string;
  foot: string;
  params: Record<string, number>;
}

const INTERVENTIONS: InterventionDef[] = [
  { kind: "cold_snap", title: "Cold snap", icon: <Snowflake aria-hidden />, text: "The air drops about nine degrees for three days. Bodies lose warmth faster unless they find fire or shelter.", foot: "3 days · whole island", params: { days: 3, magnitude: 1000 } },
  { kind: "drought", title: "Drought", icon: <Sun aria-hidden />, text: "Rain stops for six days. Seasonal streams run dry, and bushes, roots and reeds stop growing.", foot: "6 days · whole island", params: { days: 6, magnitude: 1000 } },
  { kind: "blight", title: "Blight", icon: <Leaf aria-hidden />, text: "About six in ten berry bushes and root patches lose nine-tenths of their stock overnight.", foot: "instant · wild food", params: { magnitude: 1000 } },
  { kind: "rain", title: "Long rain", icon: <CloudRain aria-hidden />, text: "Two days of steady rain. Colder and wetter for anyone outdoors; fires burn through wood faster.", foot: "2 days · whole island", params: { days: 2, magnitude: 1000 } },
  { kind: "bounty", title: "Bounty", icon: <Sprout aria-hidden />, text: "About six in ten renewable resources — bushes, roots, reeds, trees, fishing waters — are restored to capacity.", foot: "instant · renewables", params: { magnitude: 1000 } },
  { kind: "windfall", title: "Windfall", icon: <Waves aria-hidden />, text: "Twenty-four fish and sixteen pieces of driftwood wash up on one stretch of shore. Whoever finds them may take them.", foot: "instant · one beach", params: { magnitude: 1000 } },
  { kind: "newcomers", title: "Newcomers", icon: <UsersRound aria-hidden />, text: "Five strangers land together on the shore, knowing nothing of the island or its people.", foot: "instant · five adults", params: { count: 5 } },
  { kind: "hush", title: "Hush", icon: <Megaphone aria-hidden />, text: "For four days voices carry only to someone standing next to the speaker.", foot: "4 days · communication", params: { days: 4, radius: 1 } },
];

export function Interventions() {
  const controller = useController();
  const forkDay = useGame((s) => s.forkDay);
  const [busy, setBusy] = useState("");
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && controller.openPanel("interventions")}>
      <section className={`${styles.paper} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="interventions-title" data-testid="interventions">
        <PanelHead kicker="Change the conditions, never the minds" title="Intervene" onClose={() => controller.openPanel("interventions")} testId="interventions" />
        <div className={styles.panelBody}>
          <div className={styles.note}>
            <Info aria-hidden />
            <span>
              {forkDay < 0
                ? "The moment you intervene, history forks. Your timeline carries the change; an untouched twin with the same weather and luck keeps running unseen, so you can compare them."
                : `History already forked on day ${forkDay + 1}. Further changes add to your timeline; the untouched twin stays untouched.`}{" "}
              Nothing here tells anyone what to do, and no outcome is predicted — the only honest forecast is to run it.
            </span>
          </div>
          <div className={styles.cards} style={{ marginTop: 14 }}>
            {INTERVENTIONS.map((iv) => (
              <button
                key={iv.kind}
                type="button"
                className={styles.card}
                disabled={busy !== ""}
                data-testid={`intervene-${iv.kind}`}
                onClick={async () => {
                  setBusy(iv.kind);
                  try {
                    await controller.intervene(iv.kind, iv.params);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <span className={styles.cardHead}>
                  {iv.icon}
                  {iv.title}
                </span>
                <span className={styles.cardText}>{iv.text}</span>
                <span className={styles.cardFoot}>{iv.foot}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// ───────────────────────── Menu, saves, settings

export function MenuPanel() {
  const controller = useController();
  const saves = useGame((s) => s.saves);
  const settings = useGame((s) => s.settings);
  const world = useGame((s) => s.world);
  const replay = useGame((s) => s.hud?.replay ?? null);
  const soundOn = useGame((s) => s.soundOn);
  const close = () => controller.openPanel("menu");
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="menu-title" data-testid="menu">
        <PanelHead kicker="This world" title="Menu" onClose={close} testId="menu" />
        <div className={styles.panelBody}>
          <div className={styles.actions} style={{ marginTop: 0 }}>
            {replay ? null : (
              <button type="button" className={styles.button} data-variant="primary" onClick={() => void controller.save()} data-testid="save-game">
                <Save aria-hidden />
                Save this world
              </button>
            )}
            <button type="button" className={styles.button} onClick={() => controller.openPanel("journal")} data-testid="menu-journal">
              <NotebookPen aria-hidden />
              Field journal
            </button>
            <button type="button" className={styles.button} onClick={() => controller.openPanel("atlas")} data-testid="menu-atlas">
              <MapIcon aria-hidden />
              Atlas
            </button>
            <button type="button" className={styles.button} onClick={() => controller.openPanel("affordances")} data-testid="open-affordances">
              <Info aria-hidden />
              What was designed
            </button>
            <button type="button" className={styles.button} onClick={() => void controller.toTitle()} data-testid="to-title">
              Leave to title
            </button>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Saved worlds <span>stored only in this browser</span>
            </div>
            {saves.length === 0 ? (
              <p className={styles.muted}>No saves yet. The game also autosaves every second day.</p>
            ) : (
              <ul className={styles.rows} data-testid="save-list">
                {saves.map((s) => (
                  <li key={s.id} className={styles.row}>
                    <button type="button" className={styles.linkButton} onClick={() => void controller.load(s.id)} data-testid={`load-${s.id}`}>
                      <FolderOpen aria-hidden style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
                      {s.name}
                    </button>
                    <span className={styles.rowMeta}>
                      {s.alive} alive{s.treated ? " · forked" : ""} · {new Date(s.savedAt).toLocaleString()} · {s.hash.slice(0, 8)}{" "}
                      <button type="button" className={styles.linkButton} onClick={() => void controller.remove(s.id)} aria-label={`Delete ${s.name}`}>
                        <Trash2 aria-hidden style={{ width: 14, height: 14, verticalAlign: "-2px" }} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Settings</div>
            <div className={styles.formRow}>
              <label className={styles.field}>
                Graphics
                <select className={styles.select} value={settings.quality} onChange={(e) => controller.updateSettings({ quality: e.target.value as typeof settings.quality })} data-testid="setting-quality">
                  <option value="auto">Automatic</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className={styles.field}>
                Motion
                <select className={styles.select} value={settings.reducedMotion ? "reduced" : "full"} onChange={(e) => controller.updateSettings({ reducedMotion: e.target.value === "reduced" })} data-testid="setting-motion">
                  <option value="full">Full</option>
                  <option value="reduced">Reduced</option>
                </select>
              </label>
              <button type="button" className={styles.button} onClick={() => controller.updateSettings({ tutorialDone: false })}>
                Show first steps again
              </button>
            </div>
            <p className={styles.muted} style={{ marginTop: 8 }}>
              Graphics settings change only how the world is drawn. They never change what happens in it.
            </p>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Sound <span>made in your browser from the weather, the hour and what you are looking at</span>
            </div>
            <div className={styles.formRow}>
              <button type="button" className={styles.button} aria-pressed={soundOn} onClick={() => void controller.setSound(!soundOn)} data-testid="setting-sound">
                {soundOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                {soundOn ? "Sound is on" : "Turn sound on"}
              </button>
            </div>
            <div className={styles.sliders}>
              {(
                [
                  ["master", "Overall"],
                  ["ambience", "Weather and wildlife"],
                  ["music", "Music"],
                  ["cues", "Event tones"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={styles.slider}>
                  <span>{label}</span>
                  <input type="range" min={0} max={100} step={5} value={Math.round(settings.levels[key] * 100)} onChange={(e) => controller.setSoundLevels({ [key]: Number(e.target.value) / 100 })} data-testid={`level-${key}`} />
                  <output className="tnum">{Math.round(settings.levels[key] * 100)}</output>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>About this run</div>
            <p className={styles.muted}>
              Engine {ENGINE_VERSION} · affordances {AFFORDANCE_VERSION}
              {world ? ` · world ${world.terrainHash.slice(0, 12)} · config ${world.configHash.slice(0, 12)}` : ""}.{" "}
              {replay
                ? `This is a recording (${replay.provider === "anthropic" ? `language model ${replay.model}` : replay.provider === "mock" ? "MOCK minds, a deterministic test double" : "baseline minds"}): ${replay.decisions} decisions made when it was recorded are replayed here, and nobody is consulted now.`
                : "Every citizen here is driven by a deterministic BASELINE policy, not a language model."}{" "}
              No data leaves this device.{" "}
              <Link href="/diagnostics">System check</Link>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ───────────────────────── Affordance registry

export function AffordancesPanel() {
  const controller = useController();
  const close = () => controller.openPanel("affordances");
  const order = Object.keys(AFFORDANCE_CATEGORIES) as AffordanceCategory[];
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet} ${styles.sheetWide}`} role="dialog" aria-modal="true" aria-labelledby="affordances-title" data-testid="affordances">
        <PanelHead kicker={`Registry ${AFFORDANCE_VERSION}`} title="What was designed" onClose={close} testId="affordances" />
        {/* a long page of text with nothing in it to tab to: the page itself takes focus so the keyboard can scroll it */}
        <div className={styles.panelBody} tabIndex={0} role="region" aria-label="Everything the designers supplied">
          <p className={styles.lede}>Everything the designers supplied. Whatever these citizens come to do, they do inside this space; they did not invent the space.</p>
          {order.map((cat) => {
            const entries = AFFORDANCES.filter((a) => a.category === cat);
            if (!entries.length) return null;
            const meta = AFFORDANCE_CATEGORIES[cat];
            return (
              <div key={cat} className={styles.section}>
                <div className={styles.sectionTitle}>
                  {meta.title} <span>{meta.blurb}</span>
                </div>
                <ul className={styles.rows}>
                  {entries.map((a) => (
                    <li key={a.id} className={styles.row} style={{ gridTemplateColumns: "1fr" }}>
                      <span>
                        <b>{a.name}.</b> {a.what} <span className={styles.muted}>{a.why}</span>
                        {a.status === "planned" ? <span className={styles.muted}> · not yet in the engine</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
