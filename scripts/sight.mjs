/**
 * Can what the interface says be seen? Two things a still does not show and a test of words does not
 * notice, measured against any address — a local build or the deployed site:
 *
 *   node scripts/sight.mjs https://tabula-rasa-bay.vercel.app evidence/after-20 --name sight-before [--label "…"] [--shots]
 *
 *   ROWS     the Recordings sheet on the title screen, at four phone sizes and two wider ones: how
 *            wide the name of the first recording is and on how many lines it is set, how far the row
 *            reaches past the list, whether the sheet has to be scrolled sideways.
 *   FOLLOW   on a phone-sized and a desktop-sized page: a citizen is tapped, then followed, then the
 *            view is zoomed, then time runs at 8× for twelve seconds. At each step: where the citizen
 *            is drawn, what is the topmost thing at that point of the page (the map itself, or a bar
 *            or a card standing over it), whether the button still says "Following", and how far the
 *            citizen strays from where they were held.
 *
 * Both were reported by the owner from a real phone. The browser tests now assert the same things
 * (`tests/e2e/layout.ts`); this script is for measuring a build those tests were not run against —
 * the one that is deployed — and it uses nothing a build before the fixes did not have.
 *
 * READ THIS BEFORE QUOTING A NUMBER. This is headless Chromium made the size of a phone, not a phone:
 * it is not Safari, it has no notch, and without a graphics chip it draws a few frames a second. What
 * it measures is layout and what the camera does, both of which are the same code on any device.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--shots"));
const base = (positional[0] ?? "http://127.0.0.1:3210").replace(/\/+$/, "");
const out = positional[1] ?? ".";
const name = flag("name", "sight");
const label = flag("label", "");
const shots = has("shots");
mkdirSync(out, { recursive: true });

const SIZES = [
  [320, 568, true],
  [360, 740, true],
  [390, 844, true],
  [430, 932, true],
  [768, 1024, true],
  [1366, 768, false],
];

async function rows(browser) {
  const result = [];
  for (const [width, height, touch] of SIZES) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1 });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/?q=low&pr=0.4`);
      await page.getByTestId("title-recordings").click();
      await page.getByTestId("recordings-list").waitFor({ state: "visible", timeout: 30_000 });
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="recordings-list"]');
        const frame = list.getBoundingClientRect();
        const row = list.querySelector("li");
        const title = row.querySelector("button");
        const box = title.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(title);
        const rects = Array.from(range.getClientRects())
          .filter((r) => r.width > 0.5 && r.height > 0.5)
          .sort((p, q) => p.top - q.top);
        let lines = 0;
        let bottom = -Infinity;
        for (const r of rects) {
          if (r.top >= bottom - 2) lines++;
          bottom = Math.max(bottom, r.bottom);
        }
        let past = 0;
        for (const el of Array.from(row.querySelectorAll("*"))) past = Math.max(past, el.getBoundingClientRect().right - frame.right);
        const above = list.previousElementSibling?.getBoundingClientRect();
        const body = list.parentElement;
        return {
          list: Math.round(frame.width),
          nameWidth: Math.round(box.width),
          nameLines: lines,
          past: Math.max(0, Math.round(past)),
          over: above ? Math.max(0, Math.round(above.bottom - box.top)) : 0,
          sideways: body.scrollWidth > body.clientWidth + 1,
        };
      });
      result.push({ width, height, ...m });
      console.log(`rows ${String(width).padStart(4)}×${String(height).padEnd(4)}: name ${String(m.nameWidth).padStart(3)}px wide on ${m.nameLines} line${m.nameLines === 1 ? " " : "s"}; ${m.past ? `row reaches ${m.past}px past the list` : "nothing past the list"}; ${m.over ? `name ${m.over}px over the paragraph above; ` : ""}${m.sideways ? "the sheet scrolls sideways" : "no sideways scroll"}`);
      if (shots && (width === 390 || width === 1366)) await page.screenshot({ path: `${out}/${name}-recordings-${width}.jpg`, type: "jpeg", quality: 82 });
    } finally {
      await context.close();
    }
  }
  return result;
}

/** Where a citizen is drawn and what is on top there: "" when it is the map itself. */
const look = (page, id) =>
  page.evaluate((agent) => {
    const canvas = document.querySelector('[data-testid="world-canvas"]');
    const at = window.__tr?.screenOf(agent) ?? null;
    if (!at) return { at: null, under: "outside the picture" };
    const top = document.elementFromPoint(at.x, at.y);
    if (top === canvas) return { at, under: "" };
    const held = top?.closest("[data-testid], [aria-label]");
    return { at, under: held?.getAttribute("data-testid") ?? held?.getAttribute("aria-label") ?? top?.tagName.toLowerCase() ?? "nothing" };
  }, id);

