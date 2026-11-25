/**
 * How far does the picture trail the world when the page is slower than the simulation?
 *
 *   pnpm build && pnpm exec next start -p 3210 &
 *   node scripts/trail.mjs http://127.0.0.1:3210 evidence/after-20 [--name trail] [--label "what was measured"]
 *
 * The world is lived in a worker and shown by the page. This plays a world at a speed for some
 * seconds with the page's main thread slowed by a factor, presses pause from inside the page, and
 * reports three things:
 *
 *   late        how late the page's own timer fired (it was asked to press pause after N seconds):
 *               a page that cannot get to its own timers cannot get to a click either
 *   ran on      how many ticks the top bar went on to show after pause was pressed
 *   until shown how long it took the page to show "paused"
 *
 * The worker stops within one turn of its loop of being told to, so whatever the picture adds
 * after the press was already on its way to the page: the last two are the length of that queue.
 *
 * READ THIS BEFORE QUOTING A NUMBER. The slowing is Chromium's own (DevTools "CPU throttling"),
 * applied to the page and not to the worker: it models a page that is slower than its world, not
 * any device. In headless Chromium without a GPU the 3D view is drawn by a software rasterizer
 * that uses every core, which is itself a slow page: the unslowed rows already trail by one of
 * its turns. Nothing here says how a phone or a laptop behaves; it says whether the delay is
 * bounded or grows with the time played.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const base = positional[0] ?? "http://127.0.0.1:3210";
const out = positional[1] ?? ".";
const name = flag("name", "trail");
const label = flag("label", "");
mkdirSync(out, { recursive: true });

/** [slowing of the page, speed button, its label, seconds played] */
const CASES = [
  [1, 2, "4×", 20],
  [1, 5, "64×", 20],
  [1, 5, "64×", 40],
  [4, 5, "64×", 20],
  [10, 5, "64×", 20],
  [20, 2, "4×", 20],
  [20, 5, "64×", 20],
  [20, 5, "64×", 40],
];

async function measure(browser, slowing, speed, seconds) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  try {
    // the lightest picture the game draws, so that what is measured is the page and not the rasterizer
    await page.goto(`${base}/?q=low&pr=0.4`);
    await page.getByTestId("begin").click();
    await page.getByTestId("scenario-first_light").click();
    await page.getByTestId("seed-input").fill("7");
    await page.getByTestId("create-world").click();
    await page.getByTestId("world-label").waitFor({ timeout: 60_000 });
    await page.getByTestId("coach-skip").click();
    await page.getByTestId(`speed-${speed}`).click();
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: slowing });
    // started, waited for and stopped from inside the page: nothing here depends on the page being idle
    const result = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const button = document.querySelector('[data-testid="play-toggle"]');
          const tickEl = document.querySelector('[data-testid="tick"]');
          const read = () => Number((tickEl?.textContent ?? "").replace(/\D+/g, ""));
          const t0 = performance.now();
          button.click();
          setTimeout(() => {
            const pressedAt = performance.now();
            const shownAtPress = read();
            button.click();
            const obs = new MutationObserver(() => {
              if (button.getAttribute("data-playing") !== "false") return;
              obs.disconnect();
              resolve({ playedMs: Math.round(pressedAt - t0), shownAtPress, stoppedAt: read(), untilShownMs: Math.round(performance.now() - pressedAt) });
            });
            obs.observe(button, { attributes: true });
          }, ms);
        }),
      seconds * 1000,
    );
    return { ...result, renderer };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
const rows = [];
let renderer = "unknown";
for (const [slowing, speed, speedLabel, seconds] of CASES) {
  const r = await measure(browser, slowing, speed, seconds);
  renderer = r.renderer;
  const row = {
    slowing,
    speed: speedLabel,
    seconds,
    lateMs: r.playedMs - seconds * 1000,
    ticksPerSecond: Math.round((r.stoppedAt / (r.playedMs / 1000)) * 10) / 10,
    ranOnTicks: r.stoppedAt - r.shownAtPress,
    untilShownMs: r.untilShownMs,
  };
  rows.push(row);
  console.log(
    `page slowed ${String(slowing).padStart(2)}×, speed ${speedLabel.padEnd(3)}, ${seconds} s: timer ${String(row.lateMs).padStart(6)} ms late, ${String(row.ticksPerSecond).padStart(6)} ticks/s lived, picture ran on ${String(row.ranOnTicks).padStart(5)} ticks, "paused" shown after ${String(row.untilShownMs).padStart(6)} ms`,
  );
}
await browser.close();

const env = { date: new Date().toISOString(), base, node: process.version, cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length, renderer, view: "1366×768, ?q=low&pr=0.4, First Light seed 7, 50 people", ...(label ? { label } : {}) };
writeFileSync(`${out}/${name}.json`, JSON.stringify({ env, rows }, null, 1) + "\n");
const lines = [
  `# ${label || "How far the picture trails the world"}`,
  "",
  `Measured ${env.date} against ${base} with scripts/trail.mjs. ${env.cores} × ${env.cpu}; Node ${env.node}; renderer: ${renderer}.`,
  `View: ${env.view}. The slowing is Chromium's CPU throttling of the page (not of the worker).`,
  "A software rasterizer is itself a slow page; these numbers describe this machine, not a device.",
  "",
  "| Page slowed | Speed | Played | Timer late | World lived at | Picture ran on after pause | \"Paused\" shown after |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.slowing}× | ${r.speed} | ${r.seconds} s | ${r.lateMs} ms | ${r.ticksPerSecond} ticks/s | ${r.ranOnTicks} ticks | ${r.untilShownMs} ms |`),
  "",
];
writeFileSync(`${out}/${name}.md`, lines.join("\n"));
