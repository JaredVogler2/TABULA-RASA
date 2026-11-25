/**
 * Measure the game's top bar in its widest state (forked on a two-digit day, twin available)
 * at many window widths. Its four parts must never overlap one another, leave the screen, or
 * hold more than fits inside them. This is the check behind the breakpoints in
 * `src/ui/game/game.module.css` ("the top bar on windows that are not wide").
 *
 *   pnpm build && pnpm exec next start -p 3210 &
 *   node scripts/topbar.mjs http://127.0.0.1:3210 /tmp/topbar            # prints one line per width; exits 1 on any problem
 *   node scripts/topbar.mjs http://127.0.0.1:3210 /tmp/topbar 1366,390   # only these widths
 *
 * It drives the real game (new world, eleven days, one intervention), so it takes a minute.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:3211";
const out = process.argv[3] ?? ".";
const widths = (process.argv[4] ?? "2560,1920,1600,1599,1536,1440,1439,1366,1280,1279,1180,1120,1119,1024,900,881,880,768,600,430,414,390,375,360,320").split(",").map(Number);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(`${base}/?q=low&pr=0.5`);
await page.getByTestId("begin").click();
await page.getByTestId("scenario-first_light").click();
await page.getByTestId("seed-input").fill("7");
await page.getByTestId("create-world").click();
await page.getByTestId("world-label").waitFor({ timeout: 60000 });
await page.getByTestId("coach-skip").click();
// eleven days in, so that "Forked on day 12" is as wide as the badge gets early on
await page.getByTestId("speed-5").click();
await page.getByTestId("play-toggle").click();
await page.waitForFunction(() => Number((document.querySelector('[data-testid="tick"]')?.textContent ?? "").replace(/\D+/g, "")) > 1060, null, { timeout: 240000 });
await page.getByTestId("play-toggle").click();
await page.getByTestId("open-interventions").click();
await page.getByTestId("intervene-blight").click();
await page.getByTestId("forked-badge").waitFor();

const ids = ["brand", "fork-controls", "status-bar", "tools"];
let bad = 0;
for (const w of widths) {
  await page.setViewportSize({ width: w, height: w < 600 ? 844 : 768 });
  await page.waitForTimeout(350);
  const boxes = {};
  for (const id of ids) boxes[id] = await page.getByTestId(id).boundingBox();
  const problems = [];
  for (const id of ids) {
    const b = boxes[id];
    if (!b) { problems.push(`${id} missing`); continue; }
    if (b.x < -0.5 || b.x + b.width > w + 0.5) problems.push(`${id} leaves the screen (${Math.round(b.x)}…${Math.round(b.x + b.width)})`);
  }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = boxes[ids[i]], b = boxes[ids[j]];
      if (!a || !b) continue;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) problems.push(`${ids[i]} overlaps ${ids[j]} by ${Math.round(ox)}px`);
    }
  // is anything inside a bar clipped by the bar itself? (a child wider than its parent)
  const clipped = await page.evaluate((list) => list.map((id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el && el.scrollWidth > el.clientWidth + 1 ? `${id} content ${el.scrollWidth}>${el.clientWidth}` : null; }).filter(Boolean), ids);
  const label = await page.getByTestId("world-label").evaluate((el) => (getComputedStyle(el).display === "none" ? "hidden" : el.scrollWidth > el.clientWidth + 1 ? "truncated" : "full"));
  const line = `${String(w).padStart(5)}  ${ids.map((id) => `${id}:${boxes[id] ? `${Math.round(boxes[id].x)}+${Math.round(boxes[id].width)}@${Math.round(boxes[id].y)}` : "-"}`).join("  ")}  label:${label}  ${[...problems, ...clipped].join("; ") || "ok"}`;
  console.log(line);
  if (problems.length || clipped.length) bad++;
  if ([1920, 1366, 1280, 1024, 390].includes(w)) await page.screenshot({ path: `${out}/topbar-${w}.jpg`, type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: w, height: w < 900 ? 200 : 80 } });
}
console.log(bad ? `${bad} widths with problems` : `no overlap, nothing off screen and nothing spilling at any of ${widths.length} widths`);
await browser.close();
process.exit(bad ? 1 : 0);
