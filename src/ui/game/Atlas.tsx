"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { dyeOf } from "@/render/dyes";
import { landHeightToWorld } from "@/render/heightfield";
import { BIOME_COLORS, wearOf } from "@/render/palette";
import { useGame } from "@/store/game";
import { AF, AGENT_STRIDE, type AimView, type DaySample, type StaticWorldView } from "@/worker/protocol";
import { useController } from "./context";
import styles from "./game.module.css";
import { PanelHead } from "./Panels";

/**
 * The atlas: the whole island on one sheet — relief, water, where people are, what they
 * have built, where their feet have worn the ground, where an agreement was ratified — and
 * an almanac of how the world has gone day by day. Everything drawn is read from the latest
 * frame of the simulation; clicking the map only moves the camera.
 */

const SCALE = 8;
/** "Your timeline" keeps the colour it has in the comparison charts (validated there against this surface). */
const LINE = "#bf6a1d";
const INK = "#2a2318";
const INK_MUTED = "#6b5f4a";
const GRID = "rgba(74, 58, 36, 0.16)";

/** One pixel per tile: biome colour under a north-west light, with water and snow. */
function reliefImage(world: StaticWorldView): ImageData {
  const { w, h } = world;
  const img = new ImageData(w, h);
  const elev = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(w - 1, x));
    const cy = Math.max(0, Math.min(h - 1, y));
    const hv = world.height[cy * w + cx] as number;
    return hv <= 0 ? 0 : landHeightToWorld(hv);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const water = world.water[i] as number;
      let r: number;
      let g: number;
      let b: number;
      if (water === 1) {
        const depth = Math.min(1, Math.max(0, -(world.height[i] as number) / 900));
        r = 86 - 44 * depth;
        g = 168 - 62 * depth;
        b = 178 - 52 * depth;
      } else if (water !== 0) {
        r = 96;
        g = 178;
        b = 186;
      } else {
        const c = BIOME_COLORS[world.biome[i] as number] ?? BIOME_COLORS[0]!;
        const e = elev(x, y);
        // light from the north-west: slopes facing it are brighter
        const shade = Math.max(0.62, Math.min(1.28, 1 + (elev(x + 1, y + 1) - elev(x - 1, y - 1)) * 0.11));
        const snow = Math.max(0, Math.min(1, (e - 8.4) / 1.6));
        // the palette is linear light; a gamma of about 2.2 brings it to what a canvas expects
        r = Math.pow(c.r, 1 / 2.2) * 255 * shade;
        g = Math.pow(c.g, 1 / 2.2) * 255 * shade;
        b = Math.pow(c.b, 1 / 2.2) * 255 * shade;
        r += (238 - r) * snow;
        g += (242 - g) * snow;
        b += (244 - b) * snow;
      }
      // a little of the paper shows through everything, as on a printed map
      img.data[i * 4] = Math.min(255, r * 0.9 + 24);
      img.data[i * 4 + 1] = Math.min(255, g * 0.9 + 22);
      img.data[i * 4 + 2] = Math.min(255, b * 0.9 + 16);
      img.data[i * 4 + 3] = 255;
    }
  }
  return img;
}

