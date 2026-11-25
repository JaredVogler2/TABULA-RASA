"use client";

import { Bed, Drumstick, Droplet, Flame, HeartPulse, LocateFixed, X } from "lucide-react";
import { BIOMES, ITEMS, NODE_KINDS, PHYS, SKILLS, TRAITS, needBand } from "@/engine";
import { NODE_LABEL } from "@/worker/describe";
import { useGame } from "@/store/game";
import type { AgentDetail, TileDetail } from "@/worker/protocol";
import { useController } from "./context";
import styles from "./game.module.css";
import { MEMORY_TEXT, goalSentence, itemName, structureName, tickLabel } from "./text";

const BAND_WORD = ["", "uneasy", "suffering", "critical"];

function Need({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  const band = needBand(value);
  return (
    <div className={styles.need}>
      {icon}
      <span>
        {label} {band > 0 ? <span className={styles.bandLabel}>· {BAND_WORD[band]}</span> : null}
      </span>
      <div className={styles.meter} data-band={band} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value / 10)}>
        <i style={{ width: `${Math.max(2, value / 10)}%` }} />
      </div>
      <span className={styles.needValue}>{Math.round(value / 10)}</span>
    </div>
  );
}

function ago(now: number, then: number): string {
  const d = Math.max(0, now - then);
  if (d < 4) return "just now";
  if (d < 96) return `${Math.round(d / 4)} h ago`;
  return `${(d / 96).toFixed(1)} d ago`;
}

/**
 * Who decided what this citizen is doing, said exactly. A mock is never called a model, a
 * replayed decision is said to be recorded, and reflex behaviour under an outside mind is
 * said to be reflex.
 */
export function mindSentence(controller: string, source: string, recorded: boolean): string {
  if (controller !== "external") return "Decided by the built-in BASELINE policy (not a language model).";
  const when = recorded ? "Recorded decision" : "Decided";
  if (source === "live") return `${when} by a language model; validated by the engine.`;
  if (source === "mock") return `${when} by a MOCK mind (a deterministic test double, not a language model); validated by the engine.`;
  if (source === "replay") return "Recorded decision of an outside mind, replayed; validated by the engine.";
  return "Acting on reflex until its mind is next consulted (labelled FALLBACK; not a language model).";
}

