"use client";

import { MapPin } from "lucide-react";
import { useGame } from "@/store/game";
import { useController } from "./context";
import styles from "./game.module.css";
import { JOURNAL } from "./journal";
import { PanelHead } from "./Panels";
import { tickLabel } from "./text";

/**
 * The field journal: questions an observer might bring to the island, each answered only by
 * an event the engine logged in this world. Nothing here is asked of the citizens.
 */
export function JournalPanel() {
  const controller = useController();
  const journal = useGame((s) => s.journal);
  const close = () => controller.openPanel("journal");
  const seen = new Map(journal.map((j) => [j.id, j]));
  const entries = JOURNAL.filter((d) => seen.has(d.id)).sort((a, b) => seen.get(a.id)!.tick - seen.get(b.id)!.tick);
  const open = JOURNAL.filter((d) => !seen.has(d.id));
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet}`} role="dialog" aria-modal="true" aria-labelledby="journal-title" data-testid="journal">
        <PanelHead kicker={`Witnessed in this world · ${entries.length} of ${JOURNAL.length}`} title="Field journal" onClose={close} testId="journal" />
        <div className={styles.panelBody}>
          <p className={styles.muted}>
            Each page starts as a question. It is answered only when the engine logs that the thing happened here — nobody on the island is told about any of this, and a question may stay open for good.
          </p>

          {entries.length ? (
            <ol className={styles.journal} data-testid="journal-entries">
              {entries.map((d) => {
                const e = seen.get(d.id)!;
                return (
                  <li key={d.id} className={styles.journalEntry} data-testid={`journal-${d.id}`}>
                    <div className={styles.journalWhen}>{tickLabel(e.tick)}</div>
                    <h3>{d.title}</h3>
                    {e.text ? <p className={styles.journalText}>{e.text}</p> : null}
                    <p className={styles.journalWhy}>{d.why}</p>
                    {e.x !== undefined || e.agents.length ? (
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => {
                          controller.openJournalEntry(e);
                          close();
                        }}
                      >
                        <MapPin aria-hidden /> Show where
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className={styles.empty}>Nothing entered yet. Press play and watch: the first fire, the first gift, the first broken promise will each be written here on the day they happen.</p>
          )}

          {open.length ? (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                Still open <span>not yet seen here</span>
              </div>
              <ul className={styles.questions} data-testid="journal-open">
                {open.map((d) => (
                  <li key={d.id}>{d.question}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
