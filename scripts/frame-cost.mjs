/**
 * What a frame costs, measured so that two builds can be compared on a busy machine.
 *
 *   node scripts/frame-cost.mjs [--url http://127.0.0.1:3210] [--cases vista,close,mid] [--presets high,medium,low]
 *                               [--frames 8] [--size 960x540] [--repeat 1] [--budget] [--out file.jsonl]
 *
 * It opens the /studio view of a running server, lets the picture settle, and then counts,
 * over a fixed number of drawn frames:
 *
 *   - draw calls and triangles submitted per frame (every pass: shadows, scene, post), as the
 *     renderer itself reports them. These are exact and the same on every run;
 *   - the processor time the browser spent on those frames (every process of the browser, from
 *     /proc), and the wall-clock time they took.
 *
 * Here Chromium draws through SwiftShader, a software renderer: every pixel and every vertex is
 * paid for on the processor. Processor time per frame is therefore a measure of how much work a
 * frame asks for, and it barely moves when something else is using the machine, which wall-clock
 * time does. It is NOT a frame rate, and says nothing about how fast a graphics chip would draw
 * the same frame: a chip is far faster at pixels than at anything else. It is for comparing one
 * build with another, at the same view and size.
 */
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const BASE = arg("url", process.env.SHOTS_URL ?? "http://127.0.0.1:3210");
const FRAMES = Number(arg("frames", "8"));
const REPEAT = Number(arg("repeat", "1"));
const [W, H] = arg("size", "960x540").split("x").map(Number);
const presets = arg("presets", "high,medium,low").split(",");
const out = arg("out", "");

/** The same world and cameras as scripts/shots.mjs, without a preset: one is added per run. */
const CASES = {
  vista: "?scenario=first_light&seed=1&days=2&ticks=22&az=0.62&polar=0.88",
  close: "?scenario=first_light&seed=1&days=2&ticks=30&agent=7&az=0.9&polar=1.08&dist=13",
  mid: "?scenario=first_light&seed=1&days=3&ticks=26&az=-0.5&polar=0.98&dist=46&tx=30&ty=30",
  dusk: "?scenario=first_light&seed=1&days=3&ticks=47&az=1.9&polar=1.02&dist=58",
  night: "?scenario=first_light&seed=1&days=3&ticks=76&az=0.4&polar=0.95&dist=70",
};
const cases = arg("cases", "vista,close,mid").split(",");

const TICKS_PER_SECOND = Number(execSync("getconf CLK_TCK").toString().trim()) || 100;

/** Processor seconds used so far by every process whose command line carries `marker`, and by their descendants. */
function cpuSeconds(marker) {
  const procs = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      // the command name is in parentheses and may itself contain spaces or parentheses
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8");
      procs.set(Number(name), { ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]), marked: cmdline.includes(marker) });
    } catch {
      // a process that ended while it was being read
    }
  }
  let ticks = 0;
  for (const [, p] of procs) {
    let q = p;
    let mine = false;
    for (let depth = 0; q && depth < 12; depth++) {
      if (q.marked) {
        mine = true;
        break;
      }
      q = procs.get(q.ppid);
    }
    if (mine) ticks += p.ticks;
  }
  return ticks / TICKS_PER_SECOND;
}

const marker = `--tr-frame-cost=${process.pid}-${Date.now()}`;
const browser = await chromium.launch({ args: [marker] });
const rows = [];
let failed = false;