function AgentCard({ detail, now }: { detail: AgentDetail; now: number }) {
  const controller = useController();
  const following = useGame((s) => s.following);
  const roster = useGame((s) => s.roster);
  const recorded = useGame((s) => !!s.hud?.replay);
  const name = (id: number) => roster[id]?.name ?? "someone";
  const carried = detail.inv.map((q, i) => ({ q, i })).filter((x) => x.q > 0);
  return (
    <>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>
          <div className={styles.kicker}>{detail.alive ? "Citizen" : "Died"}</div>
          <h2 data-testid="inspector-name">{detail.name}</h2>
        </div>
        <button type="button" className={styles.closeButton} onClick={() => controller.select(null)} aria-label="Close inspector" data-testid="inspector-close">
          <X aria-hidden />
        </button>
      </div>
      <div className={styles.panelBody} data-testid="inspector-body">
        {detail.alive ? (
          <p className={styles.lede} data-testid="inspector-goal">
            {goalSentence(detail.goal, detail.why)}
          </p>
        ) : (
          <p className={styles.lede}>
            {detail.name} died of {detail.deathCause} on {tickLabel(detail.diedTick).toLowerCase()}. A cairn marks the place.
          </p>
        )}
        <p className={styles.muted} style={{ marginTop: 6 }}>
          <span data-testid="inspector-mind">{mindSentence(detail.controller, detail.source, recorded)}</span>
          {detail.ill > 0 ? " Currently ill." : ""}
        </p>
        {detail.controller === "external" && detail.note ? (
          <p className={styles.muted} style={{ marginTop: 6 }} data-testid="inspector-note">
            Its note to itself: “{detail.note}”
          </p>
        ) : null}

        {detail.alive ? (
          <div className={styles.actions}>
            <button type="button" className={styles.button} aria-pressed={following} onClick={() => controller.follow(!following)} data-testid="follow">
              <LocateFixed aria-hidden />
              {following ? "Following" : "Follow"}
            </button>
          </div>
        ) : null}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Needs</div>
          <div className={styles.needs}>
            <Need icon={<Drumstick aria-hidden />} label="Energy" value={detail.energy} />
            <Need icon={<Droplet aria-hidden />} label="Water" value={detail.hydration} />
            <Need icon={<Bed aria-hidden />} label="Rest" value={detail.rest} />
            <Need icon={<Flame aria-hidden />} label="Warmth" value={detail.warmth} />
            <Need icon={<HeartPulse aria-hidden />} label="Health" value={detail.health} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Carrying{" "}
            <span>
              {detail.load} / {detail.capacity} weight
            </span>
          </div>
          {carried.length ? (
            <div className={styles.chips}>
              {carried.map(({ q, i }) => (
                <span key={i} className={styles.chip}>
                  <b>{q}</b> {itemName(i, q)}
                </span>
              ))}
            </div>
          ) : (
            <p className={styles.muted}>Nothing.</p>
          )}
        </div>

        {detail.queue.length ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Plan <span>validated step by step</span>
            </div>
            <ol className={styles.rows}>
              {detail.queue.map((q, i) => (
                <li key={i} className={styles.row}>
                  <span>{q.text}</span>
                  <span className={styles.rowMeta}>{i === 0 ? "now" : `then`}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            What {detail.name} believes <span>vs. what is true</span>
          </div>
          <p className={styles.muted} style={{ marginBottom: 6 }}>
            Has seen {detail.seenTiles.toLocaleString()} tiles and knows of {detail.knownNodes} resources; {detail.staleBeliefs} of those beliefs are out of date. Only you can see the truth.
          </p>
          {detail.beliefs.length ? (
            <ul className={styles.rows} data-testid="beliefs">
              {detail.beliefs.slice(0, 7).map((b) => (
                <li key={b.node} className={styles.row}>
                  <button type="button" className={styles.linkButton} onClick={() => controller.focusTile(b.x, b.y)}>
                    {NODE_LABEL[NODE_KINDS[b.kind] ?? ""] ?? "resource"}
                  </button>
                  <span className={styles.rowMeta}>
                    thinks {b.believed}
                    {b.believed !== b.actual ? <span className={styles.stale}> · is {b.actual}</span> : " · correct"} · {b.src >= 0 ? `told by ${name(b.src)}` : `seen ${ago(now, b.tick)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Knows of no resources yet.</p>
          )}
        </div>

        {detail.people.length ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              People known <span>trust · given · received</span>
            </div>
            <ul className={styles.rows}>
              {detail.people.map((p) => (
                <li key={p.id} className={styles.row}>
                  <button type="button" className={styles.linkButton} onClick={() => controller.selectAgent(p.id)}>
                    {name(p.id)}
                  </button>
                  <span className={styles.rowMeta}>
                    trust {Math.round(p.trust / 10)} · {p.gave} · {p.got}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {detail.memory.length ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Remembers <span>most recent first</span>
            </div>
            <ul className={styles.rows}>
              {detail.memory.slice(0, 8).map((m, i) => (
                <li key={i} className={styles.row}>
                  <span>
                    {MEMORY_TEXT[m.kind] ?? m.kind}
                    {m.item >= 0 && m.qty > 0 ? ` ${m.qty} ${itemName(m.item, m.qty)}` : ""}
                    {m.who >= 0 ? ` — ${name(m.who)}` : ""}
                    {m.src >= 0 ? ` (told by ${name(m.src)})` : ""}
                  </span>
                  <span className={styles.rowMeta}>{ago(now, m.tick)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Temperament <span>fixed at birth</span>
          </div>
          <div className={styles.traitGrid}>
            {TRAITS.map((t, i) => (
              <div key={t} className={styles.trait}>
                <span>{t}</span>
                <div className={styles.traitBar} role="img" aria-label={`${t} ${detail.traits[i]} of 100`}>
                  <i style={{ width: `${detail.traits[i]}%` }} />
                </div>
              </div>
            ))}
            {PHYS.map((t, i) => (
              <div key={t} className={styles.trait}>
                <span>{t}</span>
                <div className={styles.traitBar} role="img" aria-label={`${t} ${detail.phys[i]} of 100`}>
                  <i style={{ width: `${detail.phys[i]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            Skills <span>learned by doing</span>
          </div>
          <div className={styles.traitGrid}>
            {SKILLS.map((t, i) => (
              <div key={t} className={styles.trait}>
                <span>{t}</span>
                <div className={styles.traitBar} role="img" aria-label={`${t} ${Math.round((detail.skills[i] ?? 0) / 10)} of 100`}>
                  <i style={{ width: `${(detail.skills[i] ?? 0) / 10}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className={styles.muted} style={{ marginTop: 14 }}>
          {detail.stats.decisions} decisions · {detail.stats.rejected} intents rejected by the engine · walked {detail.stats.distance} tiles · gave {detail.stats.givenUnits}, received {detail.stats.receivedUnits}
        </p>
      </div>
    </>
  );
}

function TileCard({ detail }: { detail: TileDetail }) {
  const controller = useController();
  const roster = useGame((s) => s.roster);
  const biome = BIOMES[detail.biome] ?? "land";
  const node = detail.node;
  const title = detail.structure ? structureName(detail.structure.kind) : node ? (NODE_LABEL[NODE_KINDS[node.kind] ?? ""] ?? "resource") : detail.water === 1 ? "sea" : detail.water === 2 ? "stream" : detail.water === 3 ? "pond" : biome;
  const s = detail.structure;
  return (
    <>
      <div className={styles.panelHead}>
        <div className={styles.panelTitle}>
          <div className={styles.kicker}>
            Place · {detail.x}, {detail.y}
          </div>
          <h2 data-testid="inspector-name" style={{ textTransform: "capitalize" }}>
            {title}
          </h2>
        </div>
        <button type="button" className={styles.closeButton} onClick={() => controller.select(null)} aria-label="Close inspector" data-testid="inspector-close">
          <X aria-hidden />
        </button>
      </div>
      <div className={styles.panelBody} data-testid="inspector-body">
        {node ? (
          <>
            <p className={styles.lede}>
              {node.amount === 0 ? "Stripped bare." : `${node.amount} of ${node.cap} ${itemName(["berry", "root", "wood", "fiber", "stone", "clay", "fish"].map((n) => ITEMS.indexOf(n as (typeof ITEMS)[number]))[node.kind], node.amount)} here.`}
            </p>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Stock</div>
              <div className={styles.meter} data-band={node.amount === 0 ? 3 : node.amount < node.cap * 0.2 ? 2 : 0} role="meter" aria-valuemin={0} aria-valuemax={node.cap} aria-valuenow={node.amount} aria-label="Stock">
                <i style={{ width: `${Math.max(2, (100 * node.amount) / node.cap)}%` }} />
              </div>
              <p className={styles.muted} style={{ marginTop: 8 }}>
                {[4, 5].includes(node.kind) ? "A finite deposit: it never regrows." : "Renewable: it regrows toward its capacity, and very slowly once nearly emptied."}
              </p>
            </div>
          </>
        ) : null}
        {s ? (
          <>
            <p className={styles.lede}>
              {s.complete ? (s.kind === 0 ? (s.fuel > 0 ? `Burning — about ${Math.round(s.fuel / 4)} hours of fuel left.` : "Cold. It needs wood.") : s.kind === 3 ? (s.ripe >= 1000 ? "Ripe: anyone here can harvest it." : `Growing — ${Math.round(s.ripe / 10)}% of the way to harvest.`) : "Complete.") : `Under construction — ${Math.round(s.progress / 10)}%.`}
            </p>
            <p className={styles.muted} style={{ marginTop: 6 }}>
              Begun by {roster[s.founder]?.name ?? "someone"}. {s.bound >= 0 ? "Access is governed by an institution." : "Open to anyone: nothing in the world records who owns it."}
              {s.kind === 1 ? ` ${s.occupants} sleeping inside.` : ""}
            </p>
          </>
        ) : null}
        {!node && !s ? <p className={styles.lede}>{detail.water === 1 ? "Open sea. No one can cross it." : detail.fresh > 0 ? "Fresh water can be drunk here." : `Open ${biome}.`}</p> : null}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Ground</div>
          <ul className={styles.rows}>
            <li className={styles.row}>
              <span>Habitat</span>
              <span className={styles.rowMeta}>{biome}</span>
            </li>
            <li className={styles.row}>
              <span>Fertility</span>
              <span className={styles.rowMeta}>{detail.fertility} / 100</span>
            </li>
            <li className={styles.row}>
              <span>Time to cross</span>
              <span className={styles.rowMeta}>{detail.moveCost === 0 ? "impassable" : `${detail.moveCost} ticks`}</span>
            </li>
            <li className={styles.row}>
              <span>Foot traffic</span>
              <span className={styles.rowMeta}>{detail.traffic === 0 ? "untrodden" : detail.traffic >= 24 ? `${detail.traffic} — a worn path` : detail.traffic}</span>
            </li>
            <li className={styles.row}>
              <span>Fresh water</span>
              <span className={styles.rowMeta}>{detail.fresh === 2 ? "year-round" : detail.fresh === 1 ? "dries in drought" : "none"}</span>
            </li>
          </ul>
        </div>

        {detail.pile ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              On the ground <span>free for anyone to take</span>
            </div>
            <div className={styles.chips}>
              {detail.pile
                .map((q, i) => ({ q, i }))
                .filter((x) => x.q > 0)
                .map(({ q, i }) => (
                  <span key={i} className={styles.chip}>
                    <b>{q}</b> {itemName(i, q)}
                  </span>
                ))}
            </div>
          </div>
        ) : null}

        {detail.agents.length ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Here now</div>
            <div className={styles.chips}>
              {detail.agents.map((id) => (
                <button key={id} type="button" className={styles.linkButton} onClick={() => controller.selectAgent(id, false)}>
                  {roster[id]?.name ?? "someone"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function Inspector() {
  const selection = useGame((s) => s.selection);
  const agent = useGame((s) => s.agentDetail);
  const tile = useGame((s) => s.tileDetail);
  const now = useGame((s) => s.hud?.tick ?? 0);
  if (!selection) return null;
  if (selection.type === "agent" && agent && agent.id === selection.id) {
    return (
      <aside className={`${styles.paper} ${styles.side} ${styles.sideRight}`} aria-label={`Inspector: ${agent.name}`} data-testid="inspector">
        <AgentCard detail={agent} now={now} />
      </aside>
    );
  }
  if (selection.type !== "agent" && tile && tile.x === selection.x && tile.y === selection.y) {
    return (
      <aside className={`${styles.paper} ${styles.side} ${styles.sideRight}`} aria-label="Inspector: place" data-testid="inspector">
        <TileCard detail={tile} />
      </aside>
    );
  }
  return null;
}