async function follow(browser, kind) {
  const phone = kind === "phone";
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const tick = async () => Number(((await page.getByTestId("tick").textContent()) ?? "").replace(/\D+/g, ""));
  const paused = () => page.waitForFunction(() => document.querySelector('[data-testid="play-toggle"]')?.getAttribute("data-playing") === "false");
  const steps = [];
  try {
    await page.goto(`${base}/?q=low&pr=0.6`);
    await page.getByTestId("begin").click();
    await page.getByTestId("scenario-first_light").click();
    await page.getByTestId("seed-input").fill("7");
    await page.getByTestId("create-world").click();
    await page.getByTestId("world-label").waitFor({ state: "attached", timeout: 60_000 });
    await page.getByTestId("coach-skip").click();
    await page.getByTestId("speed-3").click();
    await page.getByTestId("play-toggle").click();
    for (;;) {
      if ((await tick()) > 130) break;
      await page.waitForTimeout(300);
    }
    await page.getByTestId("play-toggle").click();
    await paused();

    // someone on screen, clear of the bars
    const target = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let id = 0; id < 50; id++) {
        const p = window.__tr?.screenOf(id);
        if (p && p.x > w * 0.12 && p.x < w * 0.88 && p.y > h * 0.26 && p.y < h * 0.72) return { id, x: p.x, y: p.y };
      }
      return null;
    });
    if (!target) throw new Error("nobody on screen to tap");
    if (phone) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
    await page.getByTestId("inspector-name").waitFor({ timeout: 8_000 });
    const who = target.id;
    const button = page.getByTestId("follow");
    const step = async (what) => {
      const s = await look(page, who);
      const card = await page.getByTestId("inspector").boundingBox();
      const row = { what, at: s.at ? { x: Math.round(s.at.x), y: Math.round(s.at.y) } : null, under: s.under, following: (await button.getAttribute("aria-pressed")) === "true", card: card ? { top: Math.round(card.y), bottom: Math.round(card.y + card.height) } : null };
      steps.push(row);
      console.log(`${kind.padEnd(7)} ${what.padEnd(22)}: drawn at ${row.at ? `(${row.at.x}, ${row.at.y})` : "nowhere"}; ${row.under ? `UNDER ${row.under}` : "in sight"}; button says following: ${row.following}; card ${row.card ? `${row.card.top}..${row.card.bottom}` : "none"}`);
      return s;
    };
    await page.waitForTimeout(2000);
    await step("tapped");
    if (shots) await page.screenshot({ path: `${out}/${name}-${kind}-tapped.jpg`, type: "jpeg", quality: 82 });

    await button.click();
    await page.waitForTimeout(2500);
    const held = (await step("Follow pressed")).at;
    if (shots) await page.screenshot({ path: `${out}/${name}-${kind}-following.jpg`, type: "jpeg", quality: 82 });

    // zoom in a little, over the map above where they are held
    const view = page.viewportSize();
    await page.mouse.move(view.width / 2, phone ? 190 : view.height / 2 + 40);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(2000);
    const zoomed = await step("zoomed in");
    if (!zoomed.at || (await button.getAttribute("aria-pressed")) !== "true") {
      // the follow was ended by the zoom: press it again so that the rest can be measured
      await button.click();
      await page.waitForTimeout(2500);
      await step("Follow pressed again");
    }
    const home = (await look(page, who)).at ?? held;

    // time runs at 8× for twelve seconds
    await page.getByTestId("play-toggle").click();
    const from = await tick();
    const started = Date.now();
    const strays = [];
    let hidden = 0;
    let samples = 0;
    while (Date.now() - started < 12_000) {
      const s = await look(page, who);
      samples++;
      if (s.under !== "") hidden++;
      strays.push(s.at && home ? Math.round(Math.hypot(s.at.x - home.x, s.at.y - home.y)) : -1);
      await page.waitForTimeout(250);
    }
    await page.getByTestId("play-toggle").click();
    await paused();
    const ticks = (await tick()) - from;
    const furthest = Math.max(...strays);
    const walked = { ticks, samples, hidden, furthest, stillFollowing: (await button.getAttribute("aria-pressed")) === "true" };
    console.log(`${kind.padEnd(7)} ${"time running, 8×".padEnd(22)}: ${ticks} ticks, ${samples} samples; hidden in ${hidden}; furthest from where they were held: ${furthest}px; button says following: ${walked.stillFollowing}`);
    if (shots) await page.screenshot({ path: `${out}/${name}-${kind}-walked.jpg`, type: "jpeg", quality: 82 });
    return { kind, view, steps, walked };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
const measured = { rows: await rows(browser), follow: [await follow(browser, "phone"), await follow(browser, "desktop")] };
await browser.close();

const date = new Date().toISOString();
writeFileSync(`${out}/${name}.json`, JSON.stringify({ env: { date, base, node: process.version, ...(label ? { label } : {}) }, ...measured }, null, 1) + "\n");
const lines = [
  `# ${label || "What can be seen"}`,
  "",
  `Measured ${date} against ${base} with scripts/sight.mjs, in headless Chromium (not a phone, not Safari).`,
  "",
  "## The Recordings sheet: the first row",
  "",
  "| Page | List | Name | Row past the list | Name over the paragraph above | Sheet scrolls sideways |",
  "|---|---|---|---|---|---|",
  ...measured.rows.map((r) => `| ${r.width}×${r.height} | ${r.list} px | ${r.nameWidth} px on ${r.nameLines} line${r.nameLines === 1 ? "" : "s"} | ${r.past} px | ${r.over} px | ${r.sideways ? "yes" : "no"} |`),
  "",
  "## A citizen tapped, then followed (First Light, seed 7, after 130 ticks)",
  "",
  "| Page | Step | Drawn at | On top at that point | Button says following | Card |",
  "|---|---|---|---|---|---|",
  ...measured.follow.flatMap((f) => f.steps.map((s) => `| ${f.kind} ${f.view.width}×${f.view.height} | ${s.what} | ${s.at ? `(${s.at.x}, ${s.at.y})` : "not in the picture"} | ${s.under ? s.under : "the map"} | ${s.following ? "yes" : "no"} | ${s.card ? `${s.card.top}..${s.card.bottom}` : "—"} |`)),
  "",
  "| Page | Time running at 8× | Samples | Hidden in | Furthest from where they were held | Still following |",
  "|---|---|---|---|---|---|",
  ...measured.follow.map((f) => `| ${f.kind} | ${f.walked.ticks} ticks | ${f.walked.samples} | ${f.walked.hidden} | ${f.walked.furthest} px | ${f.walked.stillFollowing ? "yes" : "no"} |`),
  "",
];
writeFileSync(`${out}/${name}.md`, lines.join("\n"));
