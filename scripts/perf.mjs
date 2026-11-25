/**
 * Browser performance probe: what the game costs to draw and to simulate in a real browser,
 * measured in the page and in its worker, for the reference world and a doubled one.
 *
 *   pnpm build && pnpm exec next start -p 3210 &
 *   node scripts/perf.mjs http://127.0.0.1:3210 evidence/phase-15 [--populations 50,100] [--presets low,medium,high] [--seconds 10]
 *
 * It reports, per view (desktop 1366×768, phone 390×844 at 3×), population and graphics preset:
 * frame time p50/p95 as the renderer itself records it, draw calls, triangles, pixel ratio, the
 * simulation's achieved ticks per second at the highest speed, tick time p50/p95/max inside the
 * worker, how long a question to the worker takes to come back, how large a save is and how
 * long it takes, and both JavaScript heaps where the browser reports them.
 *
 * READ THIS BEFORE QUOTING A NUMBER. The numbers describe the machine and the browser they
 * were measured on, and the output names both. In headless Chromium without a GPU the 3D view
 * is drawn by a software rasterizer (the `renderer` field will say SwiftShader or similar):
 * frame times measured that way say nothing about a phone or a laptop with a graphics chip.
 * The simulation figures (ticks per second, tick time, save size) do not depend on a GPU.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const base = positional[0] ?? "http://127.0.0.1:3210";
const out = positional[1] ?? ".";
const populations = flag("populations", "50,100").split(",").map(Number);
const presets = flag("presets", "low,medium,high").split(",");
const seconds = Number(flag("seconds", "10"));
// `--small-world`: draw the 3D view 48 px wide. A software rasterizer then has almost nothing to do, so the
// simulation figures (ticks a second achieved, the worker's answers, saves) are measured without a renderer
// that is using every core. The frame-time columns of such a run mean nothing and are left out of its table.
const smallWorld = args.includes("--small-world");
const name = flag("name", smallWorld ? "perf-browser-small-world" : "perf-browser");
mkdirSync(out, { recursive: true });

const views = [
  { name: "desktop", viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

const tickOf = async (page) => Number(((await page.getByTestId("tick").textContent()) ?? "").replace(/\D+/g, ""));

const browser = await chromium.launch();
const rows = [];
for (const view of views) {
  for (const population of populations) {
    for (const preset of presets) {
      const context = await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.deviceScaleFactor, isMobile: view.isMobile, hasTouch: view.hasTouch });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      const opened = Date.now();
      await page.goto(`${base}/?q=${preset}&start=first_light&seed=1&population=${population}`);
      await page.getByTestId("world-label").waitFor({ state: "attached", timeout: 120000 });
      const loadMs = Date.now() - opened;
      const skip = page.getByTestId("coach-skip");
      if (await skip.count()) await skip.click();
      if (smallWorld) await page.addStyleTag({ content: '[data-testid="world-canvas"]{width:48px!important;height:48px!important}' });

      // a quiet stretch at 2×: what the eye sees while watching
      await page.getByTestId("speed-1").click();
      await page.getByTestId("play-toggle").click();
      await page.waitForTimeout(seconds * 1000);
      const watching = await page.evaluate(() => window.__tr?.stats());

      // the fastest speed: how many ticks the worker actually gets through while the page keeps drawing
      await page.getByTestId("speed-5").click();
      const t0 = Date.now();
      const tick0 = await tickOf(page);
      await page.waitForTimeout(Math.max(4000, (seconds * 1000) / 2));
      const tick1 = await tickOf(page);
      const elapsed = (Date.now() - t0) / 1000;
      // a question to the worker while it is at full speed: how long the page waits for an answer when the worker is busiest
      const busy = await page.evaluate(() => window.__tr?.perf());
      await page.getByTestId("play-toggle").click();
      const perf = await page.evaluate(() => window.__tr?.perf());
      const row = {
        view: smallWorld ? `${view.name}, world drawn 48 px wide` : view.name,
        viewport: `${view.viewport.width}x${view.viewport.height}@${view.deviceScaleFactor}`,
        population,
        preset,
        loadMs,
        renderer: watching?.renderer ?? "unknown",
        pixelRatio: watching?.pixelRatio ?? null,
        frameMsP50: watching?.frameMsP50 ?? null,
        frameMsP95: watching?.frameMsP95 ?? null,
        fps: watching?.fps ?? null,
        drawCalls: watching?.drawCalls ?? null,
        triangles: watching?.triangles ?? null,
        // at 64× the game asks for 128 ticks a second: this says whether the worker kept up while the page was drawing
        ticksPerSecondAt64x: Math.round((tick1 - tick0) / elapsed),
        // what one worker thread could do flat out, from the time a tick takes
        ticksPerSecondCapacity: perf?.worker?.tickMsP50 ? Math.round(1000 / perf.worker.tickMsP50) : null,
        tickMsP50: perf?.worker?.tickMsP50 ?? null,
        tickMsP95: perf?.worker?.tickMsP95 ?? null,
        tickMsMax: perf?.worker?.tickMsMax ?? null,
        workerRoundTripMs: perf?.roundTripMs ?? null,
        workerRoundTripBusyMs: busy?.roundTripMs ?? null,
        inspectMs: perf?.inspectMs ?? null,
        inspectBusyMs: busy?.inspectMs ?? null,
        saveKb: perf?.saveKb ?? null,
        saveMs: perf?.saveMs ?? null,
        packedKb: perf?.packedKb ?? null,
        packedMs: perf?.packedMs ?? null,
        workerHeapMb: perf?.worker?.heapMb ?? null,
        pageHeapMb: perf?.pageHeapMb ?? null,
        keyframeKb: perf?.worker?.keyframeKb ?? null,
        tickAtEnd: perf?.worker?.tick ?? null,
        errors: errors.length,
      };
      rows.push(row);
      console.log(`${row.view.padEnd(7)} ${String(population).padStart(3)} agents  ${preset.padEnd(6)}  frame p50 ${row.frameMsP50} ms  p95 ${row.frameMsP95} ms  draws ${row.drawCalls}  tris ${row.triangles}  ${row.ticksPerSecondAt64x} ticks/s  tick p50 ${row.tickMsP50} ms p95 ${row.tickMsP95} ms  save ${row.saveKb} KB in ${row.saveMs} ms, packed ${row.packedKb} KB in ${row.packedMs} ms  heaps ${row.workerHeapMb}/${row.pageHeapMb} MB`);
      await context.close();
    }
  }
}
const version = browser.version();
await browser.close();

const software = rows.some((r) => /swiftshader|llvmpipe|software/i.test(String(r.renderer)));
const env = {
  date: new Date().toISOString(),
  browser: `Chromium ${version} (headless)`,
  cpu: cpus()[0]?.model ?? "unknown",
  cores: cpus().length,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  renderer: rows[0]?.renderer ?? "unknown",
  softwareRenderer: software,
  secondsPerMeasurement: seconds,
  note: software
    ? "The 3D view was drawn by a software rasterizer: frame times here are NOT a measurement of any device with a graphics chip. Simulation figures do not depend on a GPU."
    : "Frame times are for this machine's graphics hardware only.",
};
writeFileSync(`${out}/${name}.json`, `${JSON.stringify({ env: { ...env, smallWorld }, rows }, null, 1)}\n`);
const head = "| View | Agents | Preset | Frame p50 / p95 (ms) | Draw calls | Triangles | Ticks/s at 64× (128 asked) | Tick p50 / p95 / max (ms) | Capacity (ticks/s) | Worker round trip idle / at 64× (ms) | Save as text (KB / ms) | Save packed (KB / ms) | Heap worker / page (MB) |";
const md = [
  `Measured ${env.date} · ${env.browser} · ${env.cpu} × ${env.cores} · ${env.memoryGb} GB · renderer: ${env.renderer}`,
  "",
  `**${env.note}**`,
  "",
  head,
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.view} ${r.viewport} | ${r.population} | ${r.preset} | ${r.frameMsP50} / ${r.frameMsP95} | ${r.drawCalls} | ${r.triangles} | ${r.ticksPerSecondAt64x} | ${r.tickMsP50} / ${r.tickMsP95} / ${r.tickMsMax} | ${r.ticksPerSecondCapacity} | ${r.workerRoundTripMs} / ${r.workerRoundTripBusyMs} | ${r.saveKb} / ${r.saveMs} | ${r.packedKb} / ${r.packedMs} | ${r.workerHeapMb} / ${r.pageHeapMb} |`),
  "",
];
if (smallWorld) md.splice(2, 0, "**The 3D view was drawn 48 px wide on purpose, so that the renderer was idle: the frame, draw-call and triangle columns of this table mean nothing. It is here for the simulation's columns.**", "");
writeFileSync(`${out}/${name}.md`, md.join("\n"));
console.log(`wrote ${out}/${name}.json and ${name}.md`);
process.exit(rows.some((r) => r.errors > 0) ? 1 : 0);
