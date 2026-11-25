"use client";

import { Info, MapPin, X } from "lucide-react";
import { TICKS_PER_DAY } from "@/engine";
import { dyeOf } from "@/render/dyes";
import { useGame } from "@/store/game";
import type { CharterView } from "@/worker/protocol";
import { useController } from "./context";
import { useSwipeDown } from "./swipe";
import styles from "./game.module.css";
import { structureName } from "./text";

/** How a charter came to be put forward — said plainly, because it decides what may be claimed about it. */
const ORIGIN: Record<string, { label: string; note: string; tone: "plain" | "caution" }> = {
  grammar_search: {
    label: "Found by search · BASELINE",
    note: "A citizen drew several charters at random from the rule grammar and proposed the one it rated best for itself. A search over a designed space, not an invention.",
    tone: "plain",
  },
  llm: { label: "Proposed by a language model", note: "Written by a model-driven citizen and accepted by the validator. The model has read about human institutions; this may be recall rather than discovery.", tone: "plain" },
  mock: { label: "MOCK", note: "Proposed by the offline stand-in used to test the model pathway. Not evidence of anything.", tone: "caution" },
  scripted: { label: "Scripted control · not emergence", note: "This charter was written by the designers and put before the population as a positive control. Whoever joined chose to, but its existence shows nothing about emergence.", tone: "caution" },
};

const STATE: Record<CharterView["state"], string> = { proposed: "On offer", active: "In force", lapsed: "Lapsed", ended: "Ended" };

const ENDED: Record<string, string> = {
  too_few_members: "fewer than two members remained",
  dissolved_by_members: "its members voted to dissolve it",
  term_expired: "its term ran out",
};

const MODE: Record<string, string> = {
  off: "In this world agreements are switched off: nobody can propose, sign or trade under one.",
  grammar_search: "In this world any citizen may propose a charter. BASELINE citizens do so only by searching the rule grammar at random and proposing what they rate best for themselves.",
  open: "In this world any citizen may propose a charter.",
  scripted_control: "In this world citizens cannot write charters. One charter written by the designers is put before them as a control; they may sign it or not.",
};

