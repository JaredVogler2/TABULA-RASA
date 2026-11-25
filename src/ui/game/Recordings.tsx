"use client";

/**
 * Recorded runs that can be watched: the ones bundled with the application, and the ones the
 * owner has published from this deployment. A recording is replayed here, in the browser,
 * from its configuration and its tape of decisions; nothing is asked of any mind and every
 * epoch is checked against the recorded state digest.
 */
import { Film } from "lucide-react";
import { useEffect, useState } from "react";
import { useGame } from "@/store/game";
import { useController } from "./context";
import styles from "./game.module.css";
import { PanelHead } from "./Panels";

interface Listed {
  id: string;
  title: string;
  provider: string;
  model: string;
  scenario: string;
  seed: number;
  population: number;
  /** Days of island time recorded. */
  days: number;
  where: "bundled" | "published";
}

/** How the minds of a recording are named to a visitor. Never "AI" for a mock. */
export function mindsLabel(provider: string, model: string): string {
  if (provider === "anthropic") return `Language model · ${model}`;
  if (provider === "mock") return "MOCK minds · a deterministic test double, not a language model";
  return "BASELINE minds · the engine's own policies";
}

async function list(): Promise<Listed[]> {
  const out: Listed[] = [];
  try {
    const res = await fetch("/recordings/index.json", { cache: "no-cache" });
    if (res.ok) for (const r of (await res.json()) as Omit<Listed, "where">[]) out.push({ ...r, where: "bundled" });
  } catch {
    // no bundled recordings is not an error
  }
  try {
    const res = await fetch("/api/recordings", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { recordings: { id: string; title: string; provider: string; model: string; scenario: string; seed: number; population: number; epochs: number }[] };
      for (const r of data.recordings) out.push({ id: r.id, title: r.title || "Untitled run", provider: r.provider, model: r.model, scenario: r.scenario, seed: r.seed, population: r.population, days: 0, where: "published" });
    }
  } catch {
    // a deployment without a database simply has none
  }
  return out;
}

export function RecordingsPanel() {
  const controller = useController();
  const [items, setItems] = useState<Listed[] | null>(null);
  const close = () => useGame.getState().set({ panel: "none" });
  useEffect(() => {
    let cancelled = false;
    void list().then((found) => {
      if (!cancelled) setItems(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="recordings-title" data-testid="recordings">
        <PanelHead kicker="Watch, do not touch" title="Recordings" onClose={close} testId="recordings" />
        <div className={styles.panelBody}>
          <p className={styles.lede}>A recording is a world whose minds were consulted from outside the engine, with every decision they made kept. It is replayed here on your device from that record alone, and checked against it as it goes.</p>
          {items === null ? (
            <p className={styles.muted} role="status">
              Looking…
            </p>
          ) : items.length === 0 ? (
            <p className={styles.muted} data-testid="recordings-empty">
              There are none to watch yet.
            </p>
          ) : (
            <ul className={styles.rows} data-testid="recordings-list">
              {items.map((r) => (
                <li key={`${r.where}:${r.id}`} className={styles.row}>
                  <button type="button" className={styles.linkButton} onClick={() => void controller.openRecording(r.id)} data-testid={`recording-${r.id}`}>
                    <Film aria-hidden style={{ width: 14, height: 14, verticalAlign: "-2px", marginRight: 6 }} />
                    {r.title}
                  </button>
                  <span className={styles.rowMeta}>
                    {mindsLabel(r.provider, r.model)} · {r.scenario.replace(/_/g, " ")}, seed {r.seed} · {r.population} people{r.days ? ` · ${r.days} days` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