for (let rep = 0; rep < REPEAT; rep++) {
  for (const name of cases) {
    const query = CASES[name];
    if (!query) {
      console.error(`unknown case ${name}`);
      failed = true;
      continue;
    }
    for (const preset of presets) {
      const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      // count the frames the page draws, and note what the renderer says each one submitted
      await page.addInitScript(() => {
        const raf = window.requestAnimationFrame.bind(window);
        window.__frames = 0;
        window.__perFrame = [];
        window.requestAnimationFrame = (cb) =>
          raf((t) => {
            const s = window.__studio?.ready ? window.__studio.stats() : null;
            if (s) {
              window.__frames++;
              // a build that draws shadows on alternate frames reports the mean of the last two frames beside the dearer one
              if (window.__perFrame.length < 600) window.__perFrame.push([s.drawCallsMean ?? s.drawCalls, s.trianglesMean ?? s.triangles, s.drawCalls, s.triangles]);
            }
            cb(t);
          });
      });
      await page.goto(`${BASE}/studio${query}&q=${preset}`);
      try {
        await page.waitForFunction(() => window.__studio?.ready === true, null, { timeout: 300_000 });
        // two frames to be past anything compiled or uploaded on first use
        await page.waitForFunction(() => window.__frames >= 2, null, { timeout: 300_000 });
        // Drawing is done by another process, after the page has asked for it. The page is made to wait
        // until everything asked for so far has been drawn, at both ends of the count, so that the time
        // counted belongs to the frames counted and to no others.
        const settled = () =>
          page.evaluate(() => {
            document.querySelector("canvas")?.getContext("webgl2")?.finish();
            return window.__frames;
          });
        const f0 = await settled();
        const c0 = cpuSeconds(marker);
        const t0 = Date.now();
        await page.waitForFunction((want) => window.__frames >= want, f0 + FRAMES, { timeout: 600_000, polling: 50 });
        const f1 = await settled();
        const c1 = cpuSeconds(marker);
        const t1 = Date.now();
        const per = await page.evaluate((from) => window.__perFrame.slice(from), f0);
        const stats = await page.evaluate(() => window.__studio.stats());
        const n = f1 - f0;
        const calls = per.map((p) => p[0]);
        const tris = per.map((p) => p[1]);
        const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
        const row = {
          url: BASE,
          case: name,
          preset,
          size: `${W}x${H}`,
          frames: n,
          drawCallsMean: Math.round(mean(calls) * 10) / 10,
          drawCallsMax: Math.max(...per.map((p) => p[2])),
          trianglesMean: Math.round(mean(tris)),
          trianglesMax: Math.max(...per.map((p) => p[3])),
          cpuSecondsPerFrame: Math.round(((c1 - c0) / n) * 1000) / 1000,
          wallSecondsPerFrame: Math.round(((t1 - t0) / n / 1000) * 1000) / 1000,
          renderer: stats.renderer,
        };
        rows.push(row);
        console.log(
          `${name.padEnd(6)} ${preset.padEnd(6)} ${row.size}  calls ${String(row.drawCallsMean).padStart(5)} (max ${row.drawCallsMax})  triangles ${String(row.trianglesMean).padStart(8)} (max ${row.trianglesMax})  cpu ${row.cpuSecondsPerFrame.toFixed(3)} s/frame  wall ${row.wallSecondsPerFrame.toFixed(3)} s/frame  [${n} frames]`,
        );
        if (out) appendFileSync(out, `${JSON.stringify(row)}\n`);
        if (flag("budget")) {
          const budget = await page.evaluate(() => window.__studio.budget());
          for (const b of budget.slice(0, 28)) console.log(`    ${String(b.triangles).padStart(8)}  ×${String(b.instances).padStart(5)}  ${b.name}`);
        }
      } catch (err) {
        console.error(`${name} ${preset}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
        failed = true;
      }
      await context.close();
    }
  }
}
await browser.close();

if (REPEAT > 1) {
  // the median of the repeats, per case and preset
  const key = (r) => `${r.case} ${r.preset}`;
  const groups = new Map();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  console.log("\nmedian of repeats");
  for (const [k, rs] of groups) {
    const med = (f) => {
      const xs = rs.map(f).sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)];
    };
    console.log(`${k.padEnd(14)} calls ${med((r) => r.drawCallsMean)}  triangles ${med((r) => r.trianglesMean)}  cpu ${med((r) => r.cpuSecondsPerFrame).toFixed(3)} s/frame  wall ${med((r) => r.wallSecondsPerFrame).toFixed(3)} s/frame`);
  }
}
process.exit(failed ? 1 : 0);