function Charter({ c }: { c: CharterView }) {
  const controller = useController();
  const roster = useGame((s) => s.roster);
  const tick = useGame((s) => s.hud?.tick ?? 0);
  const origin = ORIGIN[c.origin] ?? { label: c.origin, note: "", tone: "plain" as const };
  const name = (id: number) => roster[id]?.name ?? `#${id}`;
  const age = c.ratifiedTick >= 0 ? Math.floor(((c.endedTick >= 0 ? c.endedTick : tick) - c.ratifiedTick) / TICKS_PER_DAY) : 0;
  return (
    <article className={styles.charter} data-state={c.state} data-testid={`charter-${c.id}`}>
      <header className={styles.charterHead}>
        <div>
          <h3>
            {c.state === "active" || c.state === "ended" ? <i className={styles.dye} style={{ color: dyeOf(c.id) }} title="The colour of its pennant in the world" aria-hidden /> : null}
            {c.name}
          </h3>
          {c.purpose ? <p className={styles.charterPurpose}>“{c.purpose}”</p> : null}
        </div>
        <button type="button" className={styles.linkButton} onClick={() => controller.focusTile(c.x, c.y)} aria-label={`Show where ${c.name} sits`}>
          <MapPin aria-hidden /> Show
        </button>
      </header>
      <div className={styles.chips}>
        <span className={styles.chip} data-tone={c.state === "active" ? "good" : "plain"}>
          {STATE[c.state]}
        </span>
        <span className={styles.chip} data-tone={origin.tone} title={origin.note} data-testid={`charter-origin-${c.id}`}>
          {origin.label}
        </span>
        <span className={styles.chip}>
          {c.state === "proposed" ? `${c.signers} of ${c.minFounders} founders signed` : `${c.signers} member${c.signers === 1 ? "" : "s"}`}
        </span>
        {c.state === "active" || c.state === "ended" ? <span className={styles.chip}>{age} day{age === 1 ? "" : "s"}</span> : null}
        {c.uses > 0 ? (
          <span className={styles.chip} title="Deposits, withdrawals, dues met, breaches, motions and votes recorded under its rules">
            used {c.uses}× by {c.usedBy}
          </span>
        ) : null}
      </div>
      {c.state === "ended" ? <p className={styles.muted}>Ended because {ENDED[c.endedWhy] ?? c.endedWhy.replace(/_/g, " ")}.</p> : null}

      <div className={styles.sectionTitle}>
        What it does <span>exactly what the engine enforces — generated from the rules, not from the name</span>
      </div>
      {c.rules.length ? (
        <ol className={styles.ruleList}>
          {c.rules.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No rules: it is a membership and a way of deciding, nothing more.</p>
      )}
      <ul className={styles.termList}>
        {c.terms.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
        {c.stores.length ? <li>Controls {c.stores.map((s) => `${structureName(s.kind).toLowerCase()} #${s.id}`).join(", ")}. What was inside before stays open to everyone.</li> : null}
      </ul>

      <div className={styles.sectionTitle}>
        {c.state === "proposed" ? "Signed so far" : "Members"} <span>each joined by their own recorded act</span>
      </div>
      <div className={styles.chips}>
        {c.members.map((m) => (
          <button key={m.id} type="button" className={styles.chip} data-tone={m.suspended ? "caution" : "plain"} onClick={() => controller.selectAgent(m.id)} title={m.suspended ? "Suspended from the common stock" : undefined}>
            {name(m.id)}
            {m.roles.length ? ` · ${m.roles.join(", ")}` : ""}
            {m.breaches ? ` · ${m.breaches} breach${m.breaches === 1 ? "" : "es"}` : ""}
          </button>
        ))}
        {c.members.length === 0 ? <span className={styles.muted}>Nobody.</span> : null}
      </div>
      {origin.note ? (
        <div className={styles.note} data-tone={origin.tone === "caution" ? "caution" : undefined} style={{ marginTop: 12 }}>
          <Info aria-hidden />
          <span>{origin.note}</span>
        </div>
      ) : null}
    </article>
  );
}

export function CivicsPanel() {
  const controller = useController();
  const view = useGame((s) => s.civics);
  const roster = useGame((s) => s.roster);
  const close = () => controller.openPanel("civics");
  const swipe = useSwipeDown(close);
  const live = view?.charters.filter((c) => c.state === "active" || c.state === "proposed") ?? [];
  const past = view?.charters.filter((c) => c.state === "lapsed" || c.state === "ended") ?? [];
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet} ${styles.sheetWide}`} role="dialog" aria-modal="true" aria-labelledby="civics-title" data-testid="civics">
        <div className={styles.panelHead} {...swipe}>
          <div className={styles.panelTitle}>
            <div className={styles.kicker}>Agreements among citizens</div>
            <h2 id="civics-title">Charters</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={close} aria-label="Close charters" data-testid="civics-close">
            <X aria-hidden />
          </button>
        </div>
        <div className={styles.panelBody}>
          <p className={styles.lede} data-testid="civics-mode">
            {MODE[view?.mode ?? "off"] ?? ""} A charter binds only those who sign it, can ration only what its members put in, and can punish only by keeping a member&apos;s own bond, suspending them or putting them out. Anyone may leave.
          </p>
          {view && live.length === 0 && past.length === 0 ? (
            <div className={styles.empty} data-testid="civics-empty">
              Nobody has proposed an agreement yet. Nothing tells them to.
            </div>
          ) : null}
          {live.map((c) => (
            <Charter key={c.id} c={c} />
          ))}
          {view && view.motions.length ? (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Open motions</div>
              <ul className={styles.termList}>
                {view.motions.map((m) => (
                  <li key={m.id}>
                    {roster[m.by]?.name ?? "Someone"} moved to {m.what} — {m.yes} for, {m.no} against so far.
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {view ? (
            <p className={styles.muted} style={{ marginTop: 14 }}>
              Two-way exchanges carried out under a pact: <b className="tnum">{view.exchanges}</b>
              {view.openOffers ? ` · ${view.openOffers} offer${view.openOffers === 1 ? "" : "s"} open` : ""}.
            </p>
          ) : null}
          {past.length ? (
            <details className={styles.section}>
              <summary className={styles.sectionTitle} style={{ cursor: "pointer" }}>
                Lapsed and ended ({past.length})
              </summary>
              {past.map((c) => (
                <Charter key={c.id} c={c} />
              ))}
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}
