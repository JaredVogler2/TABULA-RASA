/**
 * Measure the game's top bar at many window widths, three times: in a world nobody has
 * touched (no fork pill); as it stands after an intervention (forked on a two-digit day, twin
 * available); and then with the longest words and numbers it can ever be asked to show written
 * into it (a four-digit day, "Cold snap", a two-digit frost, five hundred citizens, a fork on
 * a four-digit day). Its parts must never overlap one another, leave the screen, or hold more
 * than fits inside them. This is the test of the fitting in `src/ui/game/fit.ts` and of the
 * rules it drives in `src/ui/game/game.module.css` ("the top bar on windows that are not wide").
 * Each line also says which words the bar kept (hide: what gave way; squeeze: the status row).
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
// a small window while the days pass: the renderer is software here, and the bar is not measured yet
const context = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(`${base}/?q=low&pr=0.5`);
await page.getByTestId("begin").click();
await page.getByTestId("scenario-first_light").click();
await page.getByTestId("seed-input").fill("7");
await page.getByTestId("create-world").click();
// (the label is one of the words the bar gives up when it is short of room: it is there, shown or not)
await page.getByTestId("world-label").waitFor({ state: "attached", timeout: 60000 });
await page.getByTestId("coach-skip").click();
// eleven days in, so that "Forked on day 12" is as wide as the badge gets early on
await page.getByTestId("speed-5").click();
await page.getByTestId("play-toggle").click();
await page.waitForFunction(() => Number((document.querySelector('[data-testid="tick"]')?.textContent ?? "").replace(/\D+/g, "")) > 1060, null, { timeout: 240000 });
await page.getByTestId("play-toggle").click();

// The bar's layout does not depend on the world behind it (the canvas is placed absolutely, under
// everything), and a software renderer redrawing a 2560 px view after every change of size is what
// made this script take half an hour. So the world is drawn small while the bar is measured, and at
// its real size again for each picture that is kept.
const small = (on) => page.evaluate((on) => {
  const id = "topbar-probe-small-canvas";
  document.getElementById(id)?.remove();
  if (!on) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = '[data-testid="world-canvas"]{width:48px!important;height:48px!important}';
  document.head.append(style);
}, on);
await small(true);

const ids = ["brand", "fork-controls", "status-bar", "tools"];

/**
 * Write the longest labels the bar can be asked to show into the text nodes that are already
 * there. (React keeps the fixed and the changing part of a label in separate text nodes — "Day "
 * and "12" — so each value is written into the node that holds it: `at` is its place among
 * the element's text nodes, counted from the end when negative.)
 */
const widen = () =>
  page.evaluate(() => {
    const text = (el, value, at = -1) => {
      if (!el) throw new Error("a part of the bar is missing");
      const nodes = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
      const node = nodes.at(at);
      if (!node) throw new Error("a part of the bar holds no text");
      node.nodeValue = value;
    };
    const date = document.querySelector('[data-testid="stat-date"]');
    text(date.querySelector("b"), "1888"); // "Day 1888"
    text(date.querySelector("span"), "Summer");
    const stats = [...document.querySelector('[data-testid="status-bar"]').children].filter((el) => el.querySelector("svg"));
    text(stats[0].querySelector("span"), "Cold snap");
    text(stats[1].querySelector("span"), "-18", 0); // "-18°"
    const population = document.querySelector('[data-testid="stat-population"]');
    text(population.querySelector("b"), "500");
    text(population.querySelector("span"), "500"); // "/ 500"
    text(document.querySelector('[data-testid="forked-badge"] > span'), "1888"); // "Forked on day 1888"
    const read = (sel) => document.querySelector(sel)?.textContent ?? "";
    const shown = `${read('[data-testid="stat-date"]')} | ${stats[0].textContent} | ${stats[1].textContent} | ${read('[data-testid="stat-population"]')} | ${read('[data-testid="forked-badge"]')}`;
    // the bar measures itself when its window changes: tell it that what it holds has
    window.dispatchEvent(new Event("resize"));
    return shown;
  });

let bad = 0;
for (const mode of ["untouched", "as played", "longest labels"]) {
  console.log(`— ${mode} —`);
  if (mode === "as played") {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByTestId("open-interventions").click();
    await page.getByTestId("intervene-blight").click();
    await page.getByTestId("forked-badge").waitFor();
  }
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w < 600 ? 844 : 768 });
    await page.waitForTimeout(350);
    if (mode === "longest labels") {
      const shown = await widen();
      if (w === widths[0]) console.log(`  (the bar now reads: ${shown})`);
      await page.waitForTimeout(150);
    }
    const boxes = {};
    // (a part that is not there has no box: asking for one would wait for it)
    for (const id of ids) boxes[id] = (await page.getByTestId(id).count()) ? await page.getByTestId(id).boundingBox() : null;
    const problems = [];
    for (const id of ids) {
      const b = boxes[id];
      if (!b) { if (!(id === "fork-controls" && mode === "untouched")) problems.push(`${id} missing`); continue; }
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
    // is the name squeezed? (a flex box reports no overflow while its content eats its own padding)
    const squeezed = await page.evaluate(() => {
      const brand = document.querySelector('[data-testid="brand"]');
      const mark = brand?.firstElementChild;
      if (!brand || !mark) return null;
      const style = getComputedStyle(brand);
      const room = brand.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
      const label = brand.querySelector('[data-testid="world-label"]');
      const last = label && getComputedStyle(label).display !== "none" ? label : mark;
      const over = last.getBoundingClientRect().right - room;
      return over > 1 ? `the name's padding is squeezed by ${Math.round(over)}px` : null;
    });
    if (squeezed) problems.push(squeezed);
    // the fork pill belongs beside the name, at every width: a row of its own is a row of the world lost
    if (boxes.brand && boxes["fork-controls"] && boxes["fork-controls"].y >= boxes.brand.y + boxes.brand.height) problems.push("the fork pill has dropped to a row of its own");
    // and the tools are never pushed under one another
    if (boxes.tools && boxes.tools.height > 70) problems.push(`the tools have wrapped (${Math.round(boxes.tools.height)}px tall)`);
    const label = await page.getByTestId("world-label").evaluate((el) => (getComputedStyle(el).display === "none" ? "hidden" : el.scrollWidth > el.clientWidth + 1 ? "truncated" : "full"));
    const fit = await page.evaluate(() => { const bar = document.querySelector("header"); const status = document.querySelector('[data-testid="status-bar"]'); return `hide:[${bar?.dataset.hide ?? "?"}]${bar?.dataset.wrap ? " wrapped" : ""} squeeze:${status?.dataset.squeeze ?? "?"}`; });
    const line = `${String(w).padStart(5)}  ${ids.map((id) => `${id}:${boxes[id] ? `${Math.round(boxes[id].x)}+${Math.round(boxes[id].width)}@${Math.round(boxes[id].y)}` : "-"}`).join("  ")}  label:${label}  ${fit}  ${[...problems, ...clipped].join("; ") || "ok"}`;
    console.log(line);
    if (problems.length || clipped.length) bad++;
    if ([1920, 1366, 1280, 1024, 390, 320].includes(w)) {
      await small(false);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/topbar-${w}-${mode.replace(" ", "-")}.jpg`, type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: w, height: w < 900 ? 220 : 120 } });
      await small(true);
    }
  }
}
console.log(bad ? `${bad} measurements with problems` : `no overlap, nothing off screen and nothing spilling at any of ${widths.length} widths: untouched, as played, or with the longest labels`);
await browser.close();
process.exit(bad ? 1 : 0);