function AtlasMap() {
  const controller = useController();
  const world = useGame((s) => s.world);
  const selection = useGame((s) => s.selection);
  const seen = useGame((s) => (s.overlay.knowledge && s.selection?.type === "agent" && s.agentDetail?.id === s.selection.id ? s.agentDetail.seen : null));
  const roster = useGame((s) => s.roster);
  const ref = useRef<HTMLCanvasElement>(null);
  const [summary, setSummary] = useState("");
  const base = useMemo(() => {
    if (!world || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = world.w;
    c.height = world.h;
    c.getContext("2d")?.putImageData(reliefImage(world), 0, 0);
    return c;
  }, [world]);
  const selected = selection?.type === "agent" ? selection.id : -1;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !world || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = world;
    const draw = (): void => {
      const data = controller.mapData();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(base, 0, 0, w * SCALE, h * SCALE);
      if (!data) return;
      // where feet have worn the ground
      if (data.traffic) {
        for (let t = 0; t < w * h; t++) {
          const wear = wearOf(data.traffic[t] as number);
          if (wear < 0.2 || world.water[t] !== 0) continue;
          ctx.fillStyle = `rgba(246, 232, 196, ${Math.min(0.85, wear * 0.9).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(((t % w) + 0.5) * SCALE, (Math.floor(t / w) + 0.5) * SCALE, SCALE * 0.34, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // the selected citizen's unknown country, when that view is on
      if (seen) {
        ctx.fillStyle = "rgba(238, 228, 204, 0.72)";
        for (let t = 0; t < w * h; t++) if (!(((seen[t >> 3] as number) >> (t & 7)) & 1)) ctx.fillRect((t % w) * SCALE, Math.floor(t / w) * SCALE, SCALE, SCALE);
      }
      const built = [0, 0, 0, 0];
      let lit = 0;
      for (const s of data.structures) {
        const x = (s.x + 0.5) * SCALE;
        const y = (s.y + 0.5) * SCALE;
        built[s.kind] = (built[s.kind] ?? 0) + 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(43, 33, 23, 0.85)";
        if (s.kind === 0) {
          if (s.complete && s.fuel > 0) lit++;
          ctx.fillStyle = s.complete && s.fuel > 0 ? "#f08a2b" : "#8a8478";
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (s.kind === 1) {
          ctx.fillStyle = s.complete ? "#c9ae6c" : "rgba(201, 174, 108, 0.5)";
          ctx.beginPath();
          ctx.moveTo(x, y - 4.5);
          ctx.lineTo(x + 4.5, y + 3.5);
          ctx.lineTo(x - 4.5, y + 3.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (s.kind === 2) {
          ctx.fillStyle = s.complete ? "#8a5a36" : "rgba(138, 90, 54, 0.5)";
          ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
          ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        } else {
          ctx.strokeStyle = "#3f6a2e";
          ctx.lineWidth = 1.4;
          for (const dy of [-2.5, 0, 2.5]) {
            ctx.beginPath();
            ctx.moveTo(x - 3.5, y + dy);
            ctx.lineTo(x + 3.5, y + dy);
            ctx.stroke();
          }
        }
      }
      // a pennant where an agreement was ratified, in the colour it flies in the world
      let inForce = 0;
      for (const m of data.marks) {
        if (m.ended) continue;
        inForce++;
        const x = (m.x + 0.5) * SCALE;
        const y = (m.y + 0.5) * SCALE;
        ctx.strokeStyle = "#2b2117";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x, y - 8);
        ctx.stroke();
        ctx.fillStyle = dyeOf(m.id);
        ctx.beginPath();
        ctx.moveTo(x, y - 8);
        ctx.lineTo(x + 9, y - 5);
        ctx.lineTo(x, y - 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      let living = 0;
      for (let i = 0; i < data.count; i++) {
        const o = i * AGENT_STRIDE;
        if ((data.agents[o + AF.alive] as number) < 0.5) continue;
        living++;
        const x = ((data.agents[o + AF.x] as number) + 0.5) * SCALE;
        const y = ((data.agents[o + AF.y] as number) + 0.5) * SCALE;
        ctx.beginPath();
        ctx.arc(x, y, i === selected ? 4.2 : 2.6, 0, Math.PI * 2);
        ctx.fillStyle = i === selected ? "#f6c57e" : "#2b2117";
        ctx.fill();
        ctx.lineWidth = i === selected ? 2 : 1;
        ctx.strokeStyle = i === selected ? "#2b2117" : "rgba(251, 246, 234, 0.9)";
        ctx.stroke();
      }
      const text = `${living} living ${living === 1 ? "person" : "people"}; ${built[0] ?? 0} hearths (${lit} lit), ${built[1] ?? 0} shelters, ${built[2] ?? 0} stores, ${built[3] ?? 0} plots; ${inForce} ${inForce === 1 ? "agreement" : "agreements"} in force.`;
      setSummary((prev) => (prev === text ? prev : text));
    };
    draw();
    const timer = window.setInterval(draw, 500);
    return () => window.clearInterval(timer);
  }, [controller, world, base, selected, seen]);

  if (!world) return null;
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tx = Math.floor(((e.clientX - rect.left) / rect.width) * world.w);
    const ty = Math.floor(((e.clientY - rect.top) / rect.height) * world.h);
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return;
    // someone standing on or beside the place clicked is who was meant
    const data = controller.mapData();
    let who = -1;
    let best = 2.5;
    for (let i = 0; data && i < data.count; i++) {
      const o = i * AGENT_STRIDE;
      if ((data.agents[o + AF.alive] as number) < 0.5) continue;
      const d = Math.hypot((data.agents[o + AF.x] as number) - tx, (data.agents[o + AF.y] as number) - ty);
      if (d < best) {
        best = d;
        who = i;
      }
    }
    if (who >= 0) controller.selectAgent(who);
    else controller.focusTile(tx, ty);
    controller.openPanel("atlas");
  };
  return (
    <figure className={styles.atlasMap}>
      <canvas
        ref={ref}
        width={world.w * SCALE}
        height={world.h * SCALE}
        onClick={onClick}
        role="img"
        aria-label={`Map of the island. ${summary}`}
        data-testid="atlas-map"
      />
      <figcaption>
        <p data-testid="atlas-summary">{summary}</p>
        <ul className={styles.legend} aria-label="Map key">
          <li>
            <i data-glyph="person" /> person
          </li>
          <li>
            <i data-glyph="fire" /> hearth, lit
          </li>
          <li>
            <i data-glyph="shelter" /> shelter
          </li>
          <li>
            <i data-glyph="store" /> store
          </li>
          <li>
            <i data-glyph="plot" /> plot
          </li>
          <li>
            <i data-glyph="path" /> worn ground
          </li>
          <li>
            <i data-glyph="pennant" /> agreement in force
          </li>
        </ul>
        <p className={styles.muted}>
          Click the map to look there; click a person to select them.
          {seen && selected >= 0 ? ` Pale country is land ${roster[selected]?.name ?? "the selected citizen"} has never seen.` : ""}
        </p>
      </figcaption>
    </figure>
  );
}

interface Trend {
  id: string;
  title: string;
  note: string;
  pick: (d: DaySample) => number;
  format: (v: number) => string;
  max?: number;
}

const TRENDS: Trend[] = [
  { id: "alive", title: "Living", note: "people", pick: (d) => d.alive, format: (v) => v.toFixed(0) },
  { id: "welfare", title: "Welfare", note: "mean of everyone's needs, %", pick: (d) => d.welfare / 10, format: (v) => `${v.toFixed(0)}%`, max: 100 },
  { id: "food", title: "Food in hand and store", note: "units", pick: (d) => d.food, format: (v) => v.toFixed(0) },
  { id: "wild", title: "Wild food standing", note: "units in bushes, roots and waters", pick: (d) => d.wild, format: (v) => v.toFixed(0) },
  { id: "commons", title: "Commons health", note: "renewable stock against capacity, %", pick: (d) => d.commons / 10, format: (v) => `${v.toFixed(0)}%`, max: 100 },
  { id: "gini", title: "Inequality of holdings", note: "Gini, 0 equal · 1 one holds all", pick: (d) => d.gini / 1000, format: (v) => v.toFixed(2), max: 1 },
  { id: "structures", title: "Things built", note: "standing structures", pick: (d) => d.structures, format: (v) => v.toFixed(0) },
];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function TrendChart({ trend, series }: { trend: Trend; series: DaySample[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 240;
  const H = 96;
  const m = { l: 8, r: 8, t: 8, b: 18 };
  const values = series.map(trend.pick);
  const d0 = series[0]?.day ?? 0;
  const d1 = Math.max(d0 + 1, series[series.length - 1]?.day ?? 1);
  const yMax = trend.max ?? niceMax(Math.max(1, ...values));
  const x = (day: number) => m.l + ((day - d0) / (d1 - d0)) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (Math.max(0, Math.min(yMax, v)) / yMax) * (H - m.t - m.b);
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(values[i] as number).toFixed(1)}`).join("");
  const last = values[values.length - 1] ?? 0;
  const shown = hover !== null && series[hover] ? hover : series.length - 1;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const day = d0 + (((e.clientX - rect.left) / rect.width) * W - m.l) / ((W - m.l - m.r) / (d1 - d0));
    let best = 0;
    for (let i = 1; i < series.length; i++) if (Math.abs((series[i] as DaySample).day - day) < Math.abs((series[best] as DaySample).day - day)) best = i;
    setHover(best);
  };
  return (
    <figure className={styles.trend} data-testid={`trend-${trend.id}`}>
      <figcaption>
        <span id={titleId} className={styles.trendTitle}>
          {trend.title}
        </span>
        <span className={styles.trendValue}>
          <b className="tnum">{trend.format(series[shown] ? (values[shown] as number) : last)}</b>
          <span className="tnum">{hover !== null && series[hover] ? `day ${(series[hover] as DaySample).day + 1}` : "now"}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} aria-describedby={`${titleId}-d`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <desc id={`${titleId}-d`}>{`${trend.title} by day, from day ${d0 + 1} to day ${d1 + 1}: now ${trend.format(last)}, lowest ${trend.format(lo)}, highest ${trend.format(hi)}.`}</desc>
        <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke={GRID} />
        <line x1={m.l} x2={W - m.r} y1={y(yMax)} y2={y(yMax)} stroke={GRID} strokeDasharray="2 3" />
        {series.length > 1 ? <path d={path} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {series[shown] ? (
          <>
            {hover !== null ? <line x1={x((series[shown] as DaySample).day)} x2={x((series[shown] as DaySample).day)} y1={m.t} y2={H - m.b} stroke={INK_MUTED} strokeWidth={1} /> : null}
            <circle cx={x((series[shown] as DaySample).day)} cy={y(values[shown] as number)} r={4} fill={LINE} stroke="#f8f1e3" strokeWidth={2} />
          </>
        ) : null}
        <text x={m.l} y={H - 4} fontSize={10} fill={INK_MUTED}>
          day {d0 + 1}
        </text>
        <text x={W - m.r} y={H - 4} fontSize={10} fill={INK_MUTED} textAnchor="end">
          day {d1 + 1}
        </text>
        <text x={W - m.r} y={y(yMax) + 10} fontSize={10} fill={INK_MUTED} textAnchor="end">
          {trend.format(yMax)}
        </text>
      </svg>
      <p className={styles.trendNote} style={{ color: INK }}>
        {trend.note}
      </p>
    </figure>
  );
}

const AIM_STATE: Record<AimView["state"], (aim: AimView) => string> = {
  open: () => "Open",
  met: (aim) => `Met on day ${aim.decidedDay ?? "?"}`,
  lost: (aim) => `Lost on day ${aim.decidedDay ?? "?"}`,
  reading: () => "A reading, not a verdict",
};

function AimReading({ aim, testId }: { aim: AimView; testId: string }) {
  return (
    <div data-testid={testId} data-state={aim.state}>
      <div className={styles.chips}>
        <span className={styles.chip} data-tone={aim.state === "met" ? "good" : aim.state === "lost" ? "caution" : undefined} data-testid={`${testId}-state`}>
          {AIM_STATE[aim.state](aim)}
        </span>
        <span className={styles.chip}>{aim.figure}</span>
      </div>
      {aim.lines.map((line) => (
        <p key={line} className={styles.aimLine}>
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The aim on this world's card, and how it stands: counted from the engine's state each morning
 * (src/worker/aims.ts), here and in the untouched twin. Nothing is scored and no citizen is told.
 */
function Aim() {
  const aim = useGame((s) => s.aim);
  if (!aim?.yours) return null;
  return (
    <div className={styles.aim} data-testid="aim">
      <div className={styles.sectionTitle} style={{ marginTop: 0 }}>
        The aim on this world&apos;s card <span>counted, not scored</span>
      </div>
      <p className={styles.aimText} data-testid="aim-text">
        {aim.yours.text}
      </p>
      <AimReading aim={aim.yours} testId="aim-yours" />
      {aim.twin ? (
        <>
          <div className={styles.aimTwin}>In the untouched twin</div>
          <AimReading aim={aim.twin} testId="aim-twin" />
        </>
      ) : (
        <p className={styles.aimLine} data-testid="aim-no-twin">
          Nobody has touched this world, and no citizen is told of this aim. If you change something, the untouched twin is counted here beside it.
        </p>
      )}
    </div>
  );
}

function Almanac() {
  const series = useGame((s) => s.series);
  const [table, setTable] = useState(false);
  if (series.length === 0) return <p className={styles.empty}>The almanac begins with the first full day.</p>;
  const rows = series.slice(-14);
  return (
    <div>
      <div className={styles.trends}>
        {TRENDS.map((t) => (
          <TrendChart key={t.id} trend={t} series={series} />
        ))}
      </div>
      <button type="button" className={styles.linkButton} aria-expanded={table} onClick={() => setTable((v) => !v)} data-testid="almanac-table-toggle">
        {table ? "Hide the numbers" : "Show the numbers"}
      </button>
      {table ? (
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="The almanac as a table, one row a day">
          <table className={styles.table} data-testid="almanac-table">
            <caption className="sr-only">The last {rows.length} days of the almanac</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {TRENDS.map((t) => (
                  <th key={t.id} scope="col">
                    {t.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{d.day + 1}</th>
                  {TRENDS.map((t) => (
                    <td key={t.id} className="tnum">
                      {t.format(t.pick(d))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function AtlasPanel() {
  const controller = useController();
  const close = () => controller.openPanel("atlas");
  return (
    <div className={styles.scrim} onClick={(e) => e.target === e.currentTarget && close()}>
      <section className={`${styles.paper} ${styles.sheet} ${styles.sheetWide}`} role="dialog" aria-modal="true" aria-labelledby="atlas-title" data-testid="atlas">
        <PanelHead kicker="The island as it stands" title="Atlas" onClose={close} testId="atlas" />
        <div className={styles.panelBody}>
          <div className={styles.atlas}>
            <AtlasMap />
            <div>
              <Aim />
              <div className={styles.sectionTitle}>
                Almanac <span>one line per measure, a point per day · your timeline</span>
              </div>
              <Almanac />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
